# Same pinned Node base already used by the tenant application's reviewed images.
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund
COPY app ./app
COPY components ./components
COPY config ./config
COPY db ./db
COPY lib ./lib
COPY public ./public
COPY ops ./ops
COPY types ./types
COPY postcss.config.mjs tsconfig.json ./
ENV CI=true GITHUB_ACTIONS=true
RUN node ops/platform-hosting-v1/build.mjs

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS candidate
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# vinext currently lives in devDependencies; retain the locked runtime graph for
# this first candidate rather than changing the published package/lock closure.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist-platform ./dist-platform
COPY --from=build --chown=node:node /app/ops/platform-hosting-v1/contract.mjs /app/ops/platform-hosting-v1/start.mjs /app/ops/platform-hosting-v1/smoke.mjs ./ops/platform-hosting-v1/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "ops/platform-hosting-v1/start.mjs"]
