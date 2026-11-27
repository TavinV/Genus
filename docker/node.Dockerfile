# syntax=docker/dockerfile:1
# Imagem dos processos Node do monorepo (apis, rep-core, jobs e os migradores).
# Contexto de build: a RAIZ do repositório (o monorepo pnpm precisa do lockfile e dos packages/).
#
#   PKG  nome do pacote no pnpm      (ex.: @genus/collector-api)
#   DIR  pasta do pacote na raiz     (ex.: apps/collector-api)
#
# Cada serviço do Compose passa os dois em `build.args`; o comando vem do próprio serviço.
# O tsx roda o TypeScript direto, como no resto do monorepo (sem etapa de build); por isso ele
# fica em `dependencies` de cada pacote que roda em produção.
#
# Em produção a imagem é construída no GitHub Actions e publicada no GHCR; a VPS só baixa
# (ver .github/workflows/ci-cd.yml). A imagem leva SÓ as dependências de produção do pacote:
# antes o `pnpm fetch` trazia as ~640 dependências do monorepo inteiro (Next, Playwright,
# Testcontainers…) e o deploy passava minutos copiando e descompactando camadas.
FROM node:24.14.1-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /repo

# Só os manifestos (lockfile, workspace e cada package.json). O conteúdo desta etapa só muda
# quando uma dependência muda, então a instalação abaixo fica em cache entre deploys.
FROM base AS manifests
COPY . .
RUN find . -type f ! -name package.json ! -name pnpm-lock.yaml ! -name pnpm-workspace.yaml -delete

FROM base AS deps
ARG PKG
COPY --from=manifests /repo ./
# Este pacote e as dependências dele dentro do monorepo (--filter "<pkg>..."), sem devDependencies.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "${PKG}..."

FROM base AS runtime
ARG DIR
ENV APP_DIR=${DIR}
COPY --from=deps /repo ./
COPY . .
RUN mkdir -p /repo/${DIR}/data \
 && chown -R node:node /repo/${DIR}
USER node
WORKDIR /repo/${DIR}
ENV NODE_ENV=production
CMD ["node_modules/.bin/tsx", "src/server.ts"]
