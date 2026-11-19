# Convenções de banco de dados (PostgreSQL)

> Vale para os dois bancos lógicos (`app` e `arp`). Regra de ouro: **um conceito, um padrão de nome e de tipo**. Se uma coluna nova não cabe em nenhuma linha da tabela da §4, a convenção é que está incompleta: atualize este documento no mesmo commit.
> Base: o schema da Visage (`visage/.claude/database.md`), com as inconsistências corrigidas e **os identificadores do banco em português** (§15).

---

## 1. Princípios

1. **Banco em português:** tabelas, colunas, constraints, índices e funções em `snake_case`, **sem acento nem cedilha** (`ç` → `c`, `ã` → `a`): `configuracoes_empresa`, `periodos_ferias`. Os **valores** de enumeração também (`pendente`, `aprovado`).
2. **Código em inglês:** TypeScript, rotas, chaves de JSON, nomes de evento, de fila e de job continuam em inglês. **Quem traduz é o Drizzle**, num só lugar (`apps/api/src/db/schema/`), conforme a §12. O contrato do serviço Python (`face-engine`) segue em inglês, herdado da Visage (`tenant_id`, `person_id`).
3. **Siglas e termos consagrados ficam como são:** `cpf`, `cnpj`, `nsr`, `afd`, `aej`, `dsr`, `cid`, `crm`, `inpi`, `uf`, `ip`, `outbox`, `hash`, `sha256`, `mime`, `id`, `status`.
4. **O tipo diz a unidade.** Duração em minutos inteiros, dinheiro em `NUMERIC`, dia em `DATE`, instante em `TIMESTAMPTZ`. Nunca `FLOAT` para dinheiro ou tempo.
5. **O prefixo ou sufixo diz o tipo.** Quem lê `aprovado_em` sabe que é `TIMESTAMPTZ`; quem lê `data_trabalho`, que é `DATE`.
6. **Dado fiscal e dado de auditoria não se alteram.** Correção é um novo registro, nunca um `UPDATE`.
7. **Sem soft delete.** O estado de vida é explícito (`status`, `data_fim`, `eh_ativo`).
8. **O banco defende o que o código esquece:** `NOT NULL`, `CHECK`, `UNIQUE`, FK e exclusion constraints no schema, não só na validação.

## 2. Dois bancos

| Banco | Papel | Regras extras |
|---|---|---|
| `arp` | Armazenamento de Registro de Ponto (fiscal) | Só o `rep-core` tem INSERT. Trigger recusa `UPDATE`/`DELETE` em `registros` e `evidencias`. Demais serviços: somente leitura. Migrations escritas à mão em SQL, com teste da imutabilidade |
| `app` | Operacional: cadastros, apuração, pedidos, atestados, banco de horas, fechamento | Tudo desta convenção. Acesso por Drizzle |

O `app` nunca copia marcações do `arp`. Referencia por `(estabelecimento_id, nsr)` quando precisa apontar uma marcação original.

## 3. Nomes

| Objeto | Regra | Exemplo |
|---|---|---|
| Tabela | plural, `snake_case`, substantivo. Exceção: `outbox` (termo consagrado) | `colaboradores`, `pedidos_ajuste` |
| Tabela de ligação | os dois lados, no plural | `adesoes_banco_horas` |
| Ledger (só INSERT) | prefixo `lancamentos_` | `lancamentos_banco_horas` |
| Histórico com vigência | prefixo `historico_` | `historico_cargos_colaborador` |
| Catálogo | prefixo `tipos_` | `tipos_licenca` |
| Coluna | `snake_case`; no TypeScript vira `camelCase` em inglês (§12) | `conta_id` → `tenantId` |
| Chave primária | `pk_<tabela>` | `pk_colaboradores` |
| Chave estrangeira | `fk_<tabela>_<pai_no_singular>` | `fk_pedidos_ajuste_colaborador` |
| Unique | `uq_<tabela>_<colunas>` | `uq_colaboradores_conta_id_cpf` |
| Check | `ck_<tabela>_<o_que>` | `ck_colaboradores_status` |
| Exclusion | `ex_<tabela>_<o_que>` | `ex_escalas_colaborador_sem_sobreposicao` |
| Índice | `idx_<tabela>_<colunas>` | `idx_colaboradores_conta_id_status` |
| Função / trigger | verbo no infinitivo em português | `definir_atualizado_em()` |

