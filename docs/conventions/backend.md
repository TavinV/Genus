# Convenções de backend (TypeScript + Fastify)

> Estrutura-alvo de `apps/api`. O código ainda não existe neste repositório; este documento é o contrato para quando existir. Base: `visage/.claude/development.md` (serviços OOP, `{ error, code }`, Pino, `tenant_id` em toda query), adaptado a Fastify + Zod + Drizzle.

---

## 1. Stack

| Item | Escolha | Observação |
|---|---|---|
| Runtime | Node.js LTS vigente | Fixar em `.nvmrc` e no Docker |
| Linguagem | TypeScript `strict: true`, `noUncheckedIndexedAccess: true` | Sem `any` implícito, sem `!` desnecessário |
| HTTP | Fastify 5 | Plugins e decorators, não middleware global |
| Validação | Zod + `fastify-type-provider-zod` | Um schema serve ao tipo, à validação e à documentação |
| Banco | Drizzle (`app`); SQL puro no `rep-core` | Ver `database.md` |
| Fila | BullMQ + Valkey, **com outbox no Postgres** | A fila transporta; o banco é a verdade (`02` §5) |
| Arquivos | `@aws-sdk/client-s3` | Upload por URL assinada, não por stream pela API |
| Logs | Pino (o logger nativo do Fastify) | JSON |
| Testes | Vitest · Testcontainers (Postgres real) · Playwright · k6 | |
| Login | Better Auth (`02` §2) | **[A CONFIRMAR]** integração com multi-tenant e com `session_id` da auditoria |

## 2. Estrutura de pastas

```
apps/api/src/
  server.ts            sobe o servidor
  app.ts               monta plugins e módulos (testes usam este, sem porta)
  container.ts         composição: cria repositórios e services com as dependências
  config/env.ts        variáveis de ambiente validadas com Zod (falha ao subir se faltar)
  plugins/             auth, request-context, authorize, audit, errors, rate-limit, openapi
  modules/<nome>/
    routes.ts          rotas finas
    schemas.ts         Zod: params, query, body, resposta (DTO)
    service.ts         casos de uso (classe, dependências injetadas)
    repository.ts      acesso ao banco (Drizzle); todo método exige tenantId
    events.ts          eventos publicados e consumidos
    rules/             funções puras (cálculo, validação de regra)
    index.ts           plugin Fastify do módulo
  jobs/                workers BullMQ; um arquivo por fila
  lib/                 db, s3, queue, outbox, crypto, clock, audit-events, redact
  db/schema/           Drizzle, um arquivo por domínio (aqui o banco em português vira código em inglês)
  db/seeds/            dados iniciais idempotentes
packages/
  timekeeping-rules/   regras puras de jornada (usadas pela API e pelos workers)
```

### 2.1 Banco em português, código em inglês

- O **banco** é em português (`colaboradores.data_admissao`); o **código** é em inglês (`employee.admissionDate`). **Só o Drizzle traduz**: o schema em `db/schema/` mapeia cada coluna (nome em português) para uma propriedade (inglês), pelas regras de `database.md` §12. Fora dele, ninguém escreve nome de coluna em português.
- **Valores de enumeração não se traduzem.** `status` vale `'pendente'` no banco, no código (`type Status = 'pendente' | 'aprovado' | ...`) e no JSON. Papéis: `super_admin`, `admin`, `rh`, `gestor`, `colaborador`, `contador`.
- Rotas, chaves de JSON, eventos (`employee.terminated`), filas e jobs (`recalculate-day`) ficam em inglês.
- SQL escrito à mão (no `rep-core`, em migrations do `arp` e em relatórios) usa os nomes em português do banco.

## 3. Camadas e injeção

**Rota (fina) → service → repository.** A rota valida, chama o service e devolve. Não tem regra de negócio nem SQL.

- **Service é classe** (como na Visage), mas recebe as dependências no construtor e é criado **uma vez no `container.ts`**. Sem singleton de módulo (`export const x = new X()`): ele impede trocar dependência em teste.
- **Repository** só fala com o banco. Recebe `tx` ou `db`, nunca decide regra. Todo método tem `tenantId` como primeiro argumento de dado.
- **Regras puras** (`rules/`, `packages/`) não importam banco, relógio, fila nem logger. Entram dados, saem dados.

