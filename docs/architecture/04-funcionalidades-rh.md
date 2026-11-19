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
| `admin` (cliente) | Configurar empresa, estabelecimentos, usuários, permissões e parâmetros legais (§10). Ver os dados da empresa inteira, inclusive salário-base **[A CONFIRMAR]** com o contador | Ver CID e arquivo de atestado; aprovar atestado | Toda a empresa |
| `rh` | Ver todos os colaboradores; validar atestados (G6, G7); verificar e decidir ajustes (G5) e férias (G9), inclusive os da equipe (faz a parte do gestor); fechar e reabrir o mês (G10); exportar (G12). Ver CID e salário | Alterar batida original | Conta inteira ou estabelecimentos atribuídos |
| `gestor` (**opcional**) | Desativado por padrão. Quando habilitado: ver os subordinados diretos e aprovar ajustes e férias da equipe | Ver CID, arquivo de atestado e salário; fechar o mês | Subordinados diretos (`gestor_id`) dentro do estabelecimento |
| `contador` | Baixar a exportação da folha (RF59) para calcular bônus | Alterar dados; ver CID e salário | Estabelecimentos atribuídos |
| `colaborador` | Ver o próprio ponto, espelho, banco e férias; enviar atestado; pedir ajuste e férias; dar ciência no espelho | Ver dados de outros | Só os próprios dados (`/me/*`) |
| `super_admin` (plataforma Genus) | Painel geral: lista de empresas, status da conta, uso, configurações técnicas, logs de erro e integração, sem dados pessoais. Resetar senha, desbloquear usuário, ativar e desativar funcionalidades por empresa | Acessar dados de colaboradores, batidas, atestados, salários ou CID; alterar registros do cliente | Plataforma, fora da área do cliente |

**Gestor opcional:** o papel só existe se o `admin` o habilitar na configuração da conta, quando o cliente vê necessidade. Sem gestor, os pedidos de ajuste vão direto para a fila do RH (G5) e as férias têm uma instância só (G9, RF41).

**Acesso excepcional do `super_admin`:** só com número de chamado e justificativa. O acesso é temporário, expira sozinho e fica em log visível ao `admin` da empresa (`support_access.granted|expired`, §7.2). Duração **[A DECIDIR]** (§9, item 22). Autenticação em dois fatores obrigatória.

**Escopo por estabelecimento (RNF02):** cada usuário só vê os estabelecimentos atribuídos a ele, em `usuarios_estabelecimentos` (`usuario_id`, `estabelecimento_id`, `UNIQUE (conta_id, usuario_id, estabelecimento_id)`). **Sem nenhuma linha, vale a conta inteira**, o que atende o RH de empresa pequena sem cadastro extra. O escopo de equipe do gestor (`gestor_id`) se soma a esse filtro. O `request-context` resolve os dois em `req.ctx` (`establishmentScope`, `teamScope`).

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
- **Vínculo facial (RF04):** `colaboradores.pessoa_facial_id` guarda o `person_id` que a engine usa nos candidatos. O RH **chama** o cadastro facial existente, sem alterá-lo. A especificação fala em `/cadastrar` (nome previsto em `03` §7.4); na engine atual o cadastro é `POST /embeddings/register` ou `/enroll/*` (`face-engine.md` §3). **[A DECIDIR]** onde mora a base facial "existente" (§9, item 5).
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
- **Login do colaborador:** não está no quadro e é pré-requisito do painel (§8 e §9, item 3).

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

`rh` e `gestor` valem dentro dos estabelecimentos atribuídos (§1.4). `admin` configura e lê; não opera o dia a dia. A coluna `gestor` só vale com o papel habilitado. O `super_admin` não entra nos módulos de RH (§1.4).