Os prefixos `pk_`, `fk_`, `uq_`, `ck_`, `ex_` e `idx_` são abreviações padrão de SQL e ficam como estão.

## 4. Colunas padrão

| Conceito | Padrão | Observação |
|---|---|---|
| Chave primária | `id BIGINT GENERATED ALWAYS AS IDENTITY` | Sempre `BIGINT`, mesmo em tabela pequena: evita FK com tipos diferentes. No TypeScript, `mode: 'number'` |
| ID público | `id_publico UUID NOT NULL DEFAULT gen_random_uuid()` + `UNIQUE` | Só onde o ID sai do sistema (QR, link, URL assinada). O `id` sequencial nunca é exposto fora do portal autenticado |
| Conta (tenant) | `conta_id BIGINT NOT NULL`, **logo após `id`** | A conta é o cliente do SaaS (`contas`). Ver §6 |
| Chave estrangeira | `<tabela_no_singular>_id BIGINT` | Por papel quando há mais de uma ou é autorreferência: `gestor_id`, `pai_id`, `estabelecimento_id` |
| Instante | `<particípio>_em TIMESTAMPTZ` | `criado_em`, `aprovado_em`, `fechado_em`, `marcado_em`. Sempre UTC no banco |
| Dia | `data_<substantivo> DATE` | `data_trabalho`, `data_admissao`, `data_feriado`. Dia **no fuso do estabelecimento** |
| Hora do dia | `hora_<substantivo> TIME` | `hora_inicio`, `hora_inicio_intervalo`. Relógio local do estabelecimento |
| Vigência | `data_inicio DATE NOT NULL`, `data_fim DATE` | `NULL` = em aberto; `data_fim` é **inclusivo**. Ver §7 |
| Duração | `minutos_<o_que> INTEGER` | `minutos_trabalhados`, `minutos_atraso`, `minutos_extras`. Saldo pode ser negativo |
| Contagem de dias / meses | `dias_<o_que>` / `meses_<o_que> INTEGER` | `dias_ciclo`, `dias_prazo_atestado`, `meses_compensacao` |
| Dinheiro | `valor_<o_que> NUMERIC(12,2)` | `valor_salario`. Sempre BRL; moeda não é coluna |
| Taxa | `taxa_<o_que> NUMERIC(6,4)` | `taxa_hora_extra`. `0.5000` = 50% |
| Booleano | `eh_<estado>` ou `tem_<coisa>`, `NOT NULL DEFAULT` | `eh_ativo`, `tem_assinatura`. Sem `NULL`: três valores em booleano é bug |
| Texto | `TEXT` | Sem `VARCHAR(n)`. Limite, se a regra exigir, por `CHECK (char_length(x) <= n)` |
| Status | `status TEXT NOT NULL` + `CHECK` | Valores `snake_case` em português sem acento: `pendente`, `aprovado`, `rejeitado`, `cancelado`. Ver §9 |
| Discriminador | `tipo TEXT NOT NULL` + `CHECK` | Subtipo dentro da tabela. Com mais de um: `tipo_<o_que>` (`tipo_ator`, `tipo_alvo`) |
| Ator | `<particípio>_por_id BIGINT REFERENCES usuarios(id)` | `criado_por_id`, `decidido_por_id`. `NULL` = sistema |
| Motivo | `motivo` (quem pede) · `nota_decisao` (quem decide) | `nota_decisao` é o que o solicitante enxerga ao ser recusado |
| Estorno | `estorno_de_id BIGINT` | Em ledger: aponta o lançamento corrigido |
| Arquivo no S3 | `<nome>_chave TEXT` + `<nome>_sha256 BYTEA` + `<nome>_mime TEXT` + `<nome>_tamanho_bytes BIGINT` | `arquivo_chave`. A chave do objeto, **nunca URL**. A URL é assinada na hora de servir |
| Dado cifrado | `<nome>_cifrado BYTEA` | Envelope `iv ‖ tag ‖ ciphertext`; a versão da chave fica em `versao_chave SMALLINT` na tabela. Ver §10 |
| Hash / índice cego | `<nome>_hash BYTEA` | HMAC-SHA-256 para buscar por valor cifrado sem decifrar |
| JSON | `JSONB`, nomeado pelo conteúdo | `metadados`, `achados`, `parametros`. Nunca para dado relacional que se filtra ou junta |
| Nota / escore | `nota_<o_que>` | `nota_vivacidade REAL` (biometria); `nota_risco SMALLINT` 0–100 |
| CPF / CNPJ | `cpf CHAR(11)` · `cnpj CHAR(14)` | **Só dígitos**, `CHECK (cpf ~ '^[0-9]{11}$')`. Empregador pode ser pessoa física: `tipo_documento` (`cpf`/`cnpj`) + `documento` |
| Marcação de linha | `criado_em`, `atualizado_em`, `criado_por_id` | `atualizado_em` por trigger `definir_atualizado_em()`. Tabela só-INSERT **não** tem `atualizado_em` |

