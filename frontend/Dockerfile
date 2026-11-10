# Build context: repository root (the build also needs backend/src/contracts).
#   docker build -f frontend/Dockerfile -t hrms-frontend .
FROM node:22-bookworm-slim AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
# Shared contracts (permissions, roles, API types) are compiled from the backend source.
COPY backend/src/contracts /app/backend/src/contracts
COPY frontend ./
RUN npm run build

# Runs as an unprivileged user (uid 101) on port 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
