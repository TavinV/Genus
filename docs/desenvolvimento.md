# Desenvolvimento local

> Como subir o Genus na sua máquina: banco, motor facial e a api do coletor. Os comandos são da raiz do repositório, salvo quando o texto disser outra pasta.

---

## 1. Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| Node.js | **24 LTS**, conforme `.nvmrc` (`24.14.1`) | Com `nvm`: `nvm use` |
| pnpm | **10** | `package.json` fixa a versão em `packageManager` (pnpm 10.20.0). Use `corepack enable` |
| Docker | Recente, com Compose v2 | Obrigatório para o banco, a engine e os testes (Testcontainers) |
| Postman CLI | Recente (comando `postman`) | Só para `pnpm postman:test`. [Instalação](https://learning.postman.com/docs/postman-cli/postman-cli-installation/) |

## 2. Começo rápido (do zero a uma batida reconhecida)

Há duas formas de rodar. **Não misture as duas**: as portas 3001 e 3002 são as mesmas.

**A. Tudo no Docker (um comando).** Cada contêiner tem healthcheck e limite de recursos; o banco e a engine têm prioridade.

```bash
pnpm install
pnpm setup:dev          # só na primeira vez: cria o .env da raiz (senhas geradas) e os .env.dev dos apps
docker compose up -d --build
docker compose ps       # tudo "healthy"; db-roles, arp-migrate e rh-migrate saem sozinhos (Exited 0)
```

Sobem: Postgres (bancos `arp` e `app`), Valkey, face-engine, rep-core, jobs (resgate), api do coletor (`http://localhost:3001`) e api do RH (`http://localhost:3002`). Para subir só uma parte, entre na pasta dela e rode `docker compose up -d` (ver §3).

**B. Infra no Docker e processos Node no host** (para depurar e recarregar ao salvar):

```bash
pnpm install
pnpm dev           # prepara a infra (dev:up) e sobe coletor, rep-core, resgate e api do RH num terminal só (Ctrl+C encerra os quatro)
```

Em outro terminal:

```bash
# suas fotos: uma pasta por pessoa (dev-data/ nunca vai ao Git)
#   dev-data/faces/<seu-nome>/1.jpg, 2.jpg, ...
pnpm dev:enroll-fake   # embedding de 3 fotos sorteadas + 50 candidatos fictícios
# a api do coletor lê a galeria ao subir: reinicie o pnpm dev (forma B) ou `docker compose restart collector-api` (forma A)
pnpm dev:punch         # uma batida com uma foto que a engine nunca viu
```

Esperado no `dev:punch`: `HTTP 200`, `"outcome": "registered"`, um `receiptId` e o `jobId` (`<aparelho>-<sequencia>`). Repita e a segunda vem com o aviso `possible_duplicate` (mesma pessoa em menos de 60 s), ainda registrada. A batida entra em `arp.entradas` como `pendente` e vira `processado` quando o rep-core atribui o NSR.

Para acompanhar uma batida (mesma chave `X-Service-Key`):

- `GET /coletor/batidas/jobs/<jobId>`: `status` (`pendente`, `processado`, `falhou`), `nsr` e `queue.state` (estado do job no BullMQ). Se ficar em `pendente` com `queue.state = waiting`, o rep-core não está rodando: suba pelo `pnpm dev` da **raiz** (o `pnpm dev` de dentro de `apps/collector-api` sobe só a api).
- `GET /coletor/batidas?employeeId=<id>&page=1&pageSize=20`: as batidas de um colaborador, da mais recente para a mais antiga.

| Comando | O que faz |
|---|---|
| `pnpm setup:dev` | Cria o `.env` da raiz (lido por todos os `docker-compose.yml`) e os `.env.dev` de `apps/collector-api`, `rep-core`, `jobs` e `api`, com segredos gerados e coerentes entre si (mesma `MASTER_KEY` e `ENGINE_API_KEY`, senhas dos papéis nas URLs). Se já existem, só completa o que falta. Não imprime nenhum valor |
| `pnpm dev:up` | `setup:dev` + `docker compose up -d --wait` só da infra (Postgres, Valkey, engine, `db-roles`, `arp-migrate`, `rh-migrate`). A primeira vez baixa os modelos da engine (alguns minutos) |
| `pnpm dev` | Prepara (`pnpm dev:up`) e sobe, no host, coletor, rep-core, resgate e api do RH. Log de cada um com prefixo `[api]`, `[rep-core]`, `[resgate]`, `[rh]`. `pnpm dev -- --sem-preparo` pula o preparo |
| `pnpm dev:enroll-fake` | Galeria `dev-data/gallery.json`: cada subpasta de `dev-data/faces/` é uma pessoa; sorteia `--photos` fotos (padrão 3) para a engine gerar o embedding cifrado; cria `--fakes` candidatos fictícios (padrão 50). As fotos não sorteadas vão para `dev-data/probes/<pessoa>/` (para testar) e uma delas para `dev-data/probes/proxima-batida.jpg` (usada pelo Postman) |
| `pnpm dev:punch` | Uma batida contra a api rodando. Opções: `--image <arquivo>`, `--sequence N` (repetir a mesma = teste de idempotência), `--captured-at <ISO>` |

Exemplos:

```bash
pnpm dev:enroll-fake -- --photos 5 --fakes 100
pnpm dev:punch -- --image dev-data/probes/otavio/5.jpg
pnpm dev:punch -- --sequence 42     # rode duas vezes: mesmo receiptId, sem linha nova
```

**Por que a DEK de dev é fixa:** a engine guarda a DEK de cada conta em cache por 1 h e, enquanto isso, ignora a DEK enviada. Por isso a DEK de dev é derivada da `MASTER_KEY` (sempre a mesma), e o `dev:enroll-fake` invalida o cache de embeddings da engine para cada pessoa gravada. Em produção cada conta tem DEK aleatória em `chaves_conta`.

### 2.1 Configuração manual (se não quiser o `setup:dev`)

Copie `.env.example` → `.env` (raiz) e `apps/collector-api/.env.dev.example` → `apps/collector-api/.env.dev`, e troque todo `TROQUE_` (a api recusa subir com placeholder):

- `MASTER_KEY`: 64 hex (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), **igual** nos dois arquivos.
- `ENGINE_API_KEY`: igual nos dois arquivos.
- `COLLECTOR_SERVICE_KEYS`: uma ou mais chaves (≥ 32 caracteres), separadas por vírgula.
- Senhas dos papéis: `ARP_OWNER_PASSWORD`, `ARP_COLLECTOR_PASSWORD`, `ARP_CORE_PASSWORD`, `ARP_READER_PASSWORD` (banco `arp`), `RH_OWNER_PASSWORD` e `RH_API_PASSWORD` (banco `app`). Entram nas URLs do `.env.dev`, com a porta `POSTGRES_PORT`. Use só `[0-9a-f]`.

## 3. Subir pelo Docker: tudo ou uma parte

Todos os composes leem o **mesmo** `.env` da raiz. Cada pasta de serviço tem um `docker-compose.yml` de entrada (que inclui as dependências) e um `service.compose.yml` com a definição:

```bash
docker compose up -d                              # da raiz: tudo
cd apps/collector-api   && docker compose up -d   # coletor + postgres, valkey, engine, rep-core e jobs
cd apps/api             && docker compose up -d   # api do RH + postgres e migrations do Drizzle
cd apps/rep-core        && docker compose up -d   # rep-core + postgres e valkey
cd apps/jobs            && docker compose up -d   # resgate + postgres e valkey
cd services/face-engine && docker compose up -d   # só a engine
cd db                   && docker compose up -d   # só o Postgres (papéis, bancos, migrations do arp)
cd packages/queue       && docker compose up -d   # só o Valkey
```

O Compose deduplica o que várias partes incluem: sempre **um** Postgres, **um** Valkey, **uma** engine. As portas ficam em `127.0.0.1`: Postgres 5432, Valkey 6379, engine 8001, coletor 3001, api do RH 3002 (mudam pelo `.env`).

Containers e volumes (`docker ps`, `docker volume ls`):

| Container | O que é |
|---|---|
| `genus-postgres-arp-app` | Um único Postgres com os **dois** bancos: `arp` (fiscal, REP-P: batidas) e `app` (operacional, portais de RH). Separados por banco e por papel, não por container. Dados no volume `genus-postgres-arp-app-dados` |
| `genus-db-roles` | Roda a cada `up`, sai sozinho: cria os papéis e os bancos que faltam (`db/postgres/bootstrap.sh`, idempotente) |
| `genus-arp-migrate` · `genus-rh-migrate` | Aplicam as migrations do `arp` (`db/arp`) e do `app` (Drizzle, `apps/api/drizzle`) e saem |
| `genus-valkey` | Fila das batidas. Volume `genus-valkey-dados` |
| `genus-face-engine` | Motor facial. Modelos no volume `genus-face-engine-modelos` |
| `genus-rep-core` · `genus-jobs` | Worker do NSR e resgate. Sem HTTP: o healthcheck lê o arquivo de sinal de vida que o processo atualiza a cada 5 s |
| `genus-collector-api` · `genus-api` | API do coletor e API do portal de RH |

**Ordem e saúde.** `postgres` (saudável) → `db-roles` → migrations → apps. A engine tem de estar saudável antes de a api do coletor subir. `docker compose ps` mostra `healthy` quando o healthcheck passa.

**Recursos (prioridade para o banco e a engine).** Banco e engine: `cpu_shares: 2048`, memória reservada e `oom_score_adj: -500` (os últimos a serem mortos por falta de RAM); a engine tem teto de 1 vCPU (a medida do benchmark). Valkey, rep-core e as apis: `cpu_shares: 1024`. O resgate: 256. Ajustes pelo `.env`: `POSTGRES_MEM_LIMIT`, `ENGINE_MEM_LIMIT`, `ENGINE_CPUS`. Os processos Node rodam com sistema de arquivos somente leitura, sem capacidades e sem privilégios novos.

Para abrir um dos bancos: `docker exec -it genus-postgres-arp-app psql -U <POSTGRES_USER> -d arp` (ou `-d app`).

Pontos de atenção:

- **Senha do superusuário (`POSTGRES_PASSWORD`) trocada com o volume já criado:** o Postgres só a lê na primeira subida. Recrie o volume (`docker compose down -v`, apaga os dados locais) ou mantenha a senha antiga no `.env`. Papéis de aplicação novos (ou os do RH) não pedem isso: o `db-roles` cria o que falta e **não altera** senha de papel existente. Sintoma de senha trocada: a migration falha com "senha recusada (28P01)".
- A primeira subida da engine baixa os modelos ONNX. Pode levar alguns minutos. O healthcheck tem tolerância de 300 s.
- Verifique a engine com `curl http://127.0.0.1:8001/health`. O esperado é `"status": "ok"`. Veja também `docs/face-engine.md` §3.
- Migration nova do RH: `docker compose up --build rh-migrate` (dentro de `apps/api`). Migration nova do arp: `docker compose up --build arp-migrate` (dentro de `db`).

## 4. Aplicar a migration do banco arp

```bash
pnpm install
pnpm db:migrate:arp                      # dev: lê apps/collector-api/.env.dev
pnpm db:migrate:arp -- --env homolog     # lê apps/collector-api/.env.homolog
pnpm db:migrate:arp -- --env prod        # lê apps/collector-api/.env.prod
pnpm db:migrate:arp -- --env-file <arq>  # arquivo explícito
```

O comando lê `ARP_MIGRATION_DATABASE_URL` do arquivo do ambiente escolhido (padrão: `APP_ENV` do shell ou `dev`). Se a variável estiver exportada no shell, ela vence o arquivo. A URL usa o papel `arp_owner` e a porta `POSTGRES_PORT` do `.env` da raiz. Nunca use `arp_collector` para migrar. O comando mostra de qual arquivo leu a URL, sem imprimir o valor.

A migration aplicada não muda mais. Nova alteração de banco vira uma nova migration.

## 5. Rodar a api do coletor

```bash
pnpm dev
```

O script `dev` lê `apps/collector-api/.env.dev` e recarrega ao salvar. A api sobe na porta `PORT` (3001).

| Endereço | O que é |
|---|---|
| `http://localhost:3001/health` | Estado da api, do banco e da engine (sem chave) |
| `http://localhost:3001/docs` | **Swagger** (OpenAPI 3) com todas as rotas, o corpo multipart da batida, os erros e a chave `X-Service-Key` (botão Authorize) |
| `http://localhost:3001/docs/json` | O documento OpenAPI em JSON |

O Swagger **não é público**: só existe com `APP_ENV=dev` (em homolog e prod as rotas nem são montadas) e, mesmo em dev, só responde a chamadas da própria máquina (127.0.0.1/::1). De outra máquina, 404.

Se a engine estiver fora, a api continua no ar e responde `fallback_required` para as batidas. Isso é esperado.

### 5.1 Login no portal de RH (api do RH, porta 3002)

A api do RH exige `BETTER_AUTH_SECRET` no `.env` da raiz. **Depois de atualizar o repositório, rode `pnpm setup:dev` uma vez**: ele gera o segredo sem mexer no que já existe. Sem ele, o `docker compose up` para com a mensagem `Defina BETTER_AUTH_SECRET...`, em vez de subir a api quebrada.

Não há cadastro público. Crie o primeiro usuário pelo script (a senha vem de `NEW_USER_PASSWORD` ou é gerada e mostrada uma vez):

```bash
pnpm rh:create-user -- --email admin@empresa.dev --name "Admin" --role admin --tenant 1
pnpm rh:create-user -- --email root@genus.dev --name "Root" --role super_admin   # precisa ativar o 2FA no 1º login
```

Fluxo: `POST /auth/sign-in/email` `{ email, password }` devolve o cookie `genus.session_token`; `GET /me` mostra o usuário. Para cliente sem cookie, `GET /auth/token` devolve um JWT de 15 min, usado como `Authorization: Bearer <jwt>`. 2FA: `POST /auth/two-factor/enable` `{ password }` devolve o `totpURI` (QR no app autenticador) e `POST /auth/two-factor/verify-totp` `{ code }` confirma.

## 6. Testes e verificações

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

`pnpm -r test` exige o Docker em execução. Os testes de banco sobem um Postgres temporário com Testcontainers. Ele não usa o Compose do projeto.

### CI/CD (GitHub Actions)

`.github/workflows/ci-cd.yml` roda os mesmos comandos em todo PR para a `main` e em todo push nela (o pytest da engine só quando `services/face-engine/` muda). No push para a `main`, se os testes passarem, dispara o deploy no Easypanel **só dos serviços cuja imagem mudou**: cada serviço Node depende da própria pasta em `apps/` e de `packages/shared`, `packages/queue`, `db/arp`, `docker/node.Dockerfile` e do lockfile; o portal, de `apps/portal` e do lockfile; a engine, de `services/face-engine`. Os gatilhos ficam nos segredos `EASYPANEL_DEPLOY_<SERVIÇO>` do repositório (`API`, `COLLECTOR_API`, `FACE_ENGINE`, `JOBS`, `PORTAL`, `REP_CORE`). Para refazer o deploy de tudo: Actions → CI/CD → Run workflow com `deploy_all`. No Easypanel, o deploy automático por push precisa ficar desligado, senão todo serviço rebuilda a cada commit.

**A VPS não builda nada.** Cada imagem é construída no runner do GitHub e publicada no GHCR como `ghcr.io/tavinv/genus-<serviço>` (`api`, `collector-api`, `face-engine`, `jobs`, `portal`, `rep-core`), com as tags `latest` e o SHA do commit. Só depois disso o workflow chama o gatilho do Easypanel, que baixa a `latest` e reinicia o serviço. Buildar na VPS (1 vCPU) com vários serviços ao mesmo tempo levava a CPU a 100% e derrubava também os outros sistemas da máquina. Para voltar a uma versão anterior, troque a tag `latest` pelo SHA no serviço do Easypanel. Os endereços internos que o Next fixa no build do portal (`API_URL`, `COLLECTOR_URL`) estão no próprio workflow.

Configuração de cada serviço no Easypanel (feita uma vez):

1. No GitHub, crie um token clássico só com `read:packages` (as imagens são privadas).
2. Em cada serviço (api, collector-api, face-engine, jobs, portal, rep-core): **Fonte → Imagem Docker**, imagem `ghcr.io/tavinv/genus-<serviço>:latest`, usuário do GitHub e o token como senha.
3. O comando de cada serviço continua o mesmo (a imagem mantém o `WORKDIR` da pasta do serviço).

## 7. Postman

A coleção está em YAML (Postman Collection v3) em `postman/collections/Genus Coletor/`, com os environments em `postman/environments/*.environment.yaml`. Guia completo: [`conventions/api-testing.md`](conventions/api-testing.md).

```bash
pnpm postman:test                    # Postman CLI: sobe o stub da engine e a api, roda as pastas automáticas
pnpm postman:test -- --real-engine   # com a engine real (pnpm dev:up antes)
```

Para importar no Postman: `pnpm postman:export` e arraste os dois arquivos de `postman/export/` no Import. Ou, no modo Git: abra a **pasta do repositório** (o `.postman/resources.yaml` registra a coleção e os environments), ponha a Working directory na raiz do repositório, escolha o environment `dev` e preencha `serviceKey` com a primeira chave de `COLLECTOR_SERVICE_KEYS` do `.env.dev`. A pasta **Rosto real** faz uma batida com a sua foto.

## 8. Benchmark

```bash
pnpm bench:punch -- --n 50 --concurrency 4                                       # imagem sintética
pnpm bench:punch -- --n 50 --concurrency 4 --image dev-data/probes/<pessoa>/<foto>.jpg   # rosto real
```

- Sem `--image`, a imagem é sintética: mede só decodificação e **detecção** (a engine para em `no_face`).
- Com uma foto de `dev-data/probes/` (depois do `dev:enroll-fake`), mede o pipeline completo: detecção, liveness, embedding e comparação com os candidatos.
- **`dev-data/` nunca vai ao Git.** Tem rostos e embeddings. Não copie essas fotos para outras pastas do repositório.

## 9. Trocar de ambiente

| Ambiente | `APP_ENV` | Arquivo de exemplo | Arquivo real |
|---|---|---|---|
| Desenvolvimento | `dev` | `.env.dev.example` | `.env.dev` |
| Homologação | `homolog` | [A CONFIRMAR] sem exemplo nesta entrega | `.env.homolog` |
| Produção | `prod` | `.env.prod.example` | `.env.prod` |

- `APP_ENV` deve bater com o nome do arquivo. A api valida as variáveis no start e para com uma mensagem clara se alguma estiver errada.
- Os scripts `dev` e `dev:enroll-fake` leem `.env.dev`. O script `start` não lê arquivo. Para outro ambiente, exporte as variáveis ou passe o arquivo ao `tsx` (por exemplo, `--env-file=.env.homolog`).

**Travas de produção.** Em `APP_ENV=prod`, a api **recusa subir** se houver:

- `FAKE_CANDIDATES_ENABLED=true`;
- `EXPOSE_TIMINGS=true`;
- uma chave em `COLLECTOR_SERVICE_KEYS` com menos de 32 caracteres.

Nesta entrega não há provedor real de candidatos. Com `FAKE_CANDIDATES_ENABLED=false`, como no `.env.prod.example`, a api **não sobe em prod**. Isso é esperado até o provedor real existir.

## 10. Logs e tempos

Cada batida gera um log `punch_recognition` (Pino, JSON, sem CPF). Os campos principais:

| Campo | Conteúdo |
|---|---|
| `receiptId` | Id do recibo da batida |
| `traceId` | Id de correlação |
| `outcome` | `registered` ou `fallback_required` |
| `reason` | Motivo quando o resultado é `fallback_required` |
| `candidateCount` | Quantidade de candidatos enviados à engine |
| `timingsMs` | Tempo de cada etapa: `validate`, `candidates`, `engineRoundTrip`, `engineProcessing`, `engineStages`, `dbInsert`, `total` |

Em dev, o nível é `debug` (`LOG_LEVEL`). Para ver a latência de uma requisição sem abrir o log, leia o header `Server-Timing` da resposta. Ele lista as etapas em ms: `validate`, `candidates`, `engine`, `engine-processing`, `db` e `total`.

Com `EXPOSE_TIMINGS=true` (só dev), o corpo da resposta também traz `meta.timings`. Esse campo nunca vai a produção.

## 11. Papéis e Valkey

- **Papéis dos bancos.** `arp_owner` (só migrations), `arp_collector` (api do coletor), `arp_core` (rep-core, única escrita em `registros`, `evidencias` e `outbox`) e `arp_reader` (leitura, resgate e verificação) no banco `arp`; `rh_owner` (migrations) e `rh_api` (runtime) no banco `app`. As senhas estão no `.env` da raiz (`ARP_OWNER_PASSWORD`, ..., `RH_OWNER_PASSWORD`, `RH_API_PASSWORD`).
- **Papéis e bancos novos em volume antigo.** O serviço `db-roles` (`db/postgres/bootstrap.sh`) roda a cada `docker compose up`: cria só o que falta e não altera senha existente. Você não precisa rodá-lo à mão.
- **Valkey (fila das batidas).** Serviço `valkey` (`genus-valkey`, versão fixada, AOF e `noeviction`). A senha é `VALKEY_PASSWORD` no `.env` da raiz. Ela é obrigatória: o servidor exige autenticação.
- **Porta do Valkey no host.** Publicada só em `127.0.0.1:${VALKEY_PORT}` (padrão 6379), para os processos que rodam no host (`pnpm dev`, `pnpm queue:inspect`).
- Se trocar `POSTGRES_PASSWORD` ou a senha de um papel que já existe depois da primeira subida, o volume precisa ser recriado (`down -v`, como descrito em §3): o `db-roles` só cria o que falta e não troca senha de papel existente.

## 12. Fila, worker e resgate

A batida passa por três processos, além do Postgres e do Valkey. `pnpm dev` sobe os três de uma vez:

| Processo | Comando | O que faz |
|---|---|---|
| api do coletor | `pnpm dev` | Grava a batida em `entradas` (`pendente`) e publica o id na fila `punches` depois do COMMIT |
| rep-core | `pnpm dev:rep-core` | Worker: consome `punches`, atribui NSR e hash, grava `registros`, `evidencias` e `outbox` numa só transação |
| jobs | `pnpm dev:jobs` | Resgate: a cada 20 s republica `entradas` e `outbox` pendentes há mais de 30 s |

Para depurar um processo isolado, `pnpm dev:rep-core` e `pnpm dev:jobs` continuam existindo. O uso normal é `pnpm dev`.

**Quem lê qual `.env.dev`.**
- `apps/collector-api/.env.dev` é o arquivo compartilhado: a api, o `pnpm queue:inspect` e os scripts `start` do rep-core e dos jobs (`--env-file-if-exists`) leem o seu `VALKEY_URL`, `VALKEY_PASSWORD` e as URLs do banco.
- `pnpm setup:dev` também gera `apps/rep-core/.env.dev` (`ARP_CORE_DATABASE_URL`) e `apps/jobs/.env.dev` (`ARP_READER_DATABASE_URL`). **Hoje os scripts `dev:rep-core`, `dev:jobs` e `arp:verify-chain` não leem esses dois arquivos.** Até isso ser corrigido, exporte no shell as variáveis que faltarem (`ARP_CORE_DATABASE_URL`, `ARP_READER_DATABASE_URL`) antes de rodar: variável já definida no ambiente tem precedência sobre o arquivo.
- A senha do Valkey vai em `VALKEY_PASSWORD`. Nunca coloque senha dentro de `VALKEY_URL`: a configuração recusa a subida.

**Inspecionar as filas.**

```bash
pnpm queue:inspect
```

Mostra, para `punches` e `post-punch`, a contagem de jobs por estado (`waiting`, `active`, `delayed`, `completed`, `failed` etc.) e a profundidade da `post-punch` (`waiting` + `delayed` + `active`). Avisa quando a profundidade passa de `POST_PUNCH_DEPTH_WARN` (padrão 10000). A senha não é impressa. Códigos de saída: `0` ok, `2` configuração inválida, `1` o Valkey não respondeu.

**A `post-punch` cresce sem consumidor. Isso é esperado nesta rodada.** Cada batida gera três jobs `waiting` nessa fila e três linhas `pendente` no `outbox`, porque ainda não existem os consumidores (PDF, jornada, QR). Não é erro, e não se deve criar consumidor falso que marque o `outbox` como processado. Com a política `noeviction` do Valkey, se a memória encher, ele recusa escritas; acompanhe com `pnpm queue:inspect`.

## 13. Variáveis novas da api do RH

`pnpm setup:dev` gera ou copia todas elas; rode uma vez depois do pull.

| Variável | Para quê |
|---|---|
| `PIN_PEPPER` (64 hex, no `.env` da raiz) | PIN do colaborador no totem. Obrigatória: sem ela a api não sobe |
| `ARP_READER_DATABASE_URL` | leitura das batidas do arp para a apuração (papel `arp_reader`, só SELECT) |
| `ENGINE_URL`, `ENGINE_API_KEY` | cadastro facial no totem (`POST /embeddings/register`). Sem elas o cadastro responde 503 |
| `ATTACHMENTS_DIR`, `MAX_ATTACHMENT_BYTES` | atestados em disco (volume `rh-anexos` no Docker; `apps/api/data/` fora do Git) |
| `PORTAL_GESTOR_ENABLED` | liga o perfil gestor no portal (padrão `false`) |
