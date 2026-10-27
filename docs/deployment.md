# Deployment and Infrastructure Plan

Target: Model One, AWS GovCloud, EKS, air-gapped, CUI/ITAR under IL5 controls, deployed beside the existing Istari platform install. Companion to `PRD.md` section 6. Artifacts live in `deploy/`.

## 1. The one-sentence version

Workflow Manager deploys as one static-file container in the Istari namespace, reached through the platform's existing load balancer on the Istari frontend hostname at `/apps/workflows/`, so the browser treats it as the same origin as the Istari UI and talks to the registry and the object store exactly as the platform's own frontend does. Nothing else is added: no database, no backend, no secrets, no outbound network, no new AWS resources.

## 2. Topology

```
Internet / customer network
        │  443 (existing ACM cert, existing ALB)
        ▼
AWS ALB  (one load balancer shared by all Istari ingresses; IngressClass "istari", group "istari")
  ├─ host istari.<domain>, path /apps/workflows/*  ──►  Service workflow-manager:80 ──► Pod nginx:8080 (static files)
  ├─ host istari.<domain>, path /*                 ──►  Service istari-frontend
  ├─ host registry.istari.<domain>                 ──►  Service istari-fileservice (registry API)
  ├─ host mcp.istari.<domain>                      ──►  MCP service
  └─ host zitadel.istari.<domain>                  ──►  Zitadel

Browser (origin https://istari.<domain>) ──► registry API (bearer token) ──► presigned URLs ──► S3 bucket
                                           (same calls, same origin, same CORS allowlist as the Istari UI)
```

The only new path through the boundary is the `/apps/workflows/*` listener rule on the existing ALB. The Workflow Manager pod serves files and answers health checks. It never initiates a connection.

## 3. Components

| Component | What it is | New to the boundary? |
|---|---|---|
| Container image `istari/workflow-manager` | Chainguard nginx (FIPS variant in production), non-root UID 65532, read-only root filesystem, no shell, serving the built SPA | Yes: one image |
| Deployment + Service | 1 replica (2 for HA), ClusterIP, probes on `/healthz` | Yes: trivial |
| ConfigMap `workflow-manager-config` | `config.json`: registry URL, Istari web URL, the two Istari system IDs, `devAuth: false` | Yes: no secrets |
| Ingress `workflow-manager` | Same IngressClass and ALB group as the platform; frontend host; path `/apps/workflows/*` | Yes: one rule on an existing ALB |
| NetworkPolicy | Ingress on 8080 from the load balancer only; egress denied | Yes: tightens, not loosens |
| Zitadel public client (Phase 6) | PKCE client in the platform's Zitadel project; redirect URI on the frontend host | Yes: identity config, no secret |
| Istari systems `workflow-manager`, `workflow-manager-runs` | Created with the SDK or `wfm-manifest`; ordinary platform data | No infrastructure |

Not present: database, message broker, backend API, service account or IAM role, KMS keys, outbound egress, new DNS records, new certificates, new ports.

## 4. Same-origin routing in detail

Origin is scheme plus hostname plus port, so the SPA must be served from the Istari frontend hostname. Three ingress controllers appear across Istari installs; the chart supports each with `ingress.mode`.

- **ALB (AWS Load Balancer Controller), the common EKS pattern.** Platform ingresses already share one ALB through IngressClass `istari` with group `istari`. Our Ingress uses the same class, the frontend host, and path `/apps/workflows/*`. The controller merges rules from all Ingresses in the group onto the shared listener; longer, more specific paths are evaluated before the frontend's `/*`. Health check path `/healthz`. No new load balancer, listener, or certificate.
- **nginx ingress.** An Ingress with `pathType: Prefix` `/apps/workflows` on the frontend host. The controller generates the `location` block and longest-prefix wins over the frontend's `/`.
- **Istio.** A VirtualService on the platform Gateway with a prefix match for `/apps/workflows`. Istio evaluates routes in order, so this VirtualService's route must sort before the frontend's catch-all; the chart documents this.

Verified empirically on 2026-10-23: the registry reflects any origin in its CORS headers, but the bucket returns no CORS headers for an origin it does not allowlist. Served from the frontend host, the SPA inherits the allowlisted origin. A separate subdomain would require a bucket CORS change in the platform's Terraform, which is why it is the fallback, not the plan.

## 5. Container image

