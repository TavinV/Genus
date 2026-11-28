# 04 · Funcionalidades de RH: planejamento e encaixe na arquitetura

> Documento 4 de 4. Continua `01-contexto-e-portaria.md`, `02-arquitetura.md` e `03-funcionalidades-e-modos.md`, que **não foram alterados** e seguem valendo.
> **Fonte:** quadro Lucidchart "Funcionalidades do sistema de RH por painel", lido em 18/11/2026. É uma lista por painel e módulo, sem relacionamentos. **Roxo = MVP (entrega 25/11/2026). Azul = fase 2.** O quadro informa que reconhecimento facial e coleta offline já estão prontos e não aparecem nele.
> **Especificação funcional (18/11/2026):** requisitos **RF01–RF67**, regras **RN01–RN15** e não funcionais **RNF01–RNF10**, incorporados neste documento: os códigos aparecem em cada módulo e nas §10 a §13. Diagramas: [funcionalidades](https://lucid.app/lucidchart/94874598-1d12-46f9-ac2b-d2cdce3c63e7/edit) e [fluxo entre RH e ponto](https://lucid.app/lucidchart/d8b7e0f2-d48c-462a-b6e1-d1253f2f24c6/edit) (podem exigir login). PRs de RH citam os códigos RF/RN atendidos.
> **Nomes:** tabelas, colunas e **valores** de enumeração em **português** (`docs/conventions/database.md`); rotas, chaves de JSON, eventos e filas em **inglês**. O Drizzle faz a tradução (`database.md` §12).
> **Para quem for revisar:** **[A CONFIRMAR]** marca interpretação ou regra trabalhista ainda não validada com contador/jurídico; **[A DECIDIR]** marca escolha técnica ou de produto em aberto (§9).

---

## 1. Como as funcionalidades entram na arquitetura

### 1.1 Em uma frase

Quase tudo é **um módulo novo no `api-portal` (Fastify) + tabelas novas no banco `app`**. Só três itens saem desse molde: o cálculo da jornada (worker com regras puras), a leitura de atestado (worker de OCR) e a geração de arquivos (espelho, AEJ, relatórios, que passam pelo `signer`). **Nada escreve no `arp`.**

### 1.2 Onde cada coisa mora

```
 Portais (Next.js)          api-portal (Fastify)                         Workers (BullMQ)
 ───────────────           ───────────────────────────────────          ─────────────────────────
 RH / gestor   ──────────► modules/employees   modules/schedules   ──►  recalculate-day  (PTRP)
 Colaborador   ──/me/*───► modules/holidays    modules/timesheets        analyze-certificate (OCR)
 (PWA, celular)            modules/adjustments modules/certificates      generate-mirror / aej
                           modules/absences    modules/time-bank         check-deadlines (diário)
                           modules/closings    modules/dashboard         generate-report · send-notification
                           modules/reports     modules/notifications
                                  │                  │                              │
                                  ▼                  ▼                              ▼
                           PostgreSQL `app`    PostgreSQL `arp`  ◄── só leitura ── workers
                           (escreve)           (só o rep-core escreve)
                                  │
                                  ▼
                           S3: atestados (cifrados) · espelhos · AEJ · relatórios
```

### 1.3 Regras de encaixe

1. **O `arp` é só leitura para o portal e para os workers.** O cálculo lê as marcações pelo papel somente leitura (`ArpReader`). Ajuste, abono e justificativa são tabelas do `app` que **se somam** à marcação original (art. 82, parágrafo único). A original nunca muda.
2. **O cadastro de colaborador também vai ao ARP.** Criar ou alterar empregador/empregado gera registro tipo 2/5 no `arp`, pelo `rep-core` (`03` §2.2). O módulo de cadastros publica o evento; ele não escreve no `arp`.
3. **Toda mudança que afeta o dia publica `recalculate-day`** (o `calcular_jornada` de `03` §8) pelo outbox, com `jobId` determinístico `recalculate-day:{employeeId}:{workDate}`. É o mesmo evento que o `rep-core` já emite a cada batida e **na chegada de lote offline**.
4. **Período fechado não é recalculado em silêncio.** Se uma batida offline tardia cair em dia já fechado, o dia permanece como está, o RH é avisado e **só ele** reabre o período, com motivo (módulo G10).
5. **O sistema não bloqueia batida.** Inconsistência, atraso ou falta só **sinalizam** na apuração.
6. **Tudo é multi-tenant e auditado**, conforme `database.md` §6 e §11.

### 1.4 Papéis (`usuarios.papel`)

| Papel | Pode | Não pode | Escopo |
|---|---|---|---|
| `admin` (cliente) | Configurar empresa, estabelecimentos, usuários, permissões e parâmetros legais (§10). Convidar `admin` e `rh`. Cadastrar, alterar e desligar colaboradores (vínculos, com salário, são escritos só pelo `rh`). Ver os dados da empresa inteira, inclusive salário-base **[A CONFIRMAR]** com o contador | Ver CID e arquivo de atestado; aprovar atestado | Toda a empresa |
| `rh` | Cadastrar, alterar e desligar colaboradores e manter os vínculos; ver todos os colaboradores; validar atestados (G6, G7); verificar e decidir ajustes (G5) e férias (G9), inclusive os da equipe (faz a parte do gestor); fechar e reabrir o mês (G10); exportar (G12). Ver CID e salário | Alterar batida original | Conta inteira ou estabelecimentos atribuídos |
| `gestor` (**opcional**) | Desativado por padrão. Quando habilitado: ver os subordinados diretos e aprovar ajustes e férias da equipe | Ver CID, arquivo de atestado e salário; fechar o mês | Subordinados diretos (`gestor_id`) dentro do estabelecimento |
| `contador` | Baixar a exportação da folha (RF59) para calcular bônus | Alterar dados; ver CID e salário | Estabelecimentos atribuídos |
| `colaborador` | Ver o próprio ponto, espelho, banco e férias; enviar atestado; pedir ajuste e férias; dar ciência no espelho | Ver dados de outros | Só os próprios dados (`/me/*`) |
| `super_admin` (plataforma Genus) | Painel geral: lista de empresas, status da conta, uso, configurações técnicas, logs de erro e integração, sem dados pessoais. Resetar senha, desbloquear usuário, ativar e desativar funcionalidades por empresa. Detalhado na seção *Super Admin* (§3) | Acessar dados de colaboradores, batidas, atestados, salários ou CID; alterar registros do cliente | Plataforma, fora da área do cliente |

**Gestor opcional:** o papel só existe se o `admin` o habilitar na configuração da conta, quando o cliente vê necessidade. Sem gestor, os pedidos de ajuste vão direto para a fila do RH (G5) e as férias têm uma instância só (G9, RF41).

**Acesso excepcional do `super_admin`:** só com número de chamado e justificativa. O acesso é temporário, expira sozinho e fica em log visível ao `admin` da empresa (`support_access.granted|expired`, §7.2). Duração **[A DECIDIR]** (§9, item 22). Autenticação em dois fatores obrigatória.

**Escopo por estabelecimento (RNF02):** cada usuário só vê os estabelecimentos atribuídos a ele, em `usuarios_estabelecimentos` (`usuario_id`, `estabelecimento_id`, `UNIQUE (conta_id, usuario_id, estabelecimento_id)`). **Sem nenhuma linha, vale a conta inteira**, o que atende o RH de empresa pequena sem cadastro extra. O escopo de equipe do gestor (`gestor_id`) se soma a esse filtro. O `request-context` resolve os dois em `req.ctx` (`establishmentScope`, `teamScope`).

**Login (implementado em 22/11/2026, `apps/api/src/modules/auth/`):** Better Auth com e-mail + senha, sessão em cookie para o portal e JWT curto (15 min) para cliente sem cookie. 2FA por TOTP, obrigatório para o `super_admin` (sem ele, a sessão só serve para ativar o 2FA) e opcional para os demais **[A CONFIRMAR]** se o RH também deve ser obrigado. Sem cadastro público: usuário `admin` ou `rh` nasce de um **convite** (abaixo), o `colaborador` de um convite de acesso feito no cadastro dele, ou junto com a conta, no painel do super_admin (e, em dev, por `pnpm --filter @genus/api rh:create-user`). Rotas: `POST /auth/sign-in/email`, `POST /auth/two-factor/enable` e `/verify-totp`, `POST /auth/sign-out`, `GET /auth/token`, `GET /auth/jwks` e `GET /me`. Pendentes: envio do convite por e-mail e recuperação de senha (precisam de envio de e-mail), acesso excepcional do `super_admin` e auditoria de login. As tentativas de login já são gravadas em `rh.tentativas_login` (seção *Super Admin*); falta só a auditoria de login como evento de `auditoria`. `teamScope` ainda não entra no `req.ctx` (depende do §9, item 4).

**Convites (implementado em 25/11/2026, `apps/api/src/modules/invites/`):** o `admin` (na própria conta) ou o `super_admin` (na conta da rota) informa nome, e-mail, papel (**só `admin` ou `rh`**) e CPF. A resposta traz o token do link uma única vez; o portal monta `<origem>/convite#<token>` e quem convidou o entrega (não há envio de e-mail). No aceite, a pessoa confirma o CPF e define a senha. Desde 27/11/2026 o convite pode ser **de uma empresa** da conta (`companyId`, coluna `convites_usuario.empresa_id`, migration 0022): no aceite, o usuário recebe em `usuarios_estabelecimentos` os estabelecimentos que a empresa tem naquele momento. Empresa inativa, de outra conta ou sem estabelecimento → 400 `REFERENCIA_INVALIDA`. **[A CONFIRMAR]** estabelecimento criado depois do aceite não entra sozinho no escopo desse usuário. A senha mínima passou de 12 para 8 caracteres (`MIN_PASSWORD_LENGTH`).
- Tabela `convites_usuario` (migrations 0016 e 0017): só o SHA-256 do token e o HMAC do CPF (chave derivada do `BETTER_AUTH_SECRET`; trocar o segredo invalida os convites pendentes). Um pendente por (conta, e-mail): o novo revoga o anterior. O banco recusa outro papel, a troca de conta, e-mail, papel ou hashes e qualquer mudança em convite aceito ou revogado.
- Validade de 72 h e uso único. CPF errado: `CPF_NAO_CONFERE`; na 5ª falha o convite é revogado. Token inexistente, expirado, usado, revogado ou de conta suspensa: `CONVITE_INVALIDO`, sem diferenciar. As rotas públicas limitam falhas por IP (429; 10 em 15 min, em memória, por instância **[A CONFIRMAR]**: atrás do proxy do portal o IP visto pode ser o do proxy).
- `admin` restrito a estabelecimentos (`usuarios_estabelecimentos`) não gerencia convites (403): o convidado enxergaria a conta inteira.
- O CPF informado é de quem foi convidado e serve só para confirmar a identidade no aceite; não liga o usuário a um colaborador.

**Fiscal:** não há perfil de fiscal neste módulo. O auditor fiscal acessa AFD e AEJ pelo portal fiscal existente (`rep-core` `/fiscal`, `03` §7.3).

### 1.5 Estrutura de um módulo

Cada módulo segue `docs/conventions/backend.md` §2: `routes.ts` · `schemas.ts` · `service.ts` · `repository.ts` · `events.ts` · `rules/`. Prefixo `/portal` omitido nas rotas abaixo. Corpo, query e resposta em `camelCase` inglês, com **valores em português** (`"status": "pendente"`).

---

## 2. Visão geral dos módulos

| # | Módulo | Fase | Onde roda | Tabelas principais | Integração externa |
|---|---|---|---|---|---|
| **Painel de gestão** | | | | | |
| G1 | Cadastros | MVP | api-portal | `empresas`, `estabelecimentos`, `setores`, `cargos`, `centros_custo`, `colaboradores`, `historico_cargos_colaborador` | Nenhuma (grava tipo 2/5 no ARP via rep-core) |
| G2 | Escalas e jornada | MVP | api-portal | `modelos_escala`, `dias_modelo_escala`, `escalas_colaborador`, `trocas_escala`, `regras_jornada` | Nenhuma |
| G3 | Feriados | MVP | api-portal + job anual | `feriados`, `regras_feriado_trabalhado` | Nenhuma (cálculo local) |
| G4 | Apuração do ponto | MVP | worker + regras puras | `apuracoes_dia`, `intervalos_apuracao`, `configuracoes_empresa` | Lê o ARP |
| G5 | Ajustes e justificativas | MVP | api-portal | `pedidos_ajuste`, `marcacoes_tratadas`, `abonos` | Nenhuma |
| G6 | Análise heurística de atestados | MVP | worker (OCR) + api-portal | `analises_atestado` | **OCR [A DECIDIR]** |
| G7 | Atestados e afastamentos | MVP | api-portal | `atestados`, `afastamentos`, `tipos_licenca` | Nenhuma |
| G8 | Banco de horas | MVP | api-portal + worker | `politicas_banco_horas`, `adesoes_banco_horas`, `lancamentos_banco_horas`, `folgas_compensatorias` | Nenhuma |
| G9 | Férias | Fase 2 | api-portal | `periodos_ferias`, `parcelas_ferias` | Nenhuma |
| G10 | Fechamento e espelho | MVP / Fase 2 | api-portal + worker + signer | `periodos_fechamento`, `eventos_periodo_fechamento`, `totais_fechamento`, `espelhos_ponto`, `exportacoes_aej` | `signer` (interno); geração de PDF |
| G11 | Painel do dia e indicadores | MVP | api-portal (leitura) | nenhuma nova | Nenhuma |
| G12 | Relatórios e exportação | Fase 2 | worker | `relatorios`, `codigos_verba_folha`, `exportacoes_folha` | **Folha [A DECIDIR]**, e-mail, WhatsApp |
| **Painel do funcionário (celular)** | | | | | |
| E1 | Meu ponto | MVP | api-portal `/me` | `ciencias_espelho` | Nenhuma |
| E2 | Meus pedidos | MVP | `/me` sobre G5 | (reusa G5) | Nenhuma |
| E3 | Meus atestados | MVP | `/me` sobre G6/G7 | (reusa G6/G7) | S3 (URL assinada) |
| E4 | Meu banco de horas | MVP | `/me` sobre G8 | (reusa G8) | Nenhuma |
| E5 | Minhas férias | Fase 2 | `/me` sobre G9 | (reusa G9) | Nenhuma |
| E6 | Avisos | Fase 2 | api-portal + worker | `notificacoes`, `preferencias_notificacao` | **E-mail, WhatsApp, Web Push [A DECIDIR]** |

Só **três** módulos têm integração externa: G6 (OCR), G12 e E6 (canais de aviso e folha). **Nenhum** do MVP precisa de API externa além do OCR.

### 2.1 Requisitos por módulo

| Módulo | Requisitos | Regras |
|---|---|---|
| G1 Cadastros | RF01–RF06 | — |
| G2 Escalas e jornada | RF07–RF13 | RN04, RN06 |
| G3 Feriados | RF14–RF16 | RN05 |
| G4 Apuração | RF17–RF22 | RN01–RN05, RN07, RN08 |
| G5 Ajustes | RF23–RF26 | RN01 |
| G6 Análise de atestados | RF61–RF67 | RN15 |
| G7 Atestados e afastamentos | RF28–RF32 | RN13, RN14, RN15 |
| G8 Banco de horas | RF33–RF38 | RN05, RN09 |
| G9 Férias | RF39–RF45 | RN10–RN12 |
| G10 Fechamento e espelho | RF46, RF47, RF49, RF50 | RN01, RN08 |
| G11 Painel | RF54–RF56 | — |
| G12 Relatórios | RF57–RF60 | — |
| E1 Meu ponto | RF48, RF51 | — |
| E2 Meus pedidos | RF23, RF52 | — |
| E3 Meus atestados | RF27 | RN15 |
| E4 Meu banco de horas | RF35 | — |
| E5 Minhas férias | RF41 | — |
| E6 Avisos | RF57 | — |
| Todos os painéis do funcionário | RF53 (celular simples, poucos cliques) | — |

---

## 3. Painel de gestão (RH e gestor)

### G1 · Cadastros (MVP)

**Tabelas:**
- `empresas` (`razao_social`, `nome_fantasia`, `tipo_documento`, `documento`)
- `estabelecimentos` (`empresa_id`, `nome`, `tipo_documento` = `cnpj`|`cpf`|`caepf` (RF01; CAEPF para produtor rural pessoa física), `documento`, endereço, `uf`, `codigo_municipio_ibge`, `fuso_horario`)
- `setores` (`nome`) · `cargos` (`nome`, `codigo_cbo`) · `centros_custo` (`codigo`, `nome`)
- `colaboradores` (`empresa_id`, `estabelecimento_id`, `setor_id`, `cargo_id`, `centro_custo_id`, `gestor_id`, `usuario_id`, `matricula`, `nome_completo`, `cpf`, `data_admissao`, `data_desligamento`, `motivo_desligamento`, `tipo_contrato` = `indeterminado`|`determinado`|`safra` (RF03), `status` = `ativo`|`afastado`|`desligado`, `pessoa_facial_id`, `status_facial`)
- `historico_cargos_colaborador` (`colaborador_id`, `cargo_id`, `setor_id`, `valor_salario`, `data_inicio`, `data_fim`; **vigência**, sem sobreposição)

**Endpoints:** `/companies`, `/establishments`, `/departments`, `/job-titles`, `/cost-centers` (CRUD) · `/employees` (CRUD) · `POST /employees/:id/terminate` · `GET|POST /employees/:id/job-history` · `PUT /employees/:id/facial-link`.

**Regras:**
- **Hierarquia:** conta (`contas`) → empresa → estabelecimento → colaborador. O estabelecimento é a unidade da sequência de NSR no ARP.
- **Desligamento** (RF05) não apaga: define `data_desligamento`, `motivo_desligamento`, `status = 'desligado'`, encerra a escala vigente (G2), **liquida o banco de horas** (G8, RF38) e **apaga a galeria facial** (evento `employee.terminated` → `DELETE /embeddings/{tenant}/{person}` na engine). O histórico fica.
- **Histórico (RF06):** cargo, setor e salário em `historico_cargos_colaborador`; escala em `escalas_colaborador` (G2). Todos com vigência a partir de uma data de início.
- **Salário-base** (RF03, RF06) vem do `historico_cargos_colaborador` vigente e só é visível ao RH e ao `admin` **[A CONFIRMAR]** com o contador. Mudar cargo/salário **abre nova vigência**, não sobrescreve.
- **Vínculo facial (RF04):** o rosto fica no banco `app`, com **criptografia dupla**. A criptografia já está pronta em `packages/shared/src/crypto.ts` e no face-engine; o RH só guarda o resultado.
  1. A engine devolve o embedding cifrado com a **DEK da empresa** (AES-256-GCM). Ele é guardado como veio em `embeddings_faciais` (`embedding_iv`, `embedding_tag`, `embedding_ct`, `versao_chave`), um por colaborador.
  2. A DEK de cada empresa fica em `chaves_empresa`, **cifrada com a `MASTER_KEY`**, que só existe no ambiente. Há uma chave ativa por empresa, e o `rh_api` não apaga chaves.
  - Exige **consentimento ativo** em `consentimentos_biometricos`. Revogar apaga o embedding (trigger) e mantém o consentimento como prova.
  - O `person_id` da engine é o `colaborador_id`, então não é preciso `pessoa_facial_id`.
  - O **`tenant_id` da engine é `empresa-<id>`** (`engineTenantId` em `apps/api/src/modules/facial/stored-crypto.ts`). A engine guarda a DEK em cache por `tenant_id`; com DEK por empresa, duas empresas da mesma conta não podem dividir o mesmo `tenant_id`. **Avisar a parte do ponto** para o coletor real usar o mesmo valor.
  - Conferência contra a engine real: `apps/api/scripts/check-facial-storage.ts`, numa transação desfeita com ROLLBACK.
  - **Pendente** (com login e rotas): serviço de cadastro (3 fotos → `POST /embeddings/register` → grava), criação da DEK junto com o cadastro da empresa, rotação de chaves, apagar o rosto no desligamento e auditoria.
- **PIN (modo alternativo, sem facial):** **todo colaborador tem um** (`colaboradores.pin_hash` e `pin_definido_em` `NOT NULL`, migration `0003_pin_colaborador`). Ele se identifica por **matrícula ou CPF + PIN**; o PIN só confirma a pessoa e não precisa ser único.
  - **Formato:** 4 a 6 dígitos. Todos iguais ou em sequência (`0000`, `123456`, `987654`) são recusados (`PIN_FRACO`). Na admissão, o RH sorteia o PIN (`generatePin`, 6 dígitos com `crypto.randomInt`) e o entrega ao colaborador.
  - **Hash** (`apps/api/src/modules/employees/pin.ts`): `scrypt$<versão do pepper>$N$r$p$sal$hash`. O PIN passa por HMAC-SHA256 com o **pepper** (chave secreta do servidor, fora do banco) e depois por scrypt com sal aleatório (N=2^15, r=8, p=1 **[A CONFIRMAR]**). Sem o pepper, um vazamento do banco não permite testar os PINs. A versão do pepper e o custo ficam no hash: rotação e endurecimento sem invalidar PINs (`pinHashNeedsRehash`).
  - **Pepper:** variável `PIN_PEPPER` (64 hex, com versão). Entra no `.env`/`setup:dev` junto com o service de cadastro, que é o primeiro a usá-lo. Até lá, nenhum serviço depende dele (o Docker não muda).
  - O PIN, o hash e o pepper nunca vão para log, resposta, auditoria nem para a lista do aparelho.
- **PIN no modo offline (proposta para a parte do ponto; [A CONFIRMAR] com o colega):** o aparelho **não recebe o `pin_hash` nem o pepper**. Assim, roubar o aparelho não dá nada para testar por força bruta.
  1. Offline, o aparelho aceita matrícula/CPF + PIN **sem conferir localmente**. Ele não bloqueia a marcação (Portaria 671, art. 74).
  2. O PIN digitado é cifrado com a **chave pública de ingestão** que o aparelho já guarda (`02` §4.1). Só o servidor decifra. Ele vai junto com a batida e a foto.
  3. Na sincronização, o servidor confere com `verifyPin`. Se não bater, gera um **alerta para o RH** (como a foto 1:1 divergente). A marcação nunca é alterada, e o PTRP pode marcá-la como indevida.
  4. No aparelho, um atraso crescente entre PINs errados (sem bloquear a batida) e a foto obrigatória desestimulam tentativas.
  - O `03` §3.2/§3.3 ainda diz "Digite seu PIN" e "confere o PIN na lista local". Alinhar com a parte do ponto.
- **CPF** único por conta (`UNIQUE (conta_id, cpf)`); validação dos dígitos verificadores no service.
- Criar/alterar colaborador publica `employee.changed` → `rep-core` grava o registro tipo 5.

**Atenção:** sem importação em massa o onboarding de uma empresa de 100 pessoas é inviável; ver §8.

### G2 · Escalas e jornada (MVP)

**Tabelas:**
- `modelos_escala` (`nome`, `tipo` = `5x2`|`6x1`|`12x36`|`livre`, `dias_ciclo`, `minutos_semanais`, `eh_ativo`)
- `dias_modelo_escala` (`modelo_id`, `indice_dia`, `eh_folga`, `hora_inicio`, `hora_fim`, `hora_inicio_intervalo`, `minutos_intervalo`, `minutos_previstos`)
- `escalas_colaborador` (`colaborador_id`, `modelo_id`, `data_ancora_ciclo`, `data_inicio`, `data_fim`). **Vigência**, sem sobreposição por colaborador
- `trocas_escala` ("troca pontual": `colaborador_id`, `data_trabalho`, `tipo` = `troca_turno`|`folga`|`trabalho_extra`, `hora_inicio`, `hora_fim`, `motivo`, `criado_por_id`)
- `regras_jornada` (`minutos_semanais_maximos`, `minutos_diarios_maximos`, `dias_folga_semanais_minimos`, `data_inicio`, `data_fim`, `origem` = `lei`|`acordo`, `base_legal`). **Catálogo global** (`conta_id NULL` = regra legal do Genus) + linhas da conta para convenção coletiva

**Seed legal de `regras_jornada` (RN06, EC 141/2026):**

| Vigência | `minutos_semanais_maximos` | `dias_folga_semanais_minimos` |
|---|---|---|
| até 15/12/2026 | 2640 (44 h) | 1 |
| 16/12/2026 a 15/12/2027 | 2520 (42 h) | 2 |
| a partir de 16/12/2027 | 2400 (40 h) | 2 **[A CONFIRMAR]** |

Liminar do STF pode mudar detalhes **[A CONFIRMAR]**. A folga mínima antes de 16/12/2026 vem do descanso semanal (Lei 605/1949) e a de 2027 em diante não está explícita na especificação. Como é seed com vigência, uma mudança vira linha nova, sem deploy.

**Endpoints:** `/schedule-templates` (CRUD) · `POST /employees/:id/schedules` (atribui com vigência) · `/schedule-overrides` · `/workweek-rules` · `POST /schedules/validate` (simulação, devolve alertas) · `GET /schedules/calendar?from&to&departmentId` (calendário da equipe).

**Regras:**
- **Modelo cíclico:** a escala é um ciclo de `dias_ciclo` dias (7 para 5x2 e 6x1; 2 para 12x36) a partir de `data_ancora_ciclo`. O dia da escala é `(data_trabalho − data_ancora_ciclo) mod dias_ciclo`. Assim 12x36 e semanais usam a mesma estrutura.
- **Regra de jornada versionada (44h, 42h, 40h):** `regras_jornada` com vigência. O sistema escolhe a regra vigente **na data**, então uma mudança de lei é uma linha nova, sem deploy.
- **"Alerta de escala acima do limite":** `POST /schedules/validate` e o salvamento devolvem **avisos, não bloqueio**: carga semanal acima do limite vigente, jornada diária acima do máximo, folgas abaixo de `dias_folga_semanais_minimos`, **interjornada menor que 11 h** (RN04), intervalo abaixo do mínimo (RN03), mais de 6 dias seguidos sem folga **[A CONFIRMAR: parâmetros e artigos da CLT com o jurídico]**. O RH pode salvar mesmo assim.
- **Alerta quando uma regra nova entra em vigor (RF11):** o job diário `check-deadlines` compara as escalas vigentes com a regra que vai valer, **com antecedência** (ex.: 30 dias antes de 16/12/2026 e de 16/12/2027) e de novo no dia. Lista na pendência do RH (G11) os modelos e colaboradores acima do novo limite. Não altera nenhuma escala sozinho.
- **Testes obrigatórios:** a troca de regra em 16/12/2026 e em 16/12/2027, inclusive semana que atravessa a data (qual regra vale para a semana partida é **[A CONFIRMAR]**).
- **Calendário da equipe:** leitura derivada (modelo + vigência + trocas + feriados), sem tabela própria.

**Eventos:** atribuir escala, criar troca ou mudar regra → `recalculate-day` para os dias afetados (futuros: só o calendário; passados e abertos: recalcula).

### G3 · Feriados (MVP)

**Tabelas:** `feriados` (`conta_id` NULL = global, `data_feriado`, `nome`, `escopo` = `nacional`|`estadual`|`municipal`, `tipo` = `feriado`|`facultativo`, `uf`, `codigo_municipio_ibge`) · `regras_feriado_trabalhado` (`empresa_id`, `tratamento` = `hora_extra`|`banco_horas`|`folga_compensatoria`, `taxa_hora_extra`, vigência).

**Endpoints:** `GET /holidays?year&establishmentId` · `POST|PATCH /holidays` (municipais, estaduais e pontos facultativos da conta) · `/holiday-work-rules`.

**Regras:**
- **Nacionais automáticos:** job `seed-holidays` calcula o ano (datas fixas + Páscoa para Sexta-feira Santa, e Carnaval/Corpus Christi como **ponto facultativo**) e grava em `feriados` global. **Sem API externa**: a consulta vira um `JOIN` simples.
- **Estaduais e municipais:** a conta cadastra por estabelecimento (`uf` e código IBGE do município). Pode haver um *seed* estático de feriados estaduais por UF.
- **Ponto facultativo** (`tipo = 'facultativo'`) **não** vira feriado na apuração a menos que o RH ative para a conta.
- **Feriado trabalhado (RF16, RN05):** `regras_feriado_trabalhado` define o tratamento (hora extra a 100%, banco de horas ou folga compensatória). Pela RN05, domingo e feriado trabalhados **sem folga compensatória** são pagos a 100%. Padrão por empresa a **[A CONFIRMAR]** com o contador/convenção.
- A lista de feriados nacionais deve ser conferida a cada ano **[A CONFIRMAR]** (a lei muda).

### G4 · Apuração do ponto (MVP)

É o **PTRP**: lê as marcações e produz o dia calculado, **sem nunca alterá-las**.

**Tabelas:**
- `apuracoes_dia` (`colaborador_id`, `data_trabalho`, `tipo_dia` = `trabalho`|`folga`|`feriado`|`ausencia`|`ferias`|`compensado`, `minutos_previstos`, `minutos_trabalhados`, `minutos_intervalo`, `minutos_intervalo_suprimido`, `minutos_atraso`, `minutos_saida_antecipada`, `minutos_falta`, `minutos_abonados`, `minutos_extras`, `minutos_extras_folga`, `minutos_noturnos`, `minutos_adicional_noturno`, `status` = `calculada`|`inconsistente`|`fechada`, `codigos_inconsistencia TEXT[]`, `versao_calculo`, `configuracao_id`, `regra_jornada_id`, `calculado_em`, `fechamento_id`). `UNIQUE (conta_id, colaborador_id, data_trabalho)`. `configuracao_id` e `regra_jornada_id` registram **qual versão dos parâmetros** o cálculo usou (RNF06)
- `intervalos_apuracao` (`apuracao_id`, `tipo` = `trabalho`|`intervalo`, `inicio_em`, `fim_em`, `origem` = `original`|`tratada`, `estabelecimento_id`, `nsr`)
- `configuracoes_empresa` (parâmetros por empresa, abaixo, **com vigência** `data_inicio`/`data_fim`: mudar um parâmetro abre nova vigência e não reescreve o passado)

**Parâmetros (`configuracoes_empresa`), todos configuráveis, nenhum fixo no código:**

| Parâmetro (coluna) | Padrão sugerido | Base |
|---|---|---|
| `minutos_tolerancia_marcacao` | 5 | RN02, CLT art. 58 §1º |
| `minutos_tolerancia_dia` | 10 | RN02: acima disso, conta tudo |
| `minutos_intervalo_minimo_acima_6h` | 60 | RN03, CLT art. 71 |
| `minutos_intervalo_minimo_4h_6h` | 15 | RN03, CLT art. 71 |
| `minutos_interjornada_minimo` | 660 (11 h) | RN04, CLT art. 66 |
| `minutos_extras_diarios_maximos` | 120 (2 h) | RN05, CLT art. 59 |
| `tipo_trabalho_noturno` | `urbano` | RN07: `urbano`, `rural_lavoura` ou `rural_pecuaria`; preenche os quatro campos abaixo |
| `hora_inicio_noturno` / `hora_fim_noturno` | 22:00 / 05:00 | RN07 urbano. Rural: 21:00–05:00 lavoura, 20:00–04:00 pecuária **[A CONFIRMAR]** |
| `eh_hora_noturna_reduzida` | true (52 min 30 s) | RN07 urbano, CLT art. 73 §1º. Rural: false **[A CONFIRMAR]** |
| `taxa_adicional_noturno` | 0.2000 | RN07 urbano. Rural: 0.2500, Lei 5.889/1973 **[A CONFIRMAR]**. Convenção pode alterar |
| `taxa_hora_extra` / `taxa_hora_extra_folga` | 0.5000 / 1.0000 | RN05 (mínimo 50%; domingo e feriado sem folga compensatória a 100%) |
| `dias_prazo_atestado` | a definir | G6 |
| `minutos_saldo_alto`, `dias_alerta_vencimento` | a definir | G8 |

Os valores de RN02 a RN05 vêm da especificação com a fonte legal indicada. Os padrões continuam sujeitos à convenção coletiva do cliente (§9, item 14). **[A DECIDIR]** se `tipo_trabalho_noturno` é por empresa (como acima) ou por estabelecimento/colaborador, para quem tem urbano e rural na mesma empresa.

**Algoritmo do dia** (função pura em `packages/timekeeping-rules`):

1. **Carrega as marcações** do estabelecimento no intervalo do dia, com margem para turno que cruza a meia-noite. O dia de trabalho é o dia em que o turno **começou**.
2. **Aplica** tratamentos aprovados (`marcacoes_tratadas`: incluídas e desconsideradas), abonos, afastamento, feriado, troca pontual e folga compensatória.
3. **Pareia** entradas e saídas segundo a escala. Quantidade ímpar vira inconsistência (e **marcação ímpar no AEJ pode gerar autuação**, `01` §3.7).
4. **Calcula** trabalhado, intervalo, intervalo suprimido (RN03), atraso, saída antecipada, falta, extras (a 50% e a 100%), noturno e adicional noturno. A tolerância (RN02) vale por batida até `minutos_tolerancia_marcacao` e, se a soma do dia passar de `minutos_tolerancia_dia`, **conta tudo**.
5. **Decide o destino das extras** (pagar ou banco de horas) conforme a política do colaborador (G8) e grava os lançamentos do banco **por diferença**.
6. **Grava** `apuracoes_dia` e `intervalos_apuracao` e marca `versao_calculo`.

**Inconsistências** (`codigos_inconsistencia`, RF21): `marcacoes_impares`, `marcacao_ausente`, `intervalo_ausente`, `saida_ausente`, `intervalo_insuficiente` (RN03), `interjornada_insuficiente` (menos de 11 h desde a última saída, RN04), `extras_acima_limite` (mais de 2 h extras no dia, RN05), `marcacao_fora_da_escala`, `marcacao_duplicada`, `excede_limite_diario`, `marcacao_tardia_nao_revisada`. São **sinais**, não bloqueios (art. 74): a hora extra acima de 2 h é apurada e paga normalmente, só sinalizada.

**DSR** depende da semana inteira; é calculado **no fechamento** (G10), não no dia. Dois efeitos: o **reflexo das horas extras** no DSR **[A CONFIRMAR]** a fórmula com o contador; e a **perda do DSR** da semana com falta injustificada (RN08, Lei 605/1949), que sai como "DSR descontado" na exportação para a folha (RF59). Falta abonada (G5) ou coberta por afastamento (G7) não desconta.

**Determinismo (RNF05):** recalcular o mesmo dia com as mesmas entradas dá sempre o mesmo resultado. A função pura não lê relógio nem banco; os parâmetros vigentes entram como argumento.

**Endpoints:** `GET /timesheets?employeeId&from&to&status` · `GET /timesheets/:employeeId/:workDate` (dia com marcação original ao lado da tratada) · `POST /timesheets/recalculate` (RH, assíncrono, devolve o id do job) · `GET /timesheets/inconsistencies`.

**Gatilhos de recálculo (RF22):** marcação nova (inclusive **lote offline** com batidas atrasadas) · pedido aprovado (G5) · abono · afastamento aprovado (G7) · troca de escala, feriado ou parâmetro. Uma batida atrasada também recalcula o **dia seguinte** (interjornada) e a **semana** (DSR, no fechamento). Se o dia está **fechado** (`status = 'fechada'`): não recalcula; gera alerta (§1.3, item 4).

**Testes de borda obrigatórios:** batida faltando, número ímpar de batidas, virada de dia, jornada noturna (urbana e rural), feriado, batida atrasada do modo offline e a troca de regra em 16/12/2026 e 16/12/2027.

**Implementado (26/11/2026):** apuração automática. O `recalculate-day` do rep-core cai na fila `day-recalculation`, consumida pela api, que recalcula o dia anterior, o dia e o seguinte (até hoje). O job de hora em hora `close-days` gera a falta e encerra os dias (olha 3 dias para trás). Dia aberto não acusa falta, atraso nem batida faltando. Rotas: `GET /portal/timesheets` e `POST /portal/timesheets/recalculate` (dia do estabelecimento). A migration `0019` carrega os `parametros_legais` padrão. Desvio do desenho: o outbox do `arp` não é marcado `processado`. Pendente: o fechamento não confere se todos os dias do período já foram encerrados **[A CONFIRMAR]**.

### G5 · Ajustes e justificativas (MVP)

**Tabelas:**
- `pedidos_ajuste` (esquema completo em `database.md` §14): `colaborador_id`, `data_trabalho`, `tipo` = `incluir_marcacao`|`desconsiderar_marcacao`|`justificar_falta`|`justificar_atraso`, `hora_solicitada`, `motivo`, `status` = `pendente`|`aprovado`|`rejeitado`|`cancelado`, `solicitado_por_id`, `decidido_por_id`, `decidido_em`, `nota_decisao`
- `marcacoes_tratadas` (**só INSERT**, "marcação tratada separada da original"): `colaborador_id`, `data_trabalho`, `tipo` = `incluida`|`desconsiderada`, `marcado_em`, `nsr_original`, `estabelecimento_id`, `pedido_id`, `motivo`, `criado_por_id`, `estorno_de_id`
- `abonos` (abono pelo RH, **só INSERT**): `colaborador_id`, `data_trabalho`, `eh_dia_inteiro`, `minutos_abonados`, `codigo_motivo`, `motivo`, `concedido_por_id`, `estorno_de_id`

**Endpoints:** `GET /adjustment-requests?status&employeeId` (fila; o gestor vê só a equipe) · `POST /adjustment-requests` (colaborador, ou RH em nome dele) · `POST /adjustment-requests/:id/approve|reject|cancel` · `GET|POST /time-waivers`.

**Regras:**
- **Fluxo:** colaborador pede (E2) → o `gestor`, se habilitado, ou o RH aprova ou recusa → aprovado, grava `marcacoes_tratadas` (com autor, data e motivo; alimenta o AEJ, RF25) e publica `recalculate-day`.
- **RH pode revisar (RF24)** a decisão do gestor (quando o gestor está habilitado) enquanto o período estiver aberto. Revisar um pedido aprovado grava o **estorno** do tratamento (`estorno_de_id`) e, se for o caso, o tratamento novo; revisar um recusado aprova por cima. O pedido guarda a decisão final e a auditoria guarda as duas (`adjustment.revised`).
- **Ninguém decide o próprio pedido** (`CHECK` no banco e no service). Justificativa é obrigatória. Pedido sobre período fechado retorna `409 PERIOD_CLOSED` até o RH reabrir.
- **A marcação original nunca é tocada.** "Desconsiderar" cria um tratamento que a apuração aplica; a marcação segue no ARP e no AFD. Corrigir um tratamento é **outro** tratamento com `estorno_de_id`.
- **Abono** é ato do RH, com motivo, e entra na apuração como `minutos_abonados` (reduz atraso/falta), nunca editando horário.
- Notificação ao colaborador da decisão: in-app no MVP; e-mail/WhatsApp na fase 2 (E6).

### G6 · Análise heurística de atestados (MVP)

**Não decide nada.** Lê o atestado, procura sinais de problema e dá uma **nota de risco com motivos**. **O RH decide** (G7).

**Tabela:** `analises_atestado` (`atestado_id`, `motor`, `versao_motor`, `confianca_ocr`, `texto_ocr_cifrado`, `nome_paciente_cifrado`, `data_emissao`, `dias_afastamento`, `nome_medico`, `crm_numero`, `crm_uf`, `cid_cifrado`, `tem_assinatura`, `nota_risco` 0–100, `nivel_risco` = `baixo`|`medio`|`alto`, `achados JSONB`, `analisado_em`). Uma análise por versão do motor, então reanalisar não apaga a anterior.

**Verificações (cada uma vira um item em `achados` com `codigo`, `severidade`, mensagem em pt-BR e evidência):**

| Código | O que confere |
|---|---|
| `nome_paciente_divergente` | Nome do paciente lido bate com o do colaborador (RF62) |
| `datas_divergentes` | Data e dias do atestado batem com a ausência declarada (RF62) |
| `crm_invalido` | CRM em formato válido (UF + número). **Só formato**: não há consulta a base externa (RF63) |
| `assinatura_ausente` | Há assinatura/carimbo (RF63) |
| `imagem_duplicada` | Mesma imagem já enviada (SHA-256 exato e *hash* perceptual para variações) (RF64) |
| `atestado_duplicado` | Mesmo período ou mesmo médico/data já registrado (RF64) |
| `enviado_fora_do_prazo` | Enviado depois do prazo (`dias_prazo_atestado`) (RF65) |
| `padrao_recorrencia` | Recorrência em segunda, sexta ou véspera de feriado (consulta o histórico de `afastamentos`) (RF66) |
| `leitura_ocr_fraca` | Leitura ruim: a nota **não** é confiável e o RH vê o aviso |
| `analise_falhou` | O OCR ou o pipeline falhou; o RH analisa à mão |

**Pipeline** (job `analyze-certificate`, em worker Python):

1. Baixa o arquivo do S3 → OCR (RF61) → extrai campos (data, dias, médico, CRM, CID) por regras/regex.
2. Aplica as verificações → calcula a nota (RF67) → grava `analises_atestado`.
3. Move o atestado para `aguardando_revisao` e avisa o RH.
4. **Falha do OCR não trava ninguém:** o atestado vai para `aguardando_revisao` com o achado `analise_falhou`, e o RH analisa à mão.

**Integração externa:** OCR. **Recomendação: local** (Tesseract ou PaddleOCR no worker, na VM de reconhecimento, fora do pico), para o conteúdo do atestado não sair da infraestrutura. Ver §5. A nota de risco usa pesos em arquivo de regras versionado; os limiares de `nivel_risco` ficam **[A DEFINIR]** com dados reais.

**Dado de saúde:** `texto_ocr_cifrado`, `nome_paciente_cifrado` e `cid_cifrado` são cifrados; **CID só para o RH** (`security-lgpd.md` §3). Nenhuma recusa automática.

#### Implementado (24/11/2026): regras + IA sobre o texto (`apps/api/src/modules/certificate-analysis/`)

Atende RF61 (leitura do texto), RF62 (datas × informado), RF63 (CRM só em formato), RF64 (duplicidade), RF65 (prazo, se houver parâmetro), RF67 (nota com motivos) e RN15. RF66 (recorrência) e o hash perceptual de imagem ficam para depois.

- **Rotas (só `rh`):** `POST /portal/certificates/:id/analyze` com `{ text, models? }` e `GET /portal/certificates/:id/analyses`. 400 entrada inválida (`MODELO_IA_INVALIDO` para modelo desconhecido), 403 sem permissão, 404 fora do escopo, 409 atestado já decidido (`STATUS_INVALIDO`). Falha da IA não vira 500.
- **Texto:** ainda não há OCR. O texto vem no corpo (digitado pelo RH ou de um OCR futuro, atrás da interface `TextExtractor`). **OCR [A DECIDIR]** continua valendo.
- **Ordem:** (1) anonimiza: qualquer CPF e o nome do colaborador saem do texto; uma checagem final cancela o envio se sobrar algo; (2) regras: `atestado_duplicado` (mesmo período, ou mesmo médico e data, em atestado não recusado) **barra a IA**; `crm_invalido`, `datas_divergentes`, `enviado_fora_do_prazo` (só com o parâmetro `dias_prazo_atestado`, que ainda não tem seed **[A CONFIRMAR]**); (3) IA: confere só **completude e coerência interna** de `data_atestado`, `periodo_afastamento`, `profissional` e `legibilidade` (`ok` | `ausente` | `incoerente` | `ilegivel`, com evidência literal do texto), lista possibilidades com confiança 0–1 para campo ambíguo e os CIDs que aparecem; (4) CID interpretado pelo **capítulo da CID-10** (sem inventar diagnóstico); (5) recomendação `revisar_manual` ou `sem_recomendacao`.
- **A IA não decide.** Nenhum UPDATE em `atestados`; o status só muda por `approve`/`reject` do RH. A saída é validada contra schema (Zod); fora dele vira `falha = 'saida_fora_do_schema'` e nada da IA é gravado.
- **Confiabilidade indicativa** de 0 a 100 com **teto de 90** (50 sem a IA): nunca afirma que o atestado é verdadeiro. Toda análise traz o aviso fixo "Análise automática e indicativa... Não comprova a autenticidade". Pesos e limiares em `rules/weights.ts` (`RULES_VERSION`), provisórios até haver dados reais **[A DEFINIR]**.
- **Tabela:** `analises_atestado` aceita várias linhas por atestado (migration 0010): uma por `provedor`/`modelo`/`versao_prompt`, com `hash_entrada` (SHA-256 do texto anonimizado + versão do prompt), `resultado` (resumo sem texto livre), `cid_cifrado`, `evidencias_cifradas` e `ocr_texto_cifrado` (AES-256-GCM, chave `CERTIFICATE_DATA_KEY`; sem ela nada disso é gravado e a resposta avisa `SEM_CHAVE_DADOS_SAUDE`), `milissegundos_resposta` e `falha`. A leitura das análises com CID é auditada (`leitura_sensivel`).
- **Provedores** (`CERTIFICATE_AI_PROVIDER` + `CERTIFICATE_AI_MODEL`): `anthropic` (Messages API com saída estruturada; sugerido `claude-haiku-5-5`), `openai_compativel` (OpenAI, OpenRouter ou **modelo local** como Ollama/vLLM, que mantém o atestado na infraestrutura) e `mock` (determinística, padrão sem configuração; a resposta avisa `IA_SIMULADA`). Chaves só no ambiente.
- **Comparação:** `pnpm --filter @genus/api rh:compare-ai -- --models mock:v1,mock:estrito,anthropic:claude-haiku-5-5` roda os 19 atestados sintéticos (`apps/api/test/fixtures/certificates/`, com gabarito) e gera relatório com concordância por campo, divergências, tempo e acerto em `apps/api/reports/ia-atestados/` (fora do Git). Com `--certificate --tenant --user --text-file`, analisa um atestado real e grava uma linha por modelo. Na rota, `models` com dois ou mais modelos devolve a mesma comparação.
- **[A CONFIRMAR] base legal e provedor externo:** enviar texto de atestado a um provedor fora da infraestrutura faz dele operador de dado de saúde (LGPD art. 11 e art. 39). Precisa de base legal definida com o jurídico (a candidata é o art. 11, II, "a" ou "d": obrigação legal ou exercício regular de direito na gestão do afastamento), contrato de operador, região de processamento e prazo de retenção no provedor. Até lá, a recomendação de 04 G6 (processar localmente) se mantém, e o modelo local via `openai_compativel` atende sem mudar código.

### G7 · Atestados e afastamentos (MVP)

**Tabelas:**
- `atestados` (`colaborador_id`, `arquivo_chave`, `arquivo_sha256`, `arquivo_mime`, `arquivo_tamanho_bytes`, `hash_perceptual_imagem`, `data_inicio_informada`, `dias_informados`, `enviado_por_id`, `enviado_em`, `eh_fora_do_prazo`, `status` = `enviado`|`em_analise`|`aguardando_revisao`|`aprovado`|`rejeitado`|`cancelado`, `decidido_por_id`, `decidido_em`, `nota_decisao`, `afastamento_id`)
- `afastamentos` (`colaborador_id`, `tipo` = `atestado`|`inss`|`licenca_legal`|`ferias`|`outro`, `tipo_licenca_id`, `data_inicio`, `data_fim`, `status` = `ativo`|`encerrado`|`cancelado`, `atestado_origem_id`, `exige_encaminhamento_inss`, `observacoes`, `criado_por_id`). Exclusion constraint: **sem afastamentos ativos sobrepostos** por colaborador
- `tipos_licenca` (**catálogo global**: `codigo`, `nome`, `dias_padrao`, `eh_remunerada`, `base_legal`, `exige_documento`)

**Endpoints:** `GET /certificates?status&riskLevel` (fila do RH) · `GET /certificates/:id` (com análise; CID só para `rh`) · `GET /certificates/:id/file` (URL assinada, **auditada**) · `POST /certificates/:id/approve|reject` · `POST /certificates/:id/reanalyze` · `GET|POST|PATCH /absences` · `GET /leave-types`.

**Regras:**
- **Aprovar** cria o `afastamentos` correspondente e publica `recalculate-day` para o período: **"abono automático na apuração"**. Os dias viram `tipo_dia = 'ausencia'` e não geram falta nem desconto. **Recusar** exige `nota_decisao`, que o colaborador vê.
- **Alerta de mais de 15 dias (INSS, RF30, RN13):** a empresa paga os 15 primeiros dias; depois disso o caso vai ao INSS (Lei 8.213/1991 art. 60). O alerta dispara quando afastamentos **pelo mesmo motivo somam mais de 15 dias em 60 dias**. Ao aprovar, `dias > 15` marca `exige_encaminhamento_inss`; o job diário `check-deadlines` soma os afastamentos da janela de 60 dias. "Mesmo motivo" **o RH confirma** (o sistema não compara CIDs sem expô-los) **[A CONFIRMAR]**.
- **Licenças legais com prazo pronto (RF31, RN14):** o catálogo `tipos_licenca` traz tipo, prazo padrão (`dias_padrao`), limite de repetição (`meses_intervalo_minimo`) e fundamento. Ao registrar uma licença o prazo vem preenchido. Seed (CLT art. 473; CF art. 7º):

| Licença | `dias_padrao` | Observação |
|---|---|---|
| Casamento | 3 | |
| Falecimento de familiar | 2 | |
| Doação voluntária de sangue | 1 | uma vez a cada 12 meses (`meses_intervalo_minimo = 12`) |
| Paternidade | 5 | **[A CONFIRMAR]** (especificação marca "conferir") |
| Maternidade | 120 | |
| Alistamento eleitoral | — | **[A CONFIRMAR]** prazo: a especificação lista a licença sem valor |

- **CID (RF32)** é opcional no atestado e visível só para o RH.
- **Visibilidade:** o `gestor` e o `admin` veem "afastado de D1 a D2", **sem CID e sem arquivo**.
- Quando o colaborador entra em afastamento, `colaboradores.status` pode ir a `afastado`; ao fim volta a `ativo`.

### G8 · Banco de horas (MVP)

**Tabelas:**
- `politicas_banco_horas` (`empresa_id`, `nome`, `escopo` = `individual`|`coletivo`, `meses_compensacao` 6 ou 12, `taxa_acrescimo_domingo_feriado` (peso de domingo e feriado, RF34: `1.0000` = cada hora vale 2 no banco), `eh_desconto_saldo_negativo`, vigência)
- `adesoes_banco_horas` (`colaborador_id`, `politica_id`, vigência). A política vale por colaborador ou para um grupo: aderir um setor ou estabelecimento inteiro gera uma adesão por colaborador (RF34)
- `lancamentos_banco_horas` (**ledger só INSERT**): `colaborador_id`, `data_lancamento`, `tipo` = `credito`|`debito`|`compensacao`|`pagamento`|`desconto`|`ajuste`, `minutos` (com sinal, ≠ 0), `data_vencimento`, `origem` = `apuracao`|`folga_compensatoria`|`vencimento`|`manual`, `chave_origem` (idempotência), `estorno_de_id`, `observacao`, `criado_por_id`. `UNIQUE (conta_id, colaborador_id, chave_origem)`
- `folgas_compensatorias` (`colaborador_id`, `data_folga`, `minutos`, `status`, fluxo de aprovação)

**Endpoints:** `GET /time-bank/balances?departmentId` · `GET /time-bank/employees/:id/statement` (saldo e extrato) · `POST /time-bank/employees/:id/entries` (lançamento manual, com motivo) · `POST /compensatory-leaves` + `approve|reject` · `/time-bank-policies`.

**Regras:**
- **Regra individual (6 meses) ou coletiva (1 ano):** é a janela em que o crédito precisa ser compensado (CLT art. 59, §§ 2º e 5º) **[A CONFIRMAR]**. Cada crédito nasce com `data_vencimento`.
- **Saldo é derivado** (`SUM(minutos)`), nunca coluna. **Crédito é consumido por ordem de vencimento (FIFO)**; função pura calcula o que vence em N dias.
- **Origem automática:** a apuração (G4) grava crédito/débito do dia. Como o ledger não se altera, **recalcular um dia grava a diferença** com `chave_origem = apuracao:{data_trabalho}:v{versao_calculo}`.
- **Folga compensatória:** ao aprovar, grava débito e marca o dia como `compensado` na apuração.
- **Alerta de saldo alto ou vencendo:** job diário `check-deadlines` (`minutos_saldo_alto`, `dias_alerta_vencimento`). No MVP aparece nas "Pendências" do painel (G11); na fase 2, vira aviso (E6).
- **Pagamento ou desconto no vencimento ou no desligamento (RF38, RN09):** job grava `pagamento` (crédito não compensado vira hora extra paga) ou `desconto` (saldo negativo). No **desligamento** (`employee.terminated`, G1) o saldo inteiro é liquidado na hora, sem esperar o vencimento. **Desconto de saldo negativo é restrito pela lei trabalhista: só com previsão em acordo [A CONFIRMAR]**; começa desligado (`eh_desconto_saldo_negativo = false`) e exige parametrização.

**Implementado (26/11/2026):** lançamento automático na transação da apuração, só em dia encerrado e com regra em `regras_banco_horas`; o ledger recebe a diferença entre o que o dia vale e o já lançado (`criado_por` NULL = sistema). Rotas: `GET /portal/time-bank`, `GET /portal/employees/:id/time-bank`, `GET` e `PUT /portal/establishments/:id/time-bank-policy`. **[A CONFIRMAR]:** falta integral não debita o banco (só atraso e saída antecipada); pesos de domingo e feriado valem só para a extra de dia de descanso; `banco_saldo_negativo_max_min` não é carregado. Pendente: pagamento no vencimento, liquidação no desligamento, folga compensatória, lançamento manual e regra por colaborador na tela.

### G9 · Férias (Fase 2)

**Tabelas:** `periodos_ferias` (`colaborador_id`, `data_inicio_aquisitivo`, `data_fim_aquisitivo`, `data_fim_concessivo`, `dias_direito`, `dias_vendidos`, `status`) · `parcelas_ferias` (`periodo_id`, `data_inicio`, `data_fim`, `dias`, `status`, fluxo de aprovação).

**Endpoints:** `GET /vacations/periods?employeeId` · `POST /vacations/requests` + `approve|reject|cancel` · `GET /vacations/calendar` (mapa da equipe) · `GET /vacations/expiring`.

**Regras (todas **[A CONFIRMAR]** com o jurídico):**
- **Período aquisitivo** de 12 meses a partir da admissão; **concessivo** nos 12 seguintes.
- **Dias de direito conforme faltas injustificadas** (CLT art. 130): até 5 faltas, 30 dias; 6 a 14, 24; 15 a 23, 18; 24 a 32, 12; acima de 32, perde o direito. As faltas vêm da apuração (G4).
- **Fracionamento em até 3 períodos** (um com ao menos 14 dias, os demais com ao menos 5). **Venda de 1/3** (abono pecuniário, até 10 dias). Não pode **iniciar** nos dois dias que antecedem feriado ou descanso semanal. **Aviso com 30 dias** de antecedência (RN11, CLT arts. 134 e 135).
- **Aprovação (RF41):** com `gestor` habilitado, duas instâncias: o gestor aprova primeiro e o RH confirma (`parcelas_ferias.status` ganha `aprovado_gestor` entre `pendente` e `aprovado`). Sem gestor, o RH aprova direto.
- **Alerta de férias vencendo:** concessivo acabando sem agendamento (risco de pagamento em dobro).
- Férias aprovadas viram `afastamentos` com `tipo = 'ferias'`, então a apuração (G4) e o painel (G11) já as tratam. **O valor `ferias` fica reservado no MVP** para não exigir migration depois.
- Pagamento (até 2 dias antes do início) entra na exportação para a folha (G12).

### G10 · Fechamento e espelho (MVP / Fase 2)

O quadro marca o módulo como "MVP / Fase 2" sem dividir. **Decidido em 18/11/2026:** MVP = espelho (RF47), fechamento com data de corte (RF46) e reabertura (RF49), porque a ciência no espelho fechado (RF48, E1) e a regra "período fechado não recalcula" dependem deles; **fase 2 = pedido do AEJ** (RF50). A especificação punha RF46 e RF49 na fase 2; prevaleceu a dependência.

**Tabelas:**
- `periodos_fechamento` (`empresa_id`, `data_inicio`, `data_fim`, `status` = `aberto`|`fechado`|`reaberto`)
- `eventos_periodo_fechamento` (**só INSERT**): `fechamento_id`, `tipo` = `fechado`|`reaberto`, `motivo`, `autor_id`, `criado_em`. Histórico completo de fechar e reabrir
- `totais_fechamento` (um por colaborador ao fechar): totais do período + `hash_dados` (SHA-256 do conteúdo canônico). **Imutável**, prova do que foi fechado
- `espelhos_ponto` (`colaborador_id`, `fechamento_id`, `arquivo_chave`, `arquivo_sha256`, `gerado_em`, `versao`)
- `exportacoes_aej` (`fechamento_id`, `arquivo_chave`, `assinatura_chave`, `solicitado_por_id`, `gerado_em`)
- `ciencias_espelho`: ver E1

**Endpoints:** `GET /closings` · `POST /closings` (abre período) · `POST /closings/:id/close` · `POST /closings/:id/reopen` (**só `rh`, com `reason`**) · `GET /closings/:id/mirrors` (espelho de ponto **da equipe**) · `POST /closings/:id/aej` (pede o AEJ) · `GET /employees/:id/mirror?month=`.

**Regras:**
- **Antes de fechar**, o sistema lista pendências do período: pedidos de ajuste em aberto (G5), atestados em análise (G6/G7), dias `inconsistente` (G4). O RH pode fechar mesmo assim, **informando o motivo**, que fica no evento.
- **Ao fechar:** calcula o DSR (reflexo das extras e desconto por falta injustificada, RN08), congela `totais_fechamento`, marca os dias como `fechada` e dispara `generate-mirror`. Depois da data de corte, nada do período muda sem reabertura (RF46).
- **Desempenho (RNF08):** fechar o mês de 500 colaboradores em menos de 1 minuto. O fechamento trabalha em lote por SQL sobre `apuracoes_dia` já calculadas, sem recalcular dia a dia.
- **Espelho (art. 84 da Portaria):** empregador; colaborador (nome, CPF, admissão, cargo); período; horário contratual; marcações **originais e tratadas**; duração das jornadas, com hora noturna reduzida. Gerado em PDF e guardado no S3; o colaborador acessa no mês seguinte, no mínimo.
- **Reabertura:** só RH, com motivo, evento de auditoria com severidade `critico`. Depois dela, os dias voltam a ser recalculáveis e o colaborador precisa de **nova ciência**.
- **Batida offline tardia em período fechado** não altera nada; gera `timesheet.late_punch_detected` (alerta ao RH).
- **AEJ:** o `signer` gera e assina (CAdES `.p7s`). O leiaute vigente precisa ser conferido no gov.br **[A CONFIRMAR]** (`02` §10, item 3).

### G11 · Painel do dia e indicadores (MVP)

**Sem tabela nova.** Só leitura, com escopo (gestor: equipe; RH: empresa).

**Endpoints:** `GET /dashboard/today?establishmentId&departmentId` (presentes, ausentes e atrasados) · `GET /dashboard/pending` (pendências de aprovação: ajustes, atestados, férias; **e dias inconsistentes**, RF55; e os alertas de `check-deadlines`) · `GET /dashboard/indicators?month` (extras, faltas, saldo do banco, **férias vencendo**, RF56) · `GET /dashboard/away` (quem está de férias ou afastado).

**Regras:**
- **Hoje** ainda não tem `apuracoes_dia` fechada: o painel combina **marcações do dia lidas do ARP** com a **escala esperada** (quem já deveria ter entrado) e os afastamentos. Cache curto no Valkey (15 a 30 s). **Tempo real por SSE** é opcional (a Visage já usa).
- **Indicadores do mês** agregam `apuracoes_dia` (SQL; *materialized view* só se ficar lento).
- Nenhum dado de saúde aparece aqui: afastamento sem CID.

### G12 · Relatórios e exportação (Fase 2)

**Tabelas:** `relatorios` (`tipo`, `parametros JSONB`, `formato` = `pdf`|`xlsx`|`csv`, `status`, `arquivo_chave`, `solicitado_por_id`, `expira_em`) · `codigos_verba_folha` (mapa de evento do Genus, como `hora_extra`, `adicional_noturno`, `falta`, `pagamento_banco_horas`, para a verba da folha do cliente: `evento`, `codigo_verba`) · `exportacoes_folha` (`fechamento_id`, `layout`, `arquivo_chave`, `gerado_em`).

**Endpoints:** `POST /reports` (cria o job) · `GET /reports/:id` e `/file` · `GET /payroll-exports` · `POST /closings/:id/payroll-export` · `GET /audit-logs` (trilha de alterações, sobre `logs_auditoria`).

**Regras:**
- Relatório é **job assíncrono** (PDF e Excel); o arquivo vai ao S3 e expira. Gestor só gera da equipe. Tipos (RF58): extras, faltas, banco de horas, férias e afastamentos.
- **Conteúdo da exportação (RF59):** eventos do mês por colaborador: horas normais, extras a 50% e a 100%, adicional noturno, faltas, DSR descontado e abonos. **Sem salário** até o contador responder se precisa dele para o bônus **[A CONFIRMAR]**. O Genus **não calcula a folha** (§13); o papel `contador` baixa o arquivo dos estabelecimentos atribuídos.
- **Exportação para a folha:** a saída depende do sistema do contador (Domínio, Alterdata, Senior, TOTVS e outros). **Proposta:** começar com um **CSV genérico** com o mapeamento `codigos_verba_folha`, e acrescentar layouts específicos sob demanda. **[A DECIDIR]** quais sistemas (§9, item 8).
- **Trilha de auditoria de alterações (RF60)** é uma tela sobre `logs_auditoria` (já existe como padrão): quem, quando, o quê e motivo. O RH vê só a própria conta.
- **Avisos por e-mail ou WhatsApp:** ver E6.

### Super Admin (painel da operação Genus)

**Não é módulo do cliente.** É o painel da equipe Genus para operar a plataforma: contas, status, uso e saúde técnica. Não mostra dado de colaborador, batida, atestado, biometria nem CID (§1.4). Sem RF próprio: atende §1.4 (papel `super_admin`), §7.2 (auditoria) e `security-lgpd.md` §5. Contrato da api e do portal: `docs/prompts/super-admin-contrato.md`; fonte da verdade em `apps/api/src/modules/super-admin/contract.ts`. Tela: `/admin` em `apps/portal`.

**Acesso:** guarda `authorize('super_admin')` no escopo de `/portal/super-admin`, antes da validação. Cliente (`admin`, `rh`, `gestor`, `contador`, `colaborador`) recebe 403. Super_admin sem 2FA recebe 403 `MFA_REQUIRED`, e a sessão só serve para `/auth/two-factor/*`; o portal leva para `/admin/ativar-2fa`. Sem sessão, 401.

**Tabelas (migrations 0014 e 0015, schema `rh`):**
- `contas` ganha `motivo_suspensao`, `suspensa_em`, `suspensa_por_id` (→ `usuarios`) e `atualizado_em` (trigger). `ck_conta_suspensao_coerente`: `eh_ativo = false` só com `suspensa_em` preenchido e motivo.
- `tentativas_login` (só INSERT): `conta_id` e `usuario_id` ficam nulos quando o e-mail não casou com nenhum usuário; `email_hash` (HMAC-SHA256, nunca o e-mail em claro); `endereco_ip`, `agente_usuario`; `etapa` (`senha` | `totp`); `eh_sucesso`; `motivo` (`credencial_invalida` | `usuario_inativo` | `conta_suspensa` | `totp_invalido`), coerente com `eh_sucesso`; `criado_em`. Índices: `(endereco_ip, criado_em DESC)` e `(criado_em DESC)`.
- Índices novos: `idx_auditoria_usuario (usuario_id, id DESC)` e `idx_sessao_conta (conta_id, expira_em DESC)`.
- Retenção de `tentativas_login`: **90 dias [A CONFIRMAR]** (limpeza por job; a linha sai só pela rotina, nunca por UPDATE).

**Endpoints** (prefixo `/portal/super-admin`, 20 rotas; `window` = `24h` | `7d` | `30d`, padrão `24h`):

| Área | Método e caminho | Uso |
|---|---|---|
| Contas | `GET /tenants` | Lista com `q`, `status` (`ativa` \| `suspensa`) e paginação |
| | `POST /tenants` | Cria conta, empresa, estabelecimento e o convite do admin numa transação; 201 com o `token` do link (uma vez) |
| | `GET /tenants/:tenantId` | Detalhe: empresas, admins (sem `colaborador_id`), `hasCompanyKey` |
| | `PATCH /tenants/:tenantId` | Renomeia a conta |
| | `POST /tenants/:tenantId/suspend` | Suspende com motivo |
| | `POST /tenants/:tenantId/reactivate` | Reativa com motivo |
| Auditoria | `GET /audit-logs` | Trilha com filtros e cursor (`tenantId`, `userId`, `entity`, `action`, `from`, `to`) |
| | `GET /audit-logs/:id` | Evento com `before`/`after` redigidos |
| Acessos | `GET /access/sessions` | Sessões ativas e expiradas (e-mail do usuário do portal e IP) |
| | `GET /access/login-attempts` | Tentativas de login (sem e-mail) |
| | `GET /access/flagged-ips` | IPs com falhas na janela; só sinaliza |
| | `POST /access/sessions/:sessionId/revoke` | Derruba uma sessão (com motivo) |
| | `POST /access/users/:userId/revoke-sessions` | Derruba todas as sessões de um usuário (com motivo) |
| Reconhecimento | `GET /recognition/summary` | Agregado da janela (contagens, escores, histograma de vivacidade) |
| | `GET /recognition/series` | Série por hora ou dia (`bucket`) |
| | `GET /recognition/devices` | Agregado por aparelho |
| Estatísticas | `GET /stats/overview` | Contas, colaboradores, aparelhos, batidas por dia, taxa processada, uso dos módulos, top contas |
| | `GET /stats/tenants/:tenantId` | Mesmos números, para uma conta |
| | `GET /stats/growth` | Série mensal (1 a 36 meses) |
| Saúde | `GET /system-health` | Estado de api, bancos, Valkey, engine, coletor, rep-core e jobs (cache de 5 s) |

**Regras:**
- `from`/`to` são ISO com fuso, intervalo `[from, to)`, no máximo 90 dias (400 `VALIDATION_ERROR`).
- Suspender exige motivo e grava `motivo_suspensao` e `suspensa_em`. Suspender conta já suspensa: 409 `TENANT_ALREADY_SUSPENDED`. Reativar conta ativa: 409 `TENANT_NOT_SUSPENDED`.
- Suspender desativa a conta e derruba as sessões dela (trigger). Login e requisição de usuário de conta suspensa: 401 `ACCOUNT_SUSPENDED`, com a mensagem "Conta suspensa. Fale com o suporte do Genus."
- **Suspensão bloqueia só o login no portal.** Os totens continuam registrando batidas **[A CONFIRMAR]**. A obrigação de registro (Portaria 671) pesa contra parar a coleta; suspender a coleta também precisa de parecer jurídico.
- Criar conta: CNPJ com dígito verificador (400 `CNPJ_INVALIDO`); e-mail do admin já existente na plataforma (409 `EMAIL_IN_USE`); sem `MASTER_KEY` no ambiente (503 `MASTER_KEY_AUSENTE`). A DEK da empresa é criada e guardada cifrada pela `MASTER_KEY`.
- Revogar sessão exige motivo e grava `session` + `exclusao`.
- **Sinalização de IP:** `flagged` por `muitas_falhas` ou `muitas_contas` (contas distintas tentadas a partir do mesmo IP). Os limiares e a janela padrão são **[A CONFIRMAR]**. Sinalizar não bloqueia nenhum IP nem login.
- Toda resposta é `strictObject`: nenhum CPF, nome de colaborador, batida individual, biometria, `_hash`, `_cifrado`, `email_hash`, token ou segredo. Única exceção: `token do convite`, só na criação da conta.

**Auditoria:** `tenant` + `criacao`/`alteracao` (suspender e reativar com motivo); `tenant_admin` + `criacao`; `session` + `exclusao` (com motivo); `super_admin` + `criacao`/`alteracao` no bootstrap (`tenantId` nulo). Toda escrita é auditada na mesma transação.
- **Leituras entre contas** (`audit_log`, `access_log`, `recognition_stats`, `tenant_stats`) gravam `leitura_sensivel` por requisição, com os filtros em `dados_depois`. `entidade_id` é o `tenantId` filtrado, ou `0` quando a consulta é de todas as contas.

**LGPD:**
- **Reconhecimento só em agregado** (§1.4): contagens e escores de `arp.entradas`, sem linha de batida. `notRecognized`, `livenessFailed`, `latencyP50Ms` e `latencyP95Ms` saem sempre `null`, porque o arp não guarda tentativas falhas nem latência.
- Nenhum dado de saúde (atestado, CID, texto de OCR) e nenhuma biometria aparece em tela ou endpoint do painel.
- **Tentativas de login:** o e-mail entra só como HMAC-SHA256 (`email_hash`); IP e agente de usuário ficam para investigar abuso. Retenção de 90 dias **[A CONFIRMAR]**.
- **Chave mestra:** a `MASTER_KEY` (KEK) passou a existir também no processo da api do RH, só para criar a DEK de uma empresa nova. Ela não é guardada nem logada (`security-lgpd.md` §2).
- **Bootstrap do super_admin** por ambiente: `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME`, `SUPER_ADMIN_PASSWORD_HASH` (scrypt do Better Auth, preferido em prod) ou `SUPER_ADMIN_PASSWORD` (só dev). Senha e hash nunca vão para log nem para auditoria.
- Acesso excepcional do super_admin a dados de um cliente continua **fora** deste painel (§9, item 22). Este painel não abre dado de colaborador.

**Variáveis de ambiente (`apps/api`):** `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME`, `SUPER_ADMIN_PASSWORD_HASH` ou `SUPER_ADMIN_PASSWORD`, `MASTER_KEY` (64 hex), `VALKEY_URL` e `COLLECTOR_API_URL` (o último, usado pelo check `collector_api` do `GET /system-health`). Todas são opcionais no código; em produção, a api avisa em log quando faltam (`warn`).

**Pendente, para a equipe do ponto (fora do escopo deste módulo):**
- **Gravar as tentativas de reconhecimento** (não reconhecida, falha de vivacidade, latência e IP do aparelho). Hoje `arp.entradas` só tem as batidas aceitas. Sem isso, `notRecognized`, `livenessFailed`, `latencyP50Ms` e `latencyP95Ms` ficam `null`. É mudança no coletor e no `rep-core`.
- **Índice `entradas (conta_id, marcado_em)`** para o painel de reconhecimento por período (a consulta filtra por conta e janela de tempo).

**Pendente, deste módulo:** tela de acesso excepcional (§9, item 22); alerta ao super_admin quando um IP passar do limiar; exportação da trilha.

---

## 4. Painel do funcionário (celular)

O painel do colaborador é uma **área responsiva do portal Next.js (`/me`), instalável como PWA**. **[A DECIDIR]** (§9, item 2). Precisa funcionar em **celular simples, com linguagem clara e poucos cliques** (RF53, RNF01, RNF10); telas principais em menos de 2 s (RNF08). Todos os endpoints são `/me/*` e **ignoram qualquer `employeeId` recebido**: usam o do login. **O painel não registra ponto** (o ponto continua nos coletores), o que respeita o ponto de `01` §2: a empresa não pode obrigar o funcionário a usar o celular pessoal para bater ponto.

| # | Módulo | Fase | Endpoints | Reusa |
|---|---|---|---|---|
| E1 | **Meu ponto** (RF48, RF51) | MVP | `GET /me/timesheets/today` · `GET /me/timesheets?month` (espelho do mês) · `GET /me/punches/:id/receipt` (comprovante PDF) · `POST /me/mirrors/:id/acknowledge` | G4, G10, `gerar_pdf` (já existe) |
| E2 | **Meus pedidos** (RF23, RF52) | MVP | `GET|POST /me/adjustment-requests` · `POST /me/adjustment-requests/:id/cancel` | G5 |
| E3 | **Meus atestados** (RF27) | MVP | `POST /me/certificates/uploads` (URL assinada) · `POST /me/certificates/:id/complete` · `GET /me/certificates` (status e **motivo**; sem CID) | G6, G7 |
| E4 | **Meu banco de horas** | MVP | `GET /me/time-bank` (saldo) · `GET /me/time-bank/entries` (extrato) · vencimentos | G8 |
| E5 | **Minhas férias** | Fase 2 | `GET /me/vacations` (dias disponíveis, próximas) · `POST /me/vacations/requests` | G9 |
| E6 | **Avisos** | Fase 2 | `GET /me/notifications` · `POST /me/notifications/:id/read` · `PUT /me/notification-preferences` | `notificacoes` |

- **E1, visualização (RF51):** batidas do dia, espelho do mês e comprovantes, só leitura.
- **E1, ciência no espelho fechado (RF48):** `ciencias_espelho` (`colaborador_id`, `espelho_id`, `tipo` = `ciente`|`contestado`, `registrado_em`, `endereco_ip`, `agente_usuario`, `nota`). Contestar abre um pedido de ajuste (G5). Reabrir o período invalida a ciência.
- **E1, comprovantes:** o PDF assinado de cada batida já é gerado pelo job existente; o painel só lista e serve por URL assinada (mínimo das últimas 48 h, `01` §3.5; todos ficam guardados).
- **E3, upload:** direto para o S3 por URL assinada de PUT (câmera ou arquivo), depois `complete`. A API valida tipo e tamanho e dispara `analyze-certificate`. O colaborador **nunca** vê o CID nem a nota de risco: só o status e o motivo da decisão.
- **E6, avisos** (`notificacoes`: `usuario_destino_id`, `tipo`, `canal` = `in_app`|`email`|`whatsapp`|`push`, `dados JSONB`, `status`, `enviado_em`, `lido_em`): eventos como pedido decidido, férias ou banco perto de vencer e espelho pronto para ciência. O worker `send-notification` escolhe o canal pela preferência. **WhatsApp tem custo por mensagem**: só avisos prioritários, com *opt-in*, como já avisado em `03` §4.
- **Login do colaborador (implementado em 27/11/2026):** o `rh` ou o `admin` abre *Colaboradores → Acesso ao portal*, informa o e-mail e recebe o link do convite uma vez (`POST /employees/:id/access-invite`; situação em `GET /employees/:id/access`; cancelar em `POST /employees/:id/access-invite/revoke`). Nome e CPF vêm do cadastro: no aceite (`/convite`), o colaborador confirma o próprio CPF e cria a senha; o usuário nasce com papel `colaborador` e `colaborador_id` (migration 0023, `convites_usuario.colaborador_id`). Depois entra em `/login` com e-mail e senha, no celular ou no computador, e vai para `/me`. Um convite novo cancela o pendente; quem já tem usuário recebe 409 `COLABORADOR_COM_ACESSO`; desligado recebe 409 `COLABORADOR_DESLIGADO` (e o link pendente deixa de valer). Esses convites não aparecem em *Usuários*. Sem envio de e-mail nem WhatsApp: quem convida entrega o link.

---

## 5. Integrações externas

| Necessidade | Módulo | Opções | Recomendação | Estado |
|---|---|---|---|---|
| **OCR de atestado** | G6 | (a) **local**: Tesseract ou PaddleOCR no worker Python. (b) **nuvem**: Google Document AI/Vision, AWS Textract, Azure | **(a)**: dado de saúde não sai da infraestrutura e dispensa operador adicional. Qualidade menor em foto de celular, compensada por pré-processamento e porque **o RH decide**. (b) só com contrato de operador e avaliação de transferência internacional | **[A DECIDIR]** |
| Armazenamento | G6, G10, G12, E3 | S3 ou compatível | Já previsto (`02` §4.5) | Decidido |
| Assinatura de PDF/AEJ | G10 | `signer` (pyHanko), interno | Já previsto | Decidido |
| Geração de PDF (espelho, relatórios) | G10, G12 | Composição em Node (pdfkit ou Playwright) + assinatura no `signer` | Node compõe, `signer` assina | **[A DECIDIR]** biblioteca |
| Excel | G12 | `exceljs` | — | Decidido |
| E-mail transacional | G12, E6 | Amazon SES, Resend, Brevo ou SMTP | Qualquer provedor atrás de uma interface `Mailer` | **[A DECIDIR]** |
| WhatsApp | G12, E6 | WhatsApp Business Platform (Meta Cloud API, direta ou por BSP) | Só avisos prioritários; custo por mensagem; *opt-in* | **[A DECIDIR]** |
| Push | E6 | Web Push (VAPID), sem custo | Para o PWA | Fase 2 |
| Folha de pagamento | G12 | Layout por sistema do contador | CSV genérico + mapeamento de verbas; layouts sob demanda | **[A DECIDIR]** quais |
| Feriados | G3 | Nenhuma: cálculo local. BrasilAPI só para conferência opcional | Cálculo local | Decidido |
| Validação de CRM | G6 | Apenas formato (UF + número) | Sem consulta externa; **[A CONFIRMAR]** se existe API oficial utilizável | Decidido (formato) |
| Hora legal | G4 | `chrony` com `ntp.on.br` | Já previsto (`02` §7) | Decidido |

---

## 6. Jobs e filas novos

Complementam `03` §8. Nomes em inglês (`database.md` §12). Todos idempotentes, com `jobId` determinístico (`backend.md` §8).

| Fila / job | Gatilho | O que faz |
|---|---|---|
| `recalculate-day` | Evento (marcação, pedido, afastamento, escala, feriado) | Recalcula o dia (G4), grava o diferencial do banco (G8). **É o `calcular_jornada` de `03`** |
| `analyze-certificate` | Upload concluído (E3) | OCR, regras e nota de risco (G6) |
| `generate-mirror` | Fechamento (G10) | Espelho em PDF por colaborador. **É o `espelho_mensal` de `03`** |
| `generate-aej` | Pedido do RH (G10) | AEJ e `.p7s` pelo `signer` |
| `seed-holidays` | Anual e sob demanda | Feriados nacionais do ano (G3) |
| `check-deadlines` | Diário | Banco vencendo/alto, férias vencendo, afastamentos somando mais de 15 dias em 60, vencimento de crédito (`pagamento`), escalas acima da regra de jornada que vai entrar em vigor (RF11) |
| `send-notification` | Evento (fase 2) | E-mail, WhatsApp, push, in-app (E6) |
| `generate-report` | Pedido do usuário (fase 2) | PDF/Excel e exportação para a folha (G12) |
| `purge-certificates` | Diário | Aplica a retenção de atestados **[A CONFIRMAR]** |

---

## 7. Permissões e auditoria

### 7.1 Matriz (resumo)

`rh` e `gestor` valem dentro dos estabelecimentos atribuídos (§1.4). `admin` configura e lê; do dia a dia, cadastra, altera e desliga colaboradores, cria e atribui escalas e cuida das férias (desde 27/11/2026). A coluna `gestor` só vale com o papel habilitado. O `super_admin` não entra nos módulos de RH (§1.4).

| Módulo | `admin` | `rh` | `gestor` (opcional, equipe) | `colaborador` | `contador` |
|---|---|---|---|---|---|
| G1 Cadastros | Empresa, estabelecimentos, usuários (convites de `admin` e `rh`, da conta inteira ou de uma empresa) e permissões; cadastrar, alterar e desligar colaboradores; ler vínculos, com salário **[A CONFIRMAR]** | CRUD de colaboradores, vínculos, setores, cargos | Ler equipe, **sem salário** | – | – |
| G2 Escalas | Regras de jornada da conta; CRUD de escalas, atribuição e troca pontual | CRUD | Ver calendário; criar troca pontual | Ver a própria | – |
| G3 Feriados | Regra de feriado trabalhado | CRUD | Ler | – | – |
| G4 Apuração | Parâmetros (`configuracoes_empresa`) | Tudo, recalcular | Ler equipe | Própria | – |
| G5 Ajustes | Ler | Decidir (inclusive a equipe), **revisar**, criar abono | **Decidir pedidos da equipe** | Criar e acompanhar os próprios | – |
| G6 Análise de atestado | – | Tudo | **Nada** | – | – |
| G7 Atestados e afastamentos | Vê "afastado", **sem CID e sem arquivo**; não decide | Decidir; ver CID | Vê "afastado", sem CID e sem arquivo | Envia; vê status e motivo | – |
| G8 Banco de horas | Políticas | Tudo | Ler equipe | Próprio | – |
| G9 Férias | Abrir período, pedir, decidir e cancelar | Tudo, decidir (inclusive a equipe), confirmar | Decidir equipe (1ª instância) | Próprias | – |
| G10 Fechamento | Ler | Fechar, **reabrir** | Ver espelho da equipe | Ver e dar ciência no próprio | – |
| G11 Painel | Empresa | Empresa | Equipe | – | – |
| G12 Relatórios | Ler | Tudo | Da equipe | – | Baixar exportação da folha (RF59) |

Quem acumula papéis (ex.: `admin` que também é `rh`) tem a soma dos alcances.

### 7.2 Eventos de auditoria novos (catálogo em `lib/audit-events.ts`; chaves em inglês)

`employee.created|changed|terminated` · `user.invited` · `user.invite_revoked` · `user.invite_failed` · `user.invite_accepted` (hoje gravados como entidade `user_invite` com `criacao`/`alteracao`) · `user.scope_changed` · `user.password_reset` · `user.unlocked` · `feature.toggled` · **`support_access.granted|expired` (severidade `critico`, visível ao `admin` da conta)** · `company_settings.changed` · `schedule.assigned` · `schedule_override.created` · `workweek_rule.changed` · `holiday.created|changed` · `adjustment.requested|approved|rejected|canceled|revised` · `time_waiver.granted` · `certificate.submitted|analyzed|approved|rejected` · **`certificate.viewed`**, **`certificate.file_downloaded`** (leitura de dado de saúde) · `absence.created|ended` · `time_bank.entry_created|policy_changed` · `compensatory_leave.requested|approved` · `closing.closed` · **`closing.reopened` (severidade `critico`)** · `mirror.acknowledged|contested` · `aej.generated` · `payroll_export.generated` · `timesheet.recalculated` · `timesheet.late_punch_detected`.

---

## 8. Ordem de construção e corte para 25/11

O MVP do quadro é grande para a data. Esta é a ordem pela **cadeia de dependência**, com o que cortar primeiro se apertar. A decisão de corte é sua.

**Fundação (fora do quadro, mas pré-requisito de tudo):** projeto `apps/api` (Fastify, `env`, erros, Pino, OpenAPI) · autenticação, papéis e escopo de equipe · convite e primeiro acesso do colaborador · `request-context`, auditoria e `redactDiff` · cliente S3 e URL assinada · outbox e filas · `ArpReader` (leitura do ARP) · `configuracoes_empresa` · *seeds* (feriados nacionais, `tipos_licenca`, regra legal de jornada) · **importação em massa de colaboradores (CSV)**, que não está no quadro mas torna o onboarding viável.

**Trilha crítica:**

```
Fundação → G1 Cadastros → G2 Escalas ─┐
                          G3 Feriados ─┴→ G4 Apuração ─┬→ G5 Ajustes ───────┐
                                                        ├→ G7 Afastamentos ──┤
                                                        │   └─ G6 Atestados  ├→ G10 Fechamento → G11 Painel
                                                        └→ G8 Banco de horas ┘
Painel do funcionário (E1–E4): cada tela entra assim que o módulo G correspondente existe
```

| Ordem | O que | Por quê |
|---|---|---|
| 1 | Fundação + **G1, G2, G3** | Quase só CRUD; destravam a apuração. G2 e G3 correm em paralelo |
| 2 | **G4 Apuração** | **O item mais arriscado do MVP**: regra trabalhista, testes por tabela de casos, parâmetros por empresa |
| 3 | **G5, G7** | Alimentam a apuração. G7 sem análise automática já entrega valor |
| 4 | **G8 Banco de horas** | Depende da apuração (créditos) |
| 5 | **G10 Fechamento** (espelho e fechar/reabrir) | Fecha o ciclo do mês |
| 6 | **G11 Painel** | Só leitura; vem depois que existem dados |
| 7 | **E1–E4** | Camada fina sobre os módulos acima |
| 8 | **G6 Análise heurística** | Maior incerteza técnica (OCR); **candidata natural a corte** |

**Cortes sugeridos, do menos ao mais doloroso:**
1. **G6 entra só como fila manual.** G7 já recebe o atestado, o RH decide e a análise automática vem depois. A tabela `analises_atestado` e o `achados` já ficam no schema.
2. **G10 sem PDF assinado:** espelho em tela e fechamento, deixando o PDF e o AEJ para a fase 2.
3. **G11 só com "hoje" e "pendências"**, deixando os indicadores do mês para depois.
4. Menos corte possível em **G4**: sem ela o resto não tem sobre o que operar.

---

## 9. Decisões em aberto

| # | Decisão | Recomendação |
|---|---|---|
| 1 | **OCR de atestado:** local ou nuvem | Local (§5) |
| 2 | **Painel do funcionário:** PWA no portal ou app Expo | PWA no Next.js: reaproveita a API e dispensa publicação em loja para 25/11 |
| 3 | **Login do colaborador:** CPF + senha, link por e-mail/WhatsApp ou código | Convite por e-mail + senha; WhatsApp só na fase 2. **Feito em 27/11/2026** (link entregue por quem convida; envio automático pendente) |
| 4 | **Escopo do gestor:** só diretos ou toda a hierarquia | Diretos no MVP |
| 5 | **Base facial "existente":** onde moram os embeddings e como `colaboradores` se liga | **Decidido:** banco `app`, `embeddings_faciais` (um por colaborador; `person_id` = `colaborador_id`), DEK por empresa em `chaves_empresa` (ver RF04 em §1) |
| 6 | **Fechamento:** por empresa ou por estabelecimento | Por empresa. **Decidido:** fechar e reabrir no MVP, AEJ na fase 2 (G10) |
| 7 | **Parâmetros trabalhistas** (tolerância, noturno, extras, DSR, banco, feriado trabalhado) | Parametrizar por empresa; validar os padrões com o contador e com a convenção coletiva do cliente |
| 8 | **Folha:** quais sistemas exportar | CSV genérico primeiro; layouts por demanda |
| 9 | **Retenção** de atestados e de biometria; base legal | Parecer jurídico (`01` §6) |
| 10 | **CPF em claro ou cifrado** (conflito com `02` §8) | Em claro; cifrar só saúde e biometria (`database.md` §10) |
| 11 | **Row-Level Security** como segunda barreira de conta | Avaliar após o MVP |
| 12 | **Better Auth × multi-tenant, `sessao_id` da auditoria e nomes de tabela em português** | **Decidido (22/11/2026):** tabelas em português no schema `rh`, usuário = `usuarios`; `conta_id` da sessão copiado do usuário por trigger; `req.ctx.sessionId` = `sessoes.id` (`database.md` §13, `backend.md` §4) |
| 13 | **Biblioteca de PDF** (pdfkit ou Playwright) | Escolher no primeiro espelho |
| 14 | **Convenção coletiva:** o cliente pode ter regras que mudam os parâmetros | Suportar `regras_jornada.origem = 'acordo'` e parâmetros por empresa desde o início |
| 15 | **Perfis** | **Decidido em 18/11/2026:** seis papéis (§1.4): `admin`, `rh`, `gestor` (opcional), `contador`, `colaborador` e `super_admin` |
| 16 | **Escopo por estabelecimento** para todos os papéis (RNF02) | **Decidido em 18/11/2026:** `usuarios_estabelecimentos`; sem linha = conta inteira (§1.4) |
| 17 | **AFD e AEJ para o fiscal** | **Resolvido em 18/11/2026:** o fiscal usa o portal fiscal existente do `rep-core`; não há perfil de fiscal no RH |
| 18 | **Trabalho noturno rural (RN07):** parâmetro por empresa, estabelecimento ou colaborador | Por empresa no MVP; revisar se houver cliente misto |
| 19 | **Fuso:** a especificação fixa `America/Sao_Paulo` (RNF07); o desenho usa o fuso do estabelecimento com esse padrão | Manter por estabelecimento: atende a especificação e cobre filial em outro fuso |
| 20 | **Gestor** | **Decidido em 18/11/2026:** opcional, desativado por padrão; sem gestor, o RH aprova direto (§1.4) |
| 21 | **Salário-base** visível ao `admin`; salário na exportação (RF59) | **[A CONFIRMAR]** com o contador. Até lá: RH e `admin` veem; o RF59 sai sem salário. `security-lgpd.md` §1 ainda diz "salário só RH" |
| 22 | **Duração do acesso de suporte** do `super_admin` | **[A DECIDIR]**. Sugestão: curta (ex.: 24 h), renovável com novo chamado |

---

## 10. Regras de negócio e legais (RN)

Todo valor legal fica em **parâmetro com vigência** por empresa ou acordo coletivo (`configuracoes_empresa`, `regras_jornada`, `tipos_licenca`, `politicas_banco_horas`), nunca fixo no código. A especificação indica a fonte de cada regra; as marcadas "conferir" nela estão **[A CONFIRMAR]** aqui, e todas seguem sujeitas ao parecer trabalhista (`01` §4 e §6).

| Código | Regra | Fonte | Onde |
|---|---|---|---|
| RN01 | Batida original nunca é alterada nem apagada; ajuste é marcação tratada separada | Portaria MTP 671/2021 | G4, G5, G10 |
| RN02 | Tolerância de 5 min por batida, até 10 min no dia; acima disso conta tudo | CLT art. 58 §1º | G4 |
| RN03 | Intervalo mínimo de 1 h acima de 6 h de jornada; 15 min entre 4 h e 6 h | CLT art. 71 | G2, G4 |
| RN04 | Mínimo de 11 h entre jornadas | CLT art. 66 | G2, G4 |
| RN05 | Hora extra até 2 h/dia, mínimo 50%; domingo e feriado sem folga compensatória a 100% | CLT art. 59; CF art. 7º | G3, G4, G8 |
| RN06 | Jornada semanal: 44 h até 15/12/2026; 42 h e 2 folgas de 16/12/2026 a 15/12/2027; 40 h a partir de 16/12/2027. Liminar do STF pode mudar detalhes **[A CONFIRMAR]** | EC 141/2026 | G2 |
| RN07 | Noturno urbano 22h–5h, 20%, hora de 52 min 30 s. Rural: 21h–5h lavoura, 20h–4h pecuária, 25%, sem hora reduzida **[A CONFIRMAR]** | CLT art. 73; Lei 5.889/1973 | G4 |
| RN08 | Falta injustificada na semana desconta o DSR | Lei 605/1949 | G4, G10 |
| RN09 | Banco de horas: 6 meses por acordo individual escrito, 1 ano por acordo coletivo; saldo não compensado é pago como extra | CLT art. 59 §§2º e 5º | G8 |
| RN10 | Férias: 30 dias; 6–14 faltas = 24; 15–23 = 18; 24–32 = 12; mais de 32 = perde | CLT art. 130 | G9 |
| RN11 | Até 3 períodos (um ≥ 14 dias, demais ≥ 5); não iniciar nos 2 dias antes de feriado ou folga; aviso com 30 dias | CLT arts. 134 e 135 | G9 |
| RN12 | Férias fora do período concessivo são pagas em dobro | CLT art. 137 | G9 |
| RN13 | Atestado aprovado abona; após 15 dias de afastamento, INSS | Lei 8.213/1991 art. 60 | G7 |
| RN14 | Licenças: casamento 3 dias, falecimento 2, doação de sangue 1/ano, paternidade 5 **[A CONFIRMAR]**, maternidade 120 | CLT art. 473; CF art. 7º | G7 |
| RN15 | Atestado, CID e foto são dados sensíveis: acesso restrito, log de acesso, prazo de guarda | LGPD arts. 11 e 46 | G6, G7, E3 |

## 11. Requisitos não funcionais (RNF)

| Código | Requisito | Como o desenho atende |
|---|---|---|
| RNF01 | Web responsiva no portal Next.js; funcionário usa pelo celular | PWA em `/me` (§4) |
| RNF02 | Permissão por perfil e por estabelecimento ou equipe | Papéis + `usuarios_estabelecimentos` + `gestor_id` (§1.4). O `gestor` só existe se habilitado na conta. **Todo endpoint valida o escopo no servidor**; o front nunca é a barreira. As regras de dados de cliente não se aplicam ao `super_admin` da forma comum: ele não tem escopo de conta e só vê dados de uma empresa pelo acesso excepcional, que expira e fica auditado |
| RNF03 | Auditoria imutável de cadastro, escala, ajuste, atestado, banco e fechamento | `logs_auditoria` só INSERT (§7.2, `database.md` §11) |
| RNF04 | LGPD: atestados com acesso restrito, log de quem abriu, retenção configurável; sensíveis fora de logs | `security-lgpd.md` §3; `purge-certificates` (§6) |
| RNF05 | Apuração determinística | Função pura sem relógio nem banco (G4) |
| RNF06 | Parâmetros legais com vigência; cada cálculo registra a versão da regra usada | Vigência em `configuracoes_empresa` e `regras_jornada`; `apuracoes_dia.configuracao_id`, `regra_jornada_id`, `versao_calculo` |
| RNF07 | Fuso America/Sao_Paulo, hora oficial do ponto | Fuso do estabelecimento, padrão São Paulo (§9, item 19); hora do `arp` |
| RNF08 | Fechar 500 colaboradores em menos de 1 min; telas principais em menos de 2 s | Fechamento em lote (G10); painel com cache curto (G11) |
| RNF09 | RH não escreve no `arp` nem altera o face-engine | §1.3 e §12 |
| RNF10 | Linguagem simples e poucos cliques para aprovar | Aprovar/recusar direto da fila de pendências (G11) |

## 12. Integração com o ponto existente

O RH **lê** dados e **chama** interfaces existentes. Não altera o fluxo da batida, o banco `arp`, o face-engine, a `api-coletor`, o `rep-core` nem o `signer`. Se uma funcionalidade parecer exigir mudança nessas áreas, ela vira pendência para o responsável pelo ponto (ex.: §9, item 17).

| Direção | Dado | Origem / destino |
|---|---|---|
| Ponto → RH | Batidas: CPF, NSR, data e hora, aparelho, estabelecimento | `arp.registros` por papel somente leitura (`ArpReader`), disparado pelo evento `recalculate-day` do `outbox` do `rep-core` |
| Ponto → RH | Batidas atrasadas do modo offline | Mesmo evento; recalcula (RF22) |
| RH → Ponto | Cadastro e desligamento do colaborador | Banco `app` + evento `employee.changed` (registro tipo 5 pelo `rep-core`) + cadastro facial na engine (G1) |
| RH → Ponto | Marcações tratadas e jornada contratual | Banco `app`, lidas pelo worker `jobs` para o espelho e o AEJ |
| RH → Ponto | Espelho e AEJ assinados no fechamento | Outbox → `jobs` (`generate-mirror`, `generate-aej`) → `signer` |

## 13. Fora do escopo

Cálculo da folha de pagamento (INSS, IRRF, FGTS, holerite), envio ao eSocial, recrutamento e seleção, avaliação de desempenho, treinamentos, benefícios e qualquer mudança no reconhecimento facial ou na coleta offline. A folha fica com o contador, que recebe a exportação do RF59 (G12).

## 14. Rotas HTTP implementadas (api do RH, prefixo `/portal`)

Login reaproveitado: Better Auth da api do RH (cookie de sessão ou JWT curto), que monta o `req.ctx` em `apps/api/src/plugins/request-context.ts`. Cada rota declara os perfis; perfil sem permissão recebe 403. Colaborador fora do estabelecimento ou da conta de quem pede recebe 404 (não confirma que existe). `gestor` só entra com `PORTAL_GESTOR_ENABLED=true` e só vê a própria equipe (`colaboradores.gestor_id`).

| Área | Método e caminho | Perfis |
|---|---|---|
| Colaborador (G1) | `GET /employees`, `GET /employees/:id` | rh, admin, contador, gestor |
| | `POST /employees`, `PATCH /employees/:id`, `POST /employees/:id/terminate` | rh, admin |
| | `GET /employees/:id/access`, `POST /employees/:id/access-invite`, `/access-invite/revoke` (acesso do colaborador ao portal) | rh, admin |
| | `POST /employees/:id/pin/reset` (PIN novo para quem esqueceu; sai uma vez, `no-store`, auditado sem o PIN; desligado → 409) | rh, admin |
| | `GET /employees/:id/assignments` | rh, admin |
| | `POST /employees/:id/assignments`, `PATCH /employees/:id/assignments/:assignmentId` | rh |
| Convites | `GET`/`POST /invites`, `POST /invites/:inviteId/revoke` | admin (da conta inteira) |
| | as mesmas sob `/super-admin/tenants/:tenantId/invites` | super_admin |
| | `POST /public/invites/preview`, `POST /public/invites/accept` | público (o token vai no corpo) |
| Escala (G2) | `GET /schedules`, `GET /schedules/:id`, `GET /employees/:id/schedules` | rh, admin |
| | `POST /schedules`, `PATCH /schedules/:id`, `POST /employees/:id/schedules`, troca de escala e trocas de turno | rh, admin |
| Apuração (G4) | `POST /employees/:id/timesheets/recalculate` | rh |
| | `GET /employees/:id/timesheets?from&to` | rh, admin, gestor |
| Ajustes (G5) | `POST /employees/:id/adjustments` | rh |
| | `GET /adjustments`, `POST /adjustments/:id/approve`, `/reject` | rh, gestor (abono só rh; admin não decide) |
| Afastamentos (G7) | `POST /employees/:id/absences` | rh |
| | `GET /employees/:id/absences` | rh, admin, gestor |
| Atestados (G7) | `GET /certificates` | rh (com médico e arquivo), admin e gestor (sem diagnóstico) |
| | `GET /certificates/:id/file` (auditado), `POST /certificates/:id/approve`, `/reject` | só rh |
| Férias (G9) | `POST /employees/:id/vacation-periods`, `POST /employees/:id/vacations`, `POST /vacations/:id/cancel` | rh, admin |
| | `GET /employees/:id/vacation-periods` | rh, admin, gestor |
| | `POST /vacations/:id/approve`, `/reject` | rh, admin, gestor |
| Fechamento (G10) | `GET /closings` | rh, admin, contador |
| | `POST /closings`, `/closings/:id/close`, `/reopen`, `/mirrors` | rh |
| | `GET /closings/:id/mirrors/:employeeId` | rh, admin, contador, gestor |
| Portal do colaborador (§4) | `GET /me/timesheets`, `GET /me/time-bank`, `GET /me/mirrors`, `GET /me/mirrors/:closingId`, `POST /me/mirrors/:closingId/acknowledge`, `GET`/`POST /me/vacations`, `GET`/`POST /me/certificates`, `POST /me/adjustments` | colaborador (sempre o da sessão) |
| Biometria (RF04) | `POST /facial/enrollments` (multipart: cpf, pin, consentAccepted, consentTextVersion, 1 a 5 fotos), `POST /facial/status` (CPF no corpo, nunca na URL) | rh, admin (sessão do totem) |
| Aparelhos / totem (docs/totem-contrato.md) | `GET`/`POST /devices`, `GET`/`PATCH`/`DELETE /devices/:id`, `POST /devices/:id/regenerate-key`, `GET /devices/:id/activity` | rh, admin (escopo de estabelecimento; fora dele 404) |
| | `GET /devices/:id/calibration`, `GET`/`DELETE /devices/:id/calibration/session`, `POST /devices/:id/calibration/start`, `PUT`/`DELETE /devices/:id/calibration/settings`, `POST /devices/:id/calibration/copy` | rh, admin |
| Totem (sem sessão; header `X-Device-Key`) | `GET /totem/context`, `POST /totem/facial/enrollments`, `POST /totem/calibration` | aparelho ativo |
| Busca por texto | `q` (2 a 100 caracteres) em `GET /employees` (nome ou matrícula), `GET /adjustments` e `GET /certificates` (nome ou matrícula do colaborador), `GET /schedules` (nome da escala) | os mesmos de cada lista |

**Totem web.** O aparelho cria-se no painel (`POST /devices`); a chave `gk_` + 40 hex aparece uma vez (só o SHA-256 e o prefixo ficam no banco). O totem envia `X-Device-Key`: chave ausente, malformada, desconhecida ou de aparelho inativo dão o mesmo 401 `CHAVE_APARELHO_INVALIDA`; há limite de chaves inválidas por IP (em memória, por instância). `tenantId` e estabelecimento vêm do aparelho. O cadastro facial reaproveita `FacialEnrollmentService`; o colaborador precisa ser ativo e do estabelecimento do aparelho, senão a mesma resposta genérica `CPF_OU_PIN_INVALIDO`. A calibração (`sessoes_calibracao`) guarda só números agregados: as fotos ficam na memória da requisição e a engine calcula (`/calibrate/recognition` e `/calibrate/liveness`). Excluir aparelho: 409 `APARELHO_COM_BATIDAS` se o arp tem batida dele (leitura em `entradas`); senão apaga (eventos e sessões em cascata). A busca `q` é `ILIKE` sem `unaccent` (a extensão não existe nas migrations), com `%` e `_` escapados; `q` nunca vai a log.

Decisões desta etapa marcadas **[A CONFIRMAR]**:
- calibração com mais de 180 dias vira `desatualizado`;
- busca sem acento (`unaccent`) fica para quando a extensão for criada;
- fuso do estabelecimento pela capital da UF;
- dia que cruza a meia-noite aceita batidas até 4 h depois da saída prevista;
- trabalho noturno `urbano` quando falta o parâmetro;
- `minutos_falta` = afastamento + max(0, falta − atraso);
- o atestado nasce `pendente` (o schema não tem `recebido`);
- atestado por horas não cria afastamento;
- o fechamento só é travado por inconsistência que impede o cálculo (batida ímpar ou duplicada) e por ajuste pendente;
- competência = mês civil;
- limite de anexo de 10 MB;
- salário visível para rh e admin (o `security-lgpd.md` diz "só RH").

Fora desta etapa: OCR e IA do atestado, AEJ (RF50), PDF assinado do espelho (`pdf_url` fica nulo), gravação do CID, S3, criação da DEK da empresa e lançamentos automáticos no banco de horas.

## 15. Portal web (front, `apps/portal`)

Implementado em 24/11/2026 (Next.js 15, React 19, Tailwind 4, shadcn/ui, TanStack Query). Arquitetura e regras do código: `docs/portal-arquitetura-front.md`; mapa de telas: `docs/portal-mapa-front.md`; endpoints que o front já usa em mock e o back ainda não tem: `docs/portal-endpoints-pendentes.md`.

| Rota | Tela | Consome (real) | Mock (sem back) |
|---|---|---|---|
| `/login` | e-mail + senha, 2FA TOTP | `/auth/sign-in/email`, `/auth/two-factor/verify-totp`, `/auth/sign-out`, `GET /me` | — |
| `/rh` | Visão geral | — | `GET /portal/overview`, `GET /portal/establishments` |
| `/rh/colaboradores` | lista, cadastro (PIN uma vez), edição, desligamento, vínculos | `/employees*`, `/employees/:id/assignments*` | setores, cargos, centros de custo |
| `/rh/colaboradores/[id]` | espelho do colaborador + afastamentos | `/employees/:id/timesheets`, `.../recalculate`, `/employees/:id/absences` | — |
| `/rh/apuracao` | apuração do dia | — | `GET /portal/timesheets?date` |
| `/rh/escalas` | escalas, avisos (só sinalizam), atribuição | `/schedules*`, `/employees/:id/schedules` | — |
| `/rh/ajustes` | fila, original × proposta, decisão, lançamento | `/adjustments*`, `/employees/:id/adjustments` | — |
| `/rh/ferias` | calendário por setor, decisão, períodos | `/employees/:id/vacation-periods`, `/employees/:id/vacations`, `/vacations/:id/*` | `GET /portal/vacations/calendar` |
| `/rh/atestados` | fila, análise com IA (só sugere), decisão, arquivo (blob revogado) | `/certificates*`, `/certificates/:id/analyze`, `/analyses`, `/file` | — |
| `/rh/banco-horas` | saldos e extrato | — | `GET /portal/time-bank`, `/employees/:id/time-bank` |
| `/rh/fechamento` | competências, fechar, reabrir (forte), espelhos | `/closings*`, `/closings/:id/mirrors*` | — |
| `/rh/totens`, `/rh/totens/[id]` | aparelhos, chave uma vez, calibração, teste de câmera local | — | `/portal/devices*` (contrato proposto) |
| `/rh/relatorios`, `/rh/configuracoes` | prévias (gerar/salvar desabilitados) | — | `/portal/users`, `/portal/settings`, `/portal/holidays` |
| `/me`, `/me/espelho`, `/me/ferias`, `/me/atestado` | portal do colaborador (mobile) | `/me/*` | — |

`NEXT_PUBLIC_USE_MOCKS=true` liga todos os mocks (o portal roda sem back); com `false`, as telas sem back mostram "Em breve". IDs são opacos no front (`lib/api/ids.ts`): a troca para `publicId` (UUID) é de um arquivo.
