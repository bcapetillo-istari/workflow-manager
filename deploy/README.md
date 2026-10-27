# Workflow Manager: deployment

One static image (Chainguard nginx, non-root UID 65532, read-only root fs, no shell) serving the SPA at
`/apps/workflows/` on the Istari frontend host, plus a Helm chart that installs it into the `istari`
namespace. Design and rationale: `docs/deployment.md`, `docs/PRD.md` section 6.

```
deploy/
  Dockerfile      multi-stage: node:22-alpine build -> Chainguard nginx runtime (ARG BASE_IMAGE)
  nginx.conf      8080, JSON access log to stdout, SPA fallback, config.json from /config, /healthz
  chart/          Helm 3 chart "workflow-manager" (Deployment, Service, ConfigMap, Ingress|VirtualService, NetworkPolicy)
```

## Build

From the repository root (the build context includes `ui/`, `schema/` and `docs/examples/`, which the SPA imports):

```sh
docker build -f deploy/Dockerfile -t istari/workflow-manager:0.1.0 .
```

Production uses the Chainguard FIPS variant and a pinned tag or digest:

```sh
docker build -f deploy/Dockerfile \
  --build-arg BASE_IMAGE=cgr.dev/istaridigital.com/nginx-fips:1.27@sha256:<digest> \
  -t istari/workflow-manager:0.1.0 .
```

The runtime image is about 28 MB. It contains no `config.json` (the one Vite copies from `ui/public` is removed
in the build stage), no environment values and no secrets.

## Run locally

The flags mirror the pod: read-only root filesystem with the two writable tmpfs paths nginx needs
(`/run` for the pid, `/var/lib/nginx/tmp` for temp files), and `config.json` mounted at `/config`.

```sh
docker run --rm -p 8080:8080 --read-only --tmpfs /run --tmpfs /var/lib/nginx/tmp \
  -v "$PWD/ui/public/config.json:/config/config.json:ro" istari/workflow-manager:0.1.0

curl -i localhost:8080/healthz                      # 200 "ok"
curl -s localhost:8080/apps/workflows/ | head        # index.html
curl -i localhost:8080/apps/workflows/config.json   # 200, Cache-Control: no-store
curl -s localhost:8080/apps/workflows/runs/abc      # index.html (SPA fallback)
curl -I localhost:8080/apps/workflows               # 301 -> /apps/workflows/
```

Hashed files under `/apps/workflows/assets/` are served with `Cache-Control: public, max-age=31536000, immutable`.
Access logs are one JSON object per line on stdout (`time, remote_addr, method, uri, status, bytes, referer,
user_agent, request_time`); errors go to stderr. `nginx -t` works without a shell:
`docker run --rm --entrypoint /usr/sbin/nginx istari/workflow-manager:0.1.0 -t`.

## Air-gap delivery

```sh
V=0.1.0
docker save istari/workflow-manager:$V -o workflow-manager-$V.tar          # OCI/Docker archive
shasum -a 256 workflow-manager-$V.tar > workflow-manager-$V.tar.sha256
syft istari/workflow-manager:$V -o spdx-json > workflow-manager-$V.sbom.spdx.json   # SBOM
grype istari/workflow-manager:$V -o table > workflow-manager-$V.scan.txt              # optional scan
```

`syft`/`grype` are not installed on this machine (`brew install syft grype`), or use the customer's scanner.
Ship the tar, checksum and SBOM with the platform release bundle. Inside the boundary:

```sh
sha256sum -c workflow-manager-$V.tar.sha256
docker load -i workflow-manager-$V.tar
docker tag istari/workflow-manager:$V <internal-registry>/istari/workflow-manager:$V
docker push <internal-registry>/istari/workflow-manager:$V
```

Then set `image.registry: <internal-registry>` in the Helm values (same convention as the platform chart's
`<component>.registry`). The pull secret defaults to `docker-pull-secret`.

## Install with Helm

Example `values-demo.yaml` for the common EKS layout (ALB shared with the platform):

```yaml
replicaCount: 2
image:
  registry: 123456789012.dkr.ecr.us-gov-west-1.amazonaws.com
  tag: "0.1.0"
config:
  registryUrl: https://api.demo.istari.app
  istariWebUrl: https://demo.istari.app
  workflowManagerSystemId: df2e9e2e-e2a1-4a3b-aa58-01dc6f43321f
  workflowManagerRunsSystemId: 487849ba-7716-4c9b-a99e-92749de25b82
  devAuth: false
ingress:
  mode: alb
  host: demo.istari.app                 # the Istari frontend host; the SPA must share its origin
  alb:
    className: istari                   # same IngressClass/group as the platform ingresses
    loadBalancerName: istari
    certificateArn: arn:aws:acm:us-gov-west-1:123456789012:certificate/...
```