- Base: `cgr.dev/chainguard/nginx` for development, the Chainguard FIPS nginx variant for production (Istari already uses Chainguard FIPS bases for Zitadel and SpiceDB; pull access via the existing Chainguard org account). Distroless: no shell or package manager.
- Runtime: UID 65532, listens on 8080, read-only root filesystem with `emptyDir` mounts for nginx temp and pid paths, all capabilities dropped, `RuntimeDefault` seccomp. Identical to the platform's pod security context.
- Contents: built SPA under `/usr/share/nginx/html/apps/workflows/`, `nginx.conf` with JSON access logs to stdout, SPA fallback routing, immutable caching for hashed assets, `no-store` for `config.json`, security headers.
- Build: multi-stage Dockerfile (`deploy/Dockerfile`); the Node build stage never ships. Fonts and logos are bundled, so the running app makes zero external requests.
- Supply chain: pinned base image digest, SBOM (`syft`) and vulnerability scan (`grype` or the customer's scanner) produced at build, image signed if the customer's pipeline supports it.

## 6. Delivery into the air-gapped boundary

Model One receives platform images as OCI tarballs with checksums across the customer's cross-domain solution and loads them into the internal registry. Workflow Manager follows the same path, ideally as part of a platform release bundle:

1. Build and tag `istari/workflow-manager:<version>`; produce SBOM, scan report, and `sha256` checksum.
2. `docker save` to an OCI tar; transfer with the platform images; customer scans and approves per their process.
3. Push to the internal registry; set `image.registry` in the Helm values to the mirror path (same convention as `fileservice.registry` in the platform chart).
4. `helm upgrade --install workflow-manager deploy/chart -n istari -f values-<env>.yaml`.
5. Post-install: create the two Istari systems, publish manifests with `wfm-manifest publish`, share manifests or the system with users.

Updates are a new image tag through the same pipeline. Workflow additions and changes are manifest uploads and need no image at all.

## 7. Configuration and identity

- Runtime config is a ConfigMap rendered from Helm values. One image serves every environment.
- Development authentication (paste a token) is compiled out of production builds; `devAuth` is false in the ConfigMap.
- Phase 6 registers a public OIDC client in the platform's Zitadel project with redirect URI `https://istari.<domain>/apps/workflows/`. Public client with PKCE means no client secret anywhere. Preferred mechanism: an addition to the Zitadel configurator values so it is created by the same job that creates the platform's clients; fallback is a documented manual step in the Zitadel console.
- Authorization stays in Istari: a user sees the workflows whose manifests are shared with them.

## 8. Operations

- Logs: nginx access and error logs to stdout and stderr as JSON, collected by whatever ships platform pod logs today.
- Health: `/healthz` for liveness, readiness, and the ALB target health check.
- Resources: requests 50m CPU and 64Mi memory, limits 200m and 128Mi. Negligible.
- Scaling: stateless; replicas can be raised freely. Two replicas recommended for production.
- Backup: nothing to back up. All state lives in Istari.
- Upgrade and rollback: Helm; rollback is the previous image tag.

## 9. Cyber lift: what the ISSO will see

The security impact analysis reduces to one container that serves files, behind an existing load balancer, with no data, no secrets, and no outbound traffic. Expected questions and the answers the artifacts provide:

| Question | Answer and evidence |
|---|---|
| What new software enters the boundary? | One container image. SBOM and scan report attached. Base image is the same Chainguard FIPS family the platform already uses. |
| What data does it store or process? | None at rest. It serves static files. All data flows browser to registry and browser to object store, as with the Istari UI. |
| What credentials does it hold? | None. No service account, no API key, no client secret. Users authenticate with the platform's identity provider. |
| What network paths are added? | One path rule on the existing ALB listener. Pod NetworkPolicy denies all egress. |
| How is access controlled? | By Istari sharing on manifest resources. Workflow Manager has no authorization logic of its own. |
| How are actions attributed and audited? | Every job is created with the user's own token, so Istari's job records and access audit name the human. |
| Hardening? | Non-root, read-only filesystem, no shell, capabilities dropped, seccomp default, pinned digests, resource limits. |
| What happens if it is removed? | Nothing. The platform is unchanged and every artifact it produced remains an ordinary Istari resource or job. |

Documents to hand over: this plan, a one-page data flow diagram, ports and protocols table (443 in via ALB; none out), the SBOM and scan results, the Helm chart, and the hardening evidence (pod spec).

Compared with the three-tier alternative in `PRD.md` Appendix A, the difference is roughly: one image versus three, no database or secrets versus a database, server-held tokens, and a queue, and one ALB rule versus a new service surface. That gap is the "juice" in the squeeze.

## 10. Effort estimate

| Item | Effort | Owner |
|---|---|---|
| Image, chart, local verification | Done (`deploy/`) | FDE |
| Dev-cluster install on the Istari host path, confirm ALB path rule coexists with frontend `/*` | 1 to 2 days | FDE with install team |
| Zitadel public client and PKCE login (Phase 6) | 3 to 5 days | FDE, platform team for configurator |
| Security package: data flow, ports and protocols, SBOM, scan, hardening evidence | 2 to 3 days | FDE |
| Image delivery through the CDS and customer scan | Customer process; calendar time, not effort | Install subcontractor, customer |
| ISSO review and change approval | Calendar time; weeks | Customer |

## 11. Open questions for the install team

1. Which ingress controller does the Model One install use: ALB (expected for EKS), nginx, or Istio? This selects `ingress.mode`.
2. Confirm the frontend Ingress is in the shared `istari` ALB group so a sibling path rule merges onto the same listener.
3. Image intake path: OCI tar via the CDS to which internal registry, and what scanner must pass before load.
4. Is the Chainguard FIPS nginx image already approved in the boundary, or does it need to ride along with a platform release?
5. Who owns the Zitadel configurator values in Model One, so the public client can be added there rather than by hand.
6. Log collection: confirm pod stdout logs are shipped to the customer SIEM by the existing collector.

## 12. Demo script for the team

1. Show the catalog on the dev server, sign in, run Cameo Model Extraction end to end, open the artifacts in Istari.
2. Show the manifest JSON in the `workflow-manager` system and share it with a second user; refresh their catalog.
3. Show `deploy/`: Dockerfile, chart, and the rendered Ingress that joins the existing ALB group.
4. Walk the cyber table in section 9.
