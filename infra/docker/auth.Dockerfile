FROM node:22.17.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@who-ruined/auth...

FROM node:22.17.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node --from=build /app /app
USER node
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema apps/services/auth/prisma/schema.prisma && exec node apps/services/auth/dist/main.js"]