**Ordem das colunas na tabela:** `id`, `conta_id`, FKs, dados do negócio, status e seus carimbos, JSON/cifrados, `criado_em`, `atualizado_em`, `criado_por_id`.

## 5. Constraints e índices

- Todo `NOT NULL` que a regra de negócio exige **é** `NOT NULL` no banco.
- Todo conjunto fechado de valores é `CHECK (... IN (...))`, nomeado `ck_<tabela>_<coluna>`. Não use `ENUM` do Postgres: alterar enum em migration é doloroso.
- **Todo FK ganha índice.** Índices compostos começam por `conta_id`.
- Fila de pendências usa **índice parcial**: `CREATE INDEX idx_x ON x (conta_id, criado_em) WHERE status = 'pendente'`.
- `ON DELETE`: `RESTRICT` por padrão. `CASCADE` só em tabela-filha que não faz sentido sozinha. Nunca `CASCADE` a partir de `colaboradores` ou `contas`.

## 6. Multi-tenant

- Toda tabela de negócio tem `conta_id` e **toda `UNIQUE` o inclui**: `UNIQUE (conta_id, cpf)`, nunca `UNIQUE (cpf)`.
- **FK composta entre tabelas da mesma conta.** Toda tabela com `conta_id` tem `UNIQUE (conta_id, id)`; as filhas referenciam `(conta_id, pai_id)`. Assim um bug no código não consegue ligar um pedido da conta A a um colaborador da conta B.
- O repositório exige `tenantId` em **todo** método (`conta_id` no banco). Query sem ele não compila.
- **Exceção: catálogos globais** mantidos pelo Genus (feriados nacionais, licenças legais, regra legal de jornada) têm `conta_id NULL` = vale para todos. `CHECK`/permissão impedem a conta de alterar linha global; a leitura usa `conta_id = $1 OR conta_id IS NULL`. `UNIQUE` sobre colunas com `conta_id` nulável usa `NULLS NOT DISTINCT` (PostgreSQL 15+). A conta **acrescenta** as suas (feriado municipal, convenção coletiva) em linhas próprias.
- **Hierarquia do cliente:** `contas` → `empresas` (empregador) → `estabelecimentos` (local; tem sua sequência de NSR no `arp`). Colaborador pertence a um estabelecimento.
- **[A DECIDIR]** Row-Level Security como segunda barreira (`SET LOCAL app.conta_id` por transação). A Visage não usa. Recomendado avaliar após o MVP.

## 7. Vigência (histórico por período)

