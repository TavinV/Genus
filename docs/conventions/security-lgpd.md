# Segurança e LGPD

> Resume o que o Genus herda da Visage (`visage/.claude/security.md`: envelope encryption DEK/KEK, consentimento biométrico, retenção de frames) e acrescenta o que as funcionalidades de RH trazem: **dado de saúde** (atestados) e **dado trabalhista**. Todo item **[A CONFIRMAR]** depende do parecer jurídico previsto em `01` §6.

---

## 1. Classes de dado

| Classe | Exemplos | Tratamento |
|---|---|---|
| **Sensível: biometria** | Embedding facial, foto de verificação, recorte de rosto | DEK do tenant (AES-256-GCM); consentimento registrado; retenção mínima; nunca em log |
| **Sensível: saúde** | Atestado (arquivo), CID, texto extraído por OCR, nome do médico/CRM | Cifrado em coluna e em repouso no S3; **CID só para o RH**; acesso e download auditados; nunca em log |
| **Pessoal trabalhista** | CPF, salário, cargo, escala, marcações, banco de horas | Acesso por papel e escopo; salário só RH; marcações no `arp` imutáveis |
| **Operacional** | Status de pedido, indicadores agregados | Escopo do tenant |

## 2. Cifragem

- **Envelope:** `MASTER_KEY` (KEK, 32 bytes, só no ambiente) cifra a **DEK da conta** (tenant), guardada cifrada em `chaves_conta`. A DEK cifra embeddings e colunas `_cifrado`. Rotação da KEK reencripta só as DEKs; rotação de DEK reencripta só os dados daquela conta (`versao_chave`).
- **AES-256-GCM, IV único por operação** (`os.urandom(12)` / `crypto.randomBytes(12)`). **`InvalidTag` nunca é silenciado**: propaga como erro e gera log `critical`.
- Em trânsito: TLS; entre as VMs, WireGuard (os recortes de rosto são biometria).
- Em repouso: volume cifrado no Postgres; **SSE** no bucket do S3. Backups também cifrados.

## 3. Atestados (dado de saúde): regras específicas

1. Upload por **URL assinada** direto para o S3. Bucket privado, prefixo `contas/{conta_id}/atestados/...`.
2. **OCR local** por padrão: o conteúdo do atestado não deve sair da infraestrutura do Genus sem contrato de operador e avaliação de transferência. **[A DECIDIR]** em `04` §5.
3. Colunas `cid_cifrado`, `texto_ocr_cifrado`, `nome_paciente_cifrado` e afins são cifradas; `_hash` serve só para detectar atestado repetido.
4. **Quem vê o quê:** RH (`rh`) vê arquivo, CID e análise. **Gestor** vê "afastado de D1 a D2", sem CID, sem arquivo e sem nota de risco. O **colaborador** vê o próprio atestado e o motivo da decisão.
5. Todo `GET` do arquivo ou do CID gera evento `certificate.viewed` / `certificate.file_downloaded` (quem, quando, IP).
6. **A análise heurística não decide**: produz nota de risco com motivos e **o RH decide**. Nenhum atestado é recusado automaticamente.
7. **Retenção [A CONFIRMAR]:** por quanto tempo guardar o arquivo depois da decisão (e o que apagar na rescisão), e a base legal para o tratamento de dado de saúde pelo empregador.

## 4. Biometria

- Consentimento formal **antes** de qualquer embedding: `consentimentos_biometricos` (versão do texto, data, IP, aparelho, revogação). Revogar apaga os embeddings, marca o status e a engine para de usá-los.
- Exclusão pelo próprio titular e pelo RH seguem a mesma transação (Visage: `eraseUserData`): embeddings e tokens apagados, consentimento mantido como prova, cache da engine invalidado.
- **Desligamento do colaborador** apaga a galeria facial dele (evento `employee.terminated` → `DELETE /embeddings/{tenant}/{person}`).
- **Fotos temporárias** (modo degradado/offline) e frames de fraude: TTL de 7 dias e 24 h respectivamente, com job de limpeza.
- **[A CONFIRMAR]** Base legal e prazo de retenção da biometria e das fotos (`01` §6, item 7).

## 5. Acesso e auditoria

- Princípio do menor privilégio: papel (`rh`/`gestor`/`colaborador`) **e** escopo (conta, equipe, próprio).
- `admin` (cliente) e `contador` **não** leem dado de saúde; o `contador` só baixa exportações e espelhos.
- `super_admin` (operação do Genus) **não** lê dado de saúde nem biometria de cliente; o acesso excepcional exige justificativa e gera evento `critical`.
- Trilha imutável (`logs_auditoria`): alteração **e** leitura de dado sensível. Detalhes em `database.md` §11.
- Login do RH com senha + TOTP (Better Auth).

## 6. Direitos do titular

Acesso, correção, portabilidade, exclusão e revogação precisam ter caminho no produto: consulta do próprio espelho e comprovantes (portal do funcionário), exclusão de biometria, exportação dos dados do colaborador (**[A DECIDIR]** formato). O empregador é o **controlador**; o Genus é **operador** e assina contrato de operador com cada cliente. RIPD (relatório de impacto) cobre biometria e atestados.

## 7. O que nunca fazer

- Logar CPF completo, CID, texto de atestado, embedding, token ou chave.
- Devolver coluna `_cifrado`/`_hash` numa resposta de API.
- Compartilhar bucket ou DEK entre contas (tenants).
- Ligar `BENCH_ENDPOINTS` ou `SAVE_AUDIT_FRAMES` em produção.
- Commitar `.env`, `bench/.secrets.json`, `bench/data/` (vetores), `bench/frames/` (rostos) ou `bench/results/`.
- Enviar atestado a um serviço de OCR externo sem decisão registrada e contrato.