| Módulo | `admin` | `rh` | `gestor` (opcional, equipe) | `colaborador` | `contador` |
|---|---|---|---|---|---|
| G1 Cadastros | Empresa, estabelecimentos, usuários e permissões; ler colaboradores, com salário **[A CONFIRMAR]** | CRUD de colaboradores, setores, cargos | Ler equipe, **sem salário** | – | – |
| G2 Escalas | Regras de jornada da conta | CRUD | Ver calendário; criar troca pontual | Ver a própria | – |
| G3 Feriados | Regra de feriado trabalhado | CRUD | Ler | – | – |
| G4 Apuração | Parâmetros (`configuracoes_empresa`) | Tudo, recalcular | Ler equipe | Própria | – |
| G5 Ajustes | Ler | Decidir (inclusive a equipe), **revisar**, criar abono | **Decidir pedidos da equipe** | Criar e acompanhar os próprios | – |
| G6 Análise de atestado | – | Tudo | **Nada** | – | – |
| G7 Atestados e afastamentos | Vê "afastado", **sem CID e sem arquivo**; não decide | Decidir; ver CID | Vê "afastado", sem CID e sem arquivo | Envia; vê status e motivo | – |
| G8 Banco de horas | Políticas | Tudo | Ler equipe | Próprio | – |
| G9 Férias | Ler | Tudo, decidir (inclusive a equipe), confirmar | Decidir equipe (1ª instância) | Próprias | – |
| G10 Fechamento | Ler | Fechar, **reabrir** | Ver espelho da equipe | Ver e dar ciência no próprio | – |
| G11 Painel | Empresa | Empresa | Equipe | – | – |
| G12 Relatórios | Ler | Tudo | Da equipe | – | Baixar exportação da folha (RF59) |

Quem acumula papéis (ex.: `admin` que também é `rh`) tem a soma dos alcances.

### 7.2 Eventos de auditoria novos (catálogo em `lib/audit-events.ts`; chaves em inglês)

`employee.created|changed|terminated` · `user.scope_changed` · `user.password_reset` · `user.unlocked` · `feature.toggled` · **`support_access.granted|expired` (severidade `critico`, visível ao `admin` da conta)** · `company_settings.changed` · `schedule.assigned` · `schedule_override.created` · `workweek_rule.changed` · `holiday.created|changed` · `adjustment.requested|approved|rejected|canceled|revised` · `time_waiver.granted` · `certificate.submitted|analyzed|approved|rejected` · **`certificate.viewed`**, **`certificate.file_downloaded`** (leitura de dado de saúde) · `absence.created|ended` · `time_bank.entry_created|policy_changed` · `compensatory_leave.requested|approved` · `closing.closed` · **`closing.reopened` (severidade `critico`)** · `mirror.acknowledged|contested` · `aej.generated` · `payroll_export.generated` · `timesheet.recalculated` · `timesheet.late_punch_detected`.

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
| 3 | **Login do colaborador:** CPF + senha, link por e-mail/WhatsApp ou código | Convite por e-mail + senha; WhatsApp só na fase 2 |
| 4 | **Escopo do gestor:** só diretos ou toda a hierarquia | Diretos no MVP |
| 5 | **Base facial "existente":** onde moram os embeddings e como `colaboradores` se liga | Definir antes de G1: banco `app` do Genus (importando da Visage) ou leitura cruzada |
| 6 | **Fechamento:** por empresa ou por estabelecimento | Por empresa. **Decidido:** fechar e reabrir no MVP, AEJ na fase 2 (G10) |
| 7 | **Parâmetros trabalhistas** (tolerância, noturno, extras, DSR, banco, feriado trabalhado) | Parametrizar por empresa; validar os padrões com o contador e com a convenção coletiva do cliente |
| 8 | **Folha:** quais sistemas exportar | CSV genérico primeiro; layouts por demanda |
| 9 | **Retenção** de atestados e de biometria; base legal | Parecer jurídico (`01` §6) |
| 10 | **CPF em claro ou cifrado** (conflito com `02` §8) | Em claro; cifrar só saúde e biometria (`database.md` §10) |
| 11 | **Row-Level Security** como segunda barreira de conta | Avaliar após o MVP |
| 12 | **Better Auth × multi-tenant, `sessao_id` da auditoria e nomes de tabela em português** | Validar na fundação (`database.md` §13) |
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