```sh
helm lint deploy/chart
helm template workflow-manager deploy/chart -f values-demo.yaml | less
helm upgrade --install workflow-manager deploy/chart -n istari -f values-demo.yaml
```

### Ingress modes

| `ingress.mode` | Renders | Notes |
|---|---|---|
| `alb` (default) | Ingress, class `istari`, paths `/apps/workflows/*` and `/apps/workflows` (ImplementationSpecific), the platform's ALB annotations | Joins the shared ALB group: the controller merges rules from every Ingress in the group onto the existing listener and orders them by specificity, so our rule is matched before the frontend's `/*`. No new load balancer, listener or certificate. |
| `nginx` | Ingress, class `nginx`, `pathType: Prefix` `/apps/workflows`, TLS from secret `istari-tls` (`ingress.nginx.tlsSecretName`, empty disables) | Longest prefix wins over the frontend's `/`. |
| `istio` | VirtualService on `ingress.istio.gateway` with prefix `/apps/workflows/` and exact `/apps/workflows` | Istio evaluates routes in order; this VirtualService must sort before the frontend's catch-all. Verify with `istioctl x describe pod <frontend-pod>`. |
| `none` | nothing | Add your own route to Service `workflow-manager:80`. |

Extra annotations for ALB/nginx go in `ingress.annotations`. Set `networkPolicy.enabled: false` if the cluster
has no CNI policy support; the default policy allows ingress on 8080 from anywhere and denies all egress.

### Content-Security-Policy (per environment)

The image ships `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` but no CSP, because
`connect-src` must list the registry API host and the object-store bucket host(s), which differ per install.
To add one, mount an nginx snippet from a ConfigMap over `/etc/nginx/nginx.conf` (or extend this chart with an
`extraNginxConfig` ConfigMap) using the commented example in `deploy/nginx.conf`, for example:

```
Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
  font-src 'self'; connect-src 'self' https://api.<domain> https://<bucket>.s3.<region>.amazonaws.com;
  frame-ancestors 'self'; base-uri 'self'; form-action 'self'
```

Test in report-only mode first (`Content-Security-Policy-Report-Only`); a wrong `connect-src` blocks every
registry call and presigned upload.

## Post-install

1. Create the two Istari systems (`workflow-manager` for manifests, `workflow-manager-runs` for run documents)
   with the SDK or the Istari UI, and put their IDs in `config.workflowManagerSystemId` /
   `config.workflowManagerRunsSystemId`; `helm upgrade` rolls the pods (the Deployment carries a ConfigMap checksum).
2. Publish manifests with the CLI (`cli/README.md`):
   ```sh
   export ISTARI_TOKEN=...
   echo '{"registry_url":"https://api.demo.istari.app","system_id":"<workflow-manager system id>"}' > env.json
   wfm-manifest check docs/examples/smart_diff_workflow_manifest.json --env env.json
   wfm-manifest publish docs/examples/smart_diff_workflow_manifest.json --env env.json
   wfm-manifest list --env env.json
   ```
3. Share the `workflow-manager` system (every workflow) or individual manifests (one workflow) with users as
   viewers; FDEs hold editor to publish. Share `workflow-manager-runs` with users as editors.
4. Open `https://<host>/apps/workflows/` and confirm the catalog loads.

## Adding the Zitadel client (Phase 6)

Authentication is currently the development credential box (`devAuth` must be `false` in production).
When the PKCE flow lands:

1. Register a public OIDC client (Authorization Code + PKCE, no secret) in the platform's Zitadel project,
   redirect URI `https://<host>/apps/workflows/`, post-logout URI `https://<host>/apps/workflows/`.
   Preferred: add it to the Zitadel configurator values so the platform job creates it; fallback is the console.
2. Add `zitadelIssuer` and `zitadelClientId` to `config` in `values.yaml` and to
   `deploy/chart/templates/configmap.yaml` (and `ui/src/config.ts`); no image change is needed for a config-only
   change, but the SPA must be built with the PKCE provider.
3. If a CSP is in place, add the Zitadel host to `connect-src` (and `form-action` for the redirect).

## Verified locally (2026-10-27)

`docker build` (node:22-alpine -> cgr.dev/chainguard/nginx:latest), container run `--read-only` with tmpfs mounts:
`/healthz` 200 `ok`; `/apps/workflows/` 200 with `<div id="root"`; `/apps/workflows/config.json` 200
`application/json`, `Cache-Control: no-store`; `/apps/workflows/runs/abc` 200 index fallback;
`/apps/workflows/assets/index-*.js` 200 immutable cache, gzip; `/apps/workflows` 301; dotfiles and paths outside
the prefix 404. `helm lint` clean; `helm template` renders for `alb`, `nginx`, `istio`, `none`. Kubernetes schema
validation against a live API server was not possible on the build machine (no kube context).
