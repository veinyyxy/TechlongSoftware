# Platform-only compatibility candidate; the tenant images are unchanged.
# Keep the Node version, but remove the unused Debian utility/package closure.
FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS base
# The base digest is fixed; package security updates are resolved at build time.
# The resulting whole image is then sealed and scanned before artifact upload.
RUN apk upgrade --no-cache

FROM base AS build
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

FROM base AS candidate
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# vinext currently lives in devDependencies; retain the locked runtime graph for
# this first candidate rather than changing the published package/lock closure.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist-platform ./dist-platform
COPY --from=build --chown=node:node /app/ops/platform-hosting-v1/contract.mjs /app/ops/platform-hosting-v1/ingress.mjs /app/ops/platform-hosting-v1/control-runtime.mjs /app/ops/platform-hosting-v1/start.mjs /app/ops/platform-hosting-v1/smoke.mjs /app/ops/platform-hosting-v1/https-smoke.mjs /app/ops/platform-hosting-v1/hosted-smoke.mjs ./ops/platform-hosting-v1/
# Public TypeScript and binding contracts are shared with the bundled controller.
# Node24 loads them directly; no repository dotenv, private key or full source tree.
COPY --from=build --chown=node:node /app/lib/deployments/controller-v6/configuration.ts /app/lib/deployments/controller-v6/contract.ts /app/lib/deployments/controller-v6/installed-binding.ts ./lib/deployments/controller-v6/
COPY --from=build --chown=node:node /app/lib/deployments/execution/hash.ts ./lib/deployments/execution/
COPY --from=build --chown=node:node /app/ops/platform-recovery-control-v1/binding.mjs ./ops/platform-recovery-control-v1/
COPY --from=build --chown=node:node /app/ops/platform-cloud-v6/contract.mjs ./ops/platform-cloud-v6/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "ops/platform-hosting-v1/start.mjs"]