```ts
// modules/adjustments/routes.ts  (ilustrativo)
export const adjustmentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/adjustment-requests/:id/approve', {
    preHandler: [app.authorize('rh', 'gestor')],
    schema: {
      params: z.object({ id: idSchema }),
      body: z.object({ decisionNote: z.string().max(500).optional() }),
      response: { 200: z.object({ data: adjustmentRequestDto }) },
    },
  }, async (req) => ({
    data: await app.services.adjustments.approve(req.ctx, req.params.id, req.body),
  }));
};

// modules/adjustments/service.ts  (ilustrativo)
export class AdjustmentService {
  constructor(private readonly d: { db: Db; repo: AdjustmentRepository; audit: AuditService; outbox: Outbox; clock: Clock }) {}

  async approve(ctx: RequestContext, id: number, input: ApproveInput) {
    return this.d.db.transaction(async (tx) => {
      const request = await this.d.repo.getPendingForUpdate(tx, ctx.tenantId, id);
      ctx.assertCanDecide(request);               // escopo da equipe; ninguém decide o próprio pedido
      const approved = await this.d.repo.approve(tx, ctx.tenantId, id, { decidedById: ctx.userId, decidedAt: this.d.clock.now(), ...input });
      await this.d.audit.recordChange(tx, ctx, 'adjustment.approved', { before: request, after: approved });
      await this.d.outbox.publish(tx, 'recalculate-day', { employeeId: request.employeeId, workDate: request.workDate });
      return toAdjustmentDto(approved);
    });
  }
}
```

## 4. Contexto da requisição, autenticação e escopo

- O plugin `request-context` monta `req.ctx` = `{ tenantId, userId, employeeId?, role, sessionId, teamScope }` **a partir da sessão**. `tenantId` jamais vem do corpo, da query ou de header do cliente.
- O mesmo contexto vai para o `AsyncLocalStorage`, e a auditoria lê o ator de lá.
- **Papéis** (`usuarios.papel`): `super_admin` (operação do Genus) · `admin` (administrador do cliente: empresa, usuários, parâmetros) · `rh` (RH do cliente) · `gestor` · `colaborador` · `contador` (só leitura e download). Quem acumula papéis tem a soma dos escopos. Alcance de cada um em `04` §1.4 e §7.1.
- **Escopo por estabelecimento** (`establishmentScope`): vem de `usuarios_estabelecimentos`; sem linha, vale a conta inteira. Todo repository que lista dados de colaborador aplica esse filtro além do `tenantId`.
- `app.authorize(...roles)` barra por papel. **Escopo de equipe** (`teamScope`) barra por dado: o gestor só enxerga colaboradores com `gestor_id = ctx.employeeId` **[A DECIDIR]** se herda a hierarquia abaixo ou só diretos.
- Rotas do funcionário ficam em `/me/*` e **ignoram qualquer `employeeId` recebido**: usam `ctx.employeeId`.

## 5. Validação e serialização

- Todo `params`, `query`, `body` e **`response`** tem schema Zod.
- O schema de **resposta** é um DTO explícito: ele **remove** o que não deve sair (colunas `_cifrado`, `_hash`, `conta_id`, `criado_por_id` quando irrelevante). Nunca devolva a linha do banco.
- IDs `BIGINT` trafegam como `number`. IDs públicos são UUID (string).
- Datas em JSON: `DATE` como `"2026-11-25"`; instante como ISO 8601 UTC (`"2026-11-25T11:00:00.000Z"`); hora do dia como `"HH:MM"`; duração como inteiro em minutos (`workedMinutes`).

## 6. Contrato HTTP

| Tema | Regra |
|---|---|
| Prefixo | O nginx roteia `/portal` para esta API. As rotas aqui são escritas **sem** o prefixo |
| Caminho | `kebab-case`, plural: `/adjustment-requests`, `/time-bank/entries` |
| Verbos | `GET` lê · `POST` cria · `PATCH` altera parcialmente · `DELETE` só onde a regra permite apagar (raro; ver abaixo) |
| Ações | `POST /recurso/:id/approve`, `/reject`, `/cancel`, `/close`, `/reopen`. Ação é verbo no fim do caminho |
| Registro legal | Não tem `DELETE`. Muda de estado (`canceled`, `terminated`, `reversed`) |
| JSON | Chaves em `camelCase` inglês; **valores de enumeração em português** (`"status": "pendente"`) |
| Sucesso | `{ "data": ... }` |
| Lista | `{ "data": [...], "meta": { "page": 1, "pageSize": 50, "total": 120 } }`. Query: `page`, `pageSize` (máx. 200), `sort=campo` ou `-campo`, filtros por nome do campo |
| Erro | `{ "error": "Mensagem em pt-BR", "code": "UPPER_SNAKE", "details"?: [...] }` |
| Códigos HTTP | 400 validação (`VALIDATION_ERROR`) · 401 · 403 (`FORBIDDEN`) · 404 · 409 conflito de estado (`INVALID_STATE`, `PERIOD_CLOSED`) · 422 regra de negócio · 429 |
| Idempotência | `POST` que cria registro legal aceita `Idempotency-Key`; repetir devolve o mesmo resultado |
| Documentação | OpenAPI gerado dos schemas Zod, publicado só fora de produção |

