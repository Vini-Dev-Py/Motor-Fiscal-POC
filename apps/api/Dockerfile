# Build a partir da raiz do monorepo:  docker build -f apps/api/Dockerfile .
FROM node:22-bookworm
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

# isolated-vm (sandbox do código dos overrides) exige --no-node-snapshot no Node 20+
ENV NODE_OPTIONS=--no-node-snapshot

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @motor-fiscal/api...

COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @motor-fiscal/shared build \
 && pnpm --filter @motor-fiscal/engine build \
 && pnpm --filter @motor-fiscal/api build

ENV NODE_ENV=production
EXPOSE 3000
# aplica as migrations e sobe a API (SEED_ON_START=true cria os dados de demonstração se o banco estiver vazio)
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && node dist/main.js"]
