# Build a partir da raiz do monorepo:  docker build -f apps/web/Dockerfile .
FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @motor-fiscal/web...

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @motor-fiscal/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
