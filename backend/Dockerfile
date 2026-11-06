# Build context: the backend folder.
#   docker build -t hrms-backend backend
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/* \
 && groupadd --system hrms && useradd --system --gid hrms --home /app hrms
COPY --from=build --chown=hrms:hrms /app/node_modules ./node_modules
COPY --from=build --chown=hrms:hrms /app/package.json ./package.json
COPY --from=build --chown=hrms:hrms /app/dist ./dist
USER hrms
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# Migrations + platform bootstrap run as a separate release step (see docker-compose `migrate`), not on every start.
CMD ["node", "dist/main.js"]