Para tudo que muda no tempo e precisa responder "qual valia na data X": escala do colaborador, regra de jornada, cargo/salário, política de banco de horas.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE escalas_colaborador (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY,
  conta_id           BIGINT NOT NULL,
  colaborador_id     BIGINT NOT NULL,
  modelo_id          BIGINT NOT NULL,
  data_ancora_ciclo  DATE   NOT NULL,
  data_inicio        DATE   NOT NULL,
  data_fim           DATE,                          -- NULL = em aberto; inclusivo
  -- ...
  CONSTRAINT ck_escalas_colaborador_periodo CHECK (data_fim IS NULL OR data_fim >= data_inicio),
  CONSTRAINT ex_escalas_colaborador_sem_sobreposicao EXCLUDE USING gist (
    conta_id       WITH =,
    colaborador_id WITH =,
    daterange(data_inicio, data_fim, '[]') WITH &&
  )
);
```

- Encerrar uma vigência é **atualizar `data_fim`** da linha aberta e inserir a nova no dia seguinte, na mesma transação.
- A consulta "vigente em D" é sempre `data_inicio <= D AND (data_fim IS NULL OR data_fim >= D)`. Encapsule em função do repositório; não reescreva à mão.

## 8. Ledger e tabelas só-INSERT

Banco de horas, trilha de auditoria, tratamentos de marcação, abonos e todo o `arp` seguem:

- **Só `INSERT` e `SELECT`.** Trigger `BEFORE UPDATE OR DELETE` levanta exceção.
- Correção = **novo lançamento** com `estorno_de_id` apontando o original, mais o lançamento certo.
- Recalcular algo já lançado grava **a diferença**, não substitui.
- Idempotência por `UNIQUE` sobre a chave de origem (`chave_origem`), para o job poder rodar duas vezes sem duplicar.
- O saldo é sempre derivado (`SUM`), nunca coluna mantida à mão.

## 9. Workflow de status

Pedido que passa por aprovação (ajuste, atestado, férias, folga compensatória) usa o mesmo molde:

| Coluna | Tipo | Sentido |
|---|---|---|
| `status` | `TEXT` + `CHECK` | `pendente` → `aprovado` / `rejeitado` / `cancelado` |
| `solicitado_por_id`, `solicitado_em` | `BIGINT`, `TIMESTAMPTZ` | Quem pediu e quando (`criado_em` pode servir) |
| `decidido_por_id`, `decidido_em` | `BIGINT`, `TIMESTAMPTZ` | Quem decidiu e quando |
| `nota_decisao` | `TEXT` | Motivo da decisão, visível ao solicitante |
| `cancelado_em` | `TIMESTAMPTZ` | Quando o solicitante desistiu |

`CHECK` amarra estado e carimbo: `status IN ('pendente','cancelado') OR (decidido_por_id IS NOT NULL AND decidido_em IS NOT NULL)`. A regra "ninguém decide o próprio pedido" fica no service **e** num `CHECK (decidido_por_id IS DISTINCT FROM solicitado_por_id)`.

**Papéis** (`usuarios.papel`): `super_admin`, `admin`, `rh`, `gestor`, `colaborador`, `contador`. Escopo por estabelecimento em `usuarios_estabelecimentos` (`04` §1.4).

## 10. Dados cifrados e arquivos

- **Biometria:** embeddings seguem o contrato da engine (`embedding_iv`, `embedding_tag`, `embedding_ct` e `versao_chave`): três colunas `BYTEA`, DEK da conta. É a **única** exceção ao padrão `_cifrado`, porque o nome espelha o contrato do serviço Python.
- **Dado de saúde** (CID, texto de OCR, nome extraído de atestado): coluna `<nome>_cifrado BYTEA`, mesma DEK da conta, AES-256-GCM, IV único por operação. Busca por igualdade, se necessária, via `_hash`.
- **CPF:** guardado em claro em `colaboradores.cpf` (o AFD/ARP exige e é chave de busca), protegido por controle de acesso e criptografia do volume. **[A DECIDIR]** O doc `02` §8 fala em cifrar CPF em repouso; CPF não é dado sensível pela LGPD, então a proposta é cifrar só saúde e biometria. Confirmar.
- **Arquivos:** só a `_chave` do objeto no banco. Prefixo no bucket: `contas/{conta_id}/<dominio>/<aaaa>/<uuid>` (ex.: `contas/42/atestados/2026/…`). Bucket privado, URL assinada de vida curta, sempre auditada. Ver `security-lgpd.md`.

## 11. Auditoria

Reaproveita o desenho de `audit_logs` da Visage como **`logs_auditoria`**:

- Só INSERT. Colunas: ator (`usuario_id`, `tipo_ator` = `usuario`|`dispositivo`|`sistema`|`anonimo`, `nome_ator`, `email_ator`, `papel_ator`), `sessao_id`, `acao` (`<dominio>.<verbo>`, do catálogo em `apps/api/src/lib/audit-events.ts`; **em inglês**, é chave de código), `categoria`, `severidade` (`info`/`aviso`/`critico`), `status` (`sucesso`/`falha`), alvo (`tipo_alvo`, `alvo_id`, `rotulo_alvo`; sem FK, o alvo pode ter sido excluído), `estado_antes`/`estado_depois` (`JSONB`), `campos_alterados TEXT[]`, origem (`endereco_ip`, `agente_usuario`, `metodo_requisicao`, `caminho_requisicao`), `detalhes` (frase em pt-BR), `metadados`, `criado_em`.
- **Segredo nunca entra no diff.** `redactDiff()` troca senha, hash, chave, token, embedding, **CID e texto de atestado** por `"[redigido]"` antes de gravar.
- **Leitura de dado sensível também é evento** (`certificate.viewed`, `certificate.file_downloaded`), não só alteração.
- Ator vem do `AsyncLocalStorage` da requisição, não é passado de mão em mão.

## 12. Tradução banco ↔ código

O banco é em português; o código, em inglês. **O Drizzle traduz** (`apps/api/src/db/schema/`): o primeiro argumento é o nome da coluna em português, a propriedade é o nome em inglês.

```ts
export const employees = pgTable('colaboradores', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  tenantId: bigint('conta_id', { mode: 'number' }).notNull(),
  fullName: text('nome_completo').notNull(),
  admissionDate: date('data_admissao').notNull(),
  createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
```

**Valores de enumeração não se traduzem:** `status = 'pendente'` é o mesmo no banco, no código e no JSON. Chaves de evento, fila e job (`employee.terminated`, `recalculate-day`) são identificadores de código e ficam em inglês.

### 12.1 Regras de tradução de colunas

| Banco | TypeScript / JSON | Exemplo |
|---|---|---|
| `conta_id` | `tenantId` | |
| `<particípio>_em` | `<particípio em inglês>At` | `aprovado_em` → `approvedAt`, `criado_em` → `createdAt` |
| `data_<x>` | `<x>Date` | `data_trabalho` → `workDate` |
| `hora_<x>` | `<x>Time` | `hora_inicio` → `startTime` |
| `minutos_<x>` | `<x>Minutes` | `minutos_trabalhados` → `workedMinutes` |
| `dias_<x>` / `meses_<x>` | `<x>Days` / `<x>Months` | `dias_ciclo` → `cycleDays` |
| `valor_<x>` | `<x>Amount` | `valor_salario` → `salaryAmount` |
| `taxa_<x>` | `<x>Rate` | `taxa_hora_extra` → `overtimeRate` |
| `eh_<x>` / `tem_<x>` | `is<X>` / `has<X>` | `eh_ativo` → `isActive` |
| `<particípio>_por_id` | `<particípio em inglês>ById` | `decidido_por_id` → `decidedById` |
| `nota_<x>` | `<x>Score` | `nota_risco` → `riskScore` |
| `<x>_cifrado` | `<x>Enc` (nunca sai na API) | `cid_cifrado` → `cidEnc` |
| `arquivo_chave` | `fileKey` | |
| `estorno_de_id` | `reversalOfId` | |
| `id_publico` | `publicId` | |

### 12.2 Glossário de tabelas

| Banco (pt-BR) | Entidade no código | Banco (pt-BR) | Entidade no código |
|---|---|---|---|
| `contas` | `tenants` | `atestados` | `medicalCertificates` |
| `empresas` | `companies` | `analises_atestado` | `certificateAnalyses` |
| `estabelecimentos` | `establishments` | `afastamentos` | `absences` |
| `setores` | `departments` | `tipos_licenca` | `leaveTypes` |
| `cargos` | `jobTitles` | `politicas_banco_horas` | `timeBankPolicies` |
| `centros_custo` | `costCenters` | `adesoes_banco_horas` | `timeBankEnrollments` |
| `colaboradores` | `employees` | `lancamentos_banco_horas` | `timeBankEntries` |
| `historico_cargos_colaborador` | `employeeJobHistory` | `folgas_compensatorias` | `compensatoryLeaves` |
| `usuarios` | `users` | `periodos_ferias` | `vacationPeriods` |
| `modelos_escala` | `scheduleTemplates` | `parcelas_ferias` | `vacationInstallments` |
| `dias_modelo_escala` | `scheduleTemplateDays` | `periodos_fechamento` | `closingPeriods` |
| `escalas_colaborador` | `employeeSchedules` | `eventos_periodo_fechamento` | `closingPeriodEvents` |
| `trocas_escala` | `scheduleOverrides` | `totais_fechamento` | `closingSnapshots` |
| `regras_jornada` | `workweekRules` | `espelhos_ponto` | `timeMirrors` |
| `feriados` | `holidays` | `ciencias_espelho` | `mirrorAcknowledgements` |
| `regras_feriado_trabalhado` | `holidayWorkRules` | `exportacoes_aej` | `aejExports` |
| `configuracoes_empresa` | `companySettings` | `relatorios` | `reports` |
| `apuracoes_dia` | `dailyTimesheets` | `codigos_verba_folha` | `payrollEventCodes` |
| `intervalos_apuracao` | `timesheetIntervals` | `exportacoes_folha` | `payrollExports` |
| `pedidos_ajuste` | `timeAdjustmentRequests` | `notificacoes` | `notifications` |
| `marcacoes_tratadas` | `treatedPunches` | `preferencias_notificacao` | `notificationPreferences` |
| `abonos` | `timeWaivers` | `logs_auditoria` | `auditLogs` |
| `consentimentos_biometricos` | `biometricConsents` | `embeddings_faciais` | `facialEmbeddings` |
| `chaves_conta` | `tenantKeys` | `usuarios_estabelecimentos` | `userEstablishments` |

**Banco `arp` (nomes dos docs `02` e `03` → identificadores).** O `arp` já estava em português; só ganhou plural e o padrão de colunas:

| Doc `02`/`03` | Identificador | Observação |
|---|---|---|
| `registros` | `registros` | tipos 2, 4, 5, 6 e 7 do AFD |
| `evidencias` | `evidencias` | dados internos que não vão ao AFD |
| `entrada` | `entradas` | outbox da api-coletor |
| `sequencia_estabelecimento` | `sequencias_estabelecimento` | `ultimo_nsr`, `ultimo_hash` |
| `outbox` | `outbox` | igual |
| `estabelecimento` (coluna) | `estabelecimento_id` | |
| `dh_marcacao` · `dh_gravacao` | `marcado_em` · `gravado_em` | padrão `<particípio>_em` |
| `tipo` · `coletor` | `tipo` · `tipo_coletor` | `tipo_coletor`: 01 app mobile … 05 outro (AFD) |
| flag on/off do AFD | `eh_offline` | |

**Jobs e filas** (nomes em inglês) e o equivalente nos docs: `calcular_jornada` ≡ `recalculate-day` · `gerar_pdf` ≡ `generate-receipt-pdf` · `espelho_mensal` ≡ `generate-mirror` · `verificar_foto` ≡ `verify-photo` · `selo_worm` ≡ `seal-worm` · `conferir_cadeias` ≡ `verify-chains` · `limpar_fotos` ≡ `purge-photos`.

**Termo novo:** entra neste glossário no mesmo PR. O nome em inglês do código é a tradução canônica daqui.

## 13. Migrations

- Ferramenta: `drizzle-kit generate` para o `app`. Arquivos `NNNN_descricao.sql` numerados pela ferramenta; a descrição em português, `snake_case` (`0007_cria_pedidos_ajuste`).
- **Nunca edite uma migration já aplicada**, nem em dev compartilhado. Erro se corrige com migration nova.
- Uma migration, uma intenção. Mudança de schema e carga de dados em arquivos separados. Dados iniciais (feriados nacionais, licenças legais) ficam em `db/seeds/`, idempotentes.
- Migration destrutiva (`DROP`, mudança de tipo) leva comentário com o plano de reversão e passa por revisão.
- `arp`: SQL escrito à mão, com os triggers de imutabilidade; um teste automatizado tenta `UPDATE`/`DELETE` e espera falha.
- **Better Auth** cria tabelas próprias (`user`, `session` etc.), em inglês. **[A DECIDIR]** mapear para português pela configuração dele (`modelName`/`fields`) ou mantê-las em um schema `auth` separado, fora desta convenção. Ver `04` §9.

## 14. Exemplo completo

```sql
CREATE TABLE colaboradores (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY,
  conta_id            BIGINT NOT NULL,
  empresa_id          BIGINT NOT NULL,
  estabelecimento_id  BIGINT NOT NULL,
  setor_id            BIGINT,
  cargo_id            BIGINT,
  gestor_id           BIGINT,
  matricula           TEXT,
  nome_completo       TEXT NOT NULL,
  cpf                 CHAR(11) NOT NULL,
  data_admissao       DATE NOT NULL,
  data_desligamento   DATE,
  status              TEXT NOT NULL DEFAULT 'ativo',
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por_id       BIGINT,
  CONSTRAINT pk_colaboradores PRIMARY KEY (id),
  CONSTRAINT uq_colaboradores_conta_id_id UNIQUE (conta_id, id),
  CONSTRAINT uq_colaboradores_conta_id_cpf UNIQUE (conta_id, cpf),
  CONSTRAINT fk_colaboradores_conta FOREIGN KEY (conta_id) REFERENCES contas (id),
  CONSTRAINT fk_colaboradores_estabelecimento FOREIGN KEY (conta_id, estabelecimento_id) REFERENCES estabelecimentos (conta_id, id),
  CONSTRAINT fk_colaboradores_gestor FOREIGN KEY (conta_id, gestor_id) REFERENCES colaboradores (conta_id, id),
  CONSTRAINT ck_colaboradores_status CHECK (status IN ('ativo', 'afastado', 'desligado')),
  CONSTRAINT ck_colaboradores_cpf CHECK (cpf ~ '^[0-9]{11}$'),
  CONSTRAINT ck_colaboradores_desligamento CHECK (data_desligamento IS NULL OR data_desligamento >= data_admissao)
);
CREATE INDEX idx_colaboradores_conta_id_status ON colaboradores (conta_id, status);
CREATE INDEX idx_colaboradores_conta_id_gestor_id ON colaboradores (conta_id, gestor_id);

CREATE TABLE pedidos_ajuste (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY,
  conta_id            BIGINT NOT NULL,
  colaborador_id      BIGINT NOT NULL,
  data_trabalho       DATE NOT NULL,
  tipo                TEXT NOT NULL,
  hora_solicitada     TIME,
  motivo              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pendente',
  solicitado_por_id   BIGINT NOT NULL,
  decidido_por_id     BIGINT,
  decidido_em         TIMESTAMPTZ,
  nota_decisao        TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pk_pedidos_ajuste PRIMARY KEY (id),
  CONSTRAINT uq_pedidos_ajuste_conta_id_id UNIQUE (conta_id, id),
  CONSTRAINT fk_pedidos_ajuste_colaborador FOREIGN KEY (conta_id, colaborador_id) REFERENCES colaboradores (conta_id, id),
  CONSTRAINT ck_pedidos_ajuste_tipo CHECK (tipo IN ('incluir_marcacao', 'desconsiderar_marcacao', 'justificar_falta', 'justificar_atraso')),
  CONSTRAINT ck_pedidos_ajuste_status CHECK (status IN ('pendente', 'aprovado', 'rejeitado', 'cancelado')),
  CONSTRAINT ck_pedidos_ajuste_decisao CHECK (
    status IN ('pendente', 'cancelado') OR (decidido_por_id IS NOT NULL AND decidido_em IS NOT NULL)),
  CONSTRAINT ck_pedidos_ajuste_sem_autodecisao CHECK (decidido_por_id IS DISTINCT FROM solicitado_por_id)
);
CREATE INDEX idx_pedidos_ajuste_pendentes
  ON pedidos_ajuste (conta_id, criado_em) WHERE status = 'pendente';
CREATE INDEX idx_pedidos_ajuste_colaborador_data_trabalho
  ON pedidos_ajuste (conta_id, colaborador_id, data_trabalho);
```

## 15. Divergências em relação à Visage (para quem vem de lá)

| Visage | Genus | Motivo |
|---|---|---|
| Tabelas e colunas em inglês (`users`, `created_at`) | **Em português** (`usuarios`, `criado_em`) | Decisão do projeto. O código segue em inglês; o Drizzle traduz (§12) |
| `tenant_id` | `conta_id` (no código, `tenantId`) | Tabela `contas`; o contrato do serviço Python mantém `tenant_id` |
| `SERIAL`/`INT` em umas tabelas, `TEXT` nas de auditoria | `BIGINT` identity em todas | FK sem conversão de tipo |
| `created_at TIMESTAMPTZ DEFAULT NOW()` (aceita `NULL`) | `criado_em NOT NULL DEFAULT now()` | Carimbo ausente é bug |
| `starts_at DATE` | `data_inicio DATE` | O prefixo diz o tipo |
| `created_by` e `created_by_id` misturados | sempre `_por_id` | Uma regra |
| `VARCHAR(n)` | `TEXT` + `CHECK` quando preciso | Sem limite arbitrário |
| `*_type` (`actor_type`, `target_type`) | `tipo` (`tipo_ator`, `tipo_alvo` quando há mais de um) | Uma palavra para o discriminador |
| `status` sem `CHECK` em alguns lugares | `CHECK` sempre | O banco rejeita valor inválido |
| FK simples por `tenant_id` | FK composta `(conta_id, id)` | Isolamento garantido pelo schema |
| `document` para CPF | `cpf` / `cnpj` (e `documento` só para empregador) | Clareza para a Portaria |