Erros do domínio são `AppError(code, httpStatus, message)`; o handler global converte. Nunca devolva stack, SQL ou texto de exceção ao cliente.

## 7. Tempo e fusos

- Nunca `new Date()` ou `Date.now()` em service: injete `Clock` (`clock.now()`), para testar virada de dia e de período.
- **Dia de trabalho:** `workDateOf(instant, establishment.timezone)`. Um turno noturno que termina às 05:00 pertence ao `data_trabalho` em que **começou**.
- O banco guarda UTC. A conversão para o relógio local acontece nas regras, usando o fuso do estabelecimento (`America/Sao_Paulo` é só o default).
- Hora legal: servidores sincronizam com o Observatório Nacional (`02` §7). Não use o relógio do aparelho como verdade.

## 8. Transações, outbox e jobs

- **Efeito colateral entra na mesma transação** que a mudança: grave a linha no `outbox`, faça `COMMIT`, **depois** publique na fila. Nunca publique dentro da transação (`02` §5).
- Jobs: filas em `kebab-case` inglês (`recalculate-day`, `analyze-certificate`). `jobId` **determinístico** (`recalculate-day:{employeeId}:{workDate}`), para duplicata virar no-op.
- Handler **idempotente**: rodar duas vezes dá o mesmo resultado (ledger por `UNIQUE` na origem; PDF no mesmo caminho do S3).
- Payload pequeno: **IDs**, nunca o objeto nem dado sensível.
- Retry com backoff; depois de N tentativas vai para `failed`, gera alerta e fica reprocessável.
- Todo cálculo agendado (vencimentos, feriados do ano) é um job, não um `setInterval` na API.

## 9. Regras puras de jornada

- Moram em `packages/timekeeping-rules` (ou `modules/timekeeping/rules`). Entrada: marcações do dia, escala, feriado, tratamentos aprovados, afastamento, parâmetros do tenant. Saída: `DayResult` com minutos por categoria e inconsistências.
- Testes por **tabela de casos** (golden files): 5x2 simples, intervalo faltando, marcação ímpar, 12x36, turno noturno cruzando a meia-noite, feriado trabalhado, tolerância de 5/10 minutos, hora noturna reduzida, abono, afastamento.
- Mudança de regra gera **nova versão** (`calc_version`); linhas antigas continuam reproduzíveis.

## 10. Arquivos (S3)

- O cliente pede `POST /<recurso>/uploads` e recebe uma **URL assinada de PUT** (vida de 5 min, tamanho e `Content-Type` fixados). Depois confirma com `POST /<recurso>/:id/complete`; a API confere tamanho e SHA-256 do objeto.
- Servir arquivo: URL assinada de **GET** com vida curta, e o acesso gera evento de auditoria.
- Chave do objeto: `contas/{contaId}/{dominio}/{aaaa}/{uuid}` (ex.: `contas/42/atestados/2026/…`). Nunca use o nome original do arquivo na chave.

## 11. Logs

- Pino, JSON, com `reqId`, `tenantId`, `userId`, `action`. Nada de `console.log`.
- **Nunca logar:** CPF completo (use `***.***.***-12`), CID, texto de OCR, embeddings, tokens, chaves, corpo de requisição de upload.
- Erro de negócio esperado é `info`/`warn`; só o inesperado é `error`.

## 12. Testes

| Camada | Ferramenta | O que cobrir |
|---|---|---|
| Regras puras | Vitest | Tabela de casos, sem I/O |
| Repository e rota | Vitest + Testcontainers (Postgres real) | Isolamento de tenant (tenant A não lê nem liga a B), constraints, transições de status |
| Imutabilidade do `arp` | Vitest | `UPDATE`/`DELETE` falham |
| Concorrência do NSR | k6 | 200 batidas simultâneas no mesmo estabelecimento: NSR sem buracos e cadeia de hash íntegra |
| Portais | Playwright | Fluxos de aprovação ponta a ponta |

Todo módulo novo tem pelo menos um teste de **isolamento de tenant** e um de **escopo de equipe**.

## 13. Lista de verificação antes de abrir PR

- [ ] Toda query filtra `conta_id` (repository exige `tenantId`).
- [ ] Nomes e tipos de coluna seguem `database.md` §4.
- [ ] Resposta passa por DTO; nenhum campo cifrado ou interno vaza.
- [ ] Ação sensível registra auditoria (inclusive leitura de dado de saúde).
- [ ] Nada altera ou apaga marcação do `arp`; tratamento é só acréscimo.
- [ ] Efeito colateral vai pelo outbox, e o job é idempotente.
- [ ] Nenhum `any`, `console.log`, segredo ou `new Date()` solto.
- [ ] Documento do módulo em `docs/architecture/04-funcionalidades-rh.md` atualizado.
