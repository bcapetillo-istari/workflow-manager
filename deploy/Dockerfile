# syntax=docker/dockerfile:1
# Workflow Manager: static SPA served by Chainguard nginx (distroless, non-root UID 65532).
# Build from the repo root:  docker build -f deploy/Dockerfile -t istari/workflow-manager:0.1.0 .
# Production swaps the base for the FIPS variant:
#   --build-arg BASE_IMAGE=cgr.dev/istaridigital.com/nginx-fips:<pinned-tag>
ARG BASE_IMAGE=cgr.dev/chainguard/nginx:latest

# ---- Stage 1: build the SPA (never shipped) -------------------------------
FROM node:22-alpine AS build
WORKDIR /src/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
# Keep the repo layout: the SPA imports ../../../schema/workflow-manifest.v1.json and its tests
# (type-checked by `tsc -b`) import ../../../docs/examples/*.json.
COPY schema/ /src/schema/
COPY docs/examples/ /src/docs/examples/
COPY ui/ ./
# "build" = tsc -b && vite build; base path /apps/workflows/ comes from vite.config.ts.
# Vite copies ui/public/config.json into dist; drop it so the image carries no environment
# values. At runtime nginx serves /config/config.json from the ConfigMap instead.
RUN npm run build && rm -f dist/config.json

# ---- Stage 2: runtime --------------------------------------------------------
# Chainguard nginx: USER 65532, no shell, ENTRYPOINT /usr/sbin/nginx
# CMD ["-c","/etc/nginx/nginx.conf","-e","/dev/stderr","-g","daemon off;"].
# Writable paths at runtime (mount emptyDir/tmpfs): /run (pid) and /var/lib/nginx/tmp (temp files).
FROM ${BASE_IMAGE}
COPY --from=build --chown=65532:65532 /src/ui/dist/ /usr/share/nginx/html/apps/workflows/
COPY deploy/nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080
