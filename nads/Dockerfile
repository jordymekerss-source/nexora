# NADS control-plane image (Automation ingress + CLI). Separate from SaaS Next.js app.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY db ./db
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NADS_PRODUCTION=true \
    NADS_EXECUTOR=automation \
    NADS_AUTOMATION_ENABLED=false \
    NADS_INGRESS_ENABLED=false \
    NADS_ALLOW_CURSOR_API_SMOKE=false \
    NADS_WEBHOOK_RECEIPT_STORE=postgres \
    NADS_DISPATCH_STATE_STORE=postgres \
    NADS_REQUIRE_PG_RECEIPTS=true \
    NADS_INGRESS_HOST=0.0.0.0 \
    NADS_INGRESS_PORT=8787 \
    NADS_SINGLE_TASK_MODE=true
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY db ./db
COPY docs ./docs
EXPOSE 8787
# Default: print readiness (safe). Hetzner compose overrides to ingress-serve.
CMD ["node", "dist/cli.js", "readiness-status"]
