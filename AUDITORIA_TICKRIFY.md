# Auditoria do Tickrify — Segurança, Escalabilidade e Limite Grátis

Data: 05/06/2026 · Escopo: análise de código somente leitura (nada foi alterado)
Stack identificada: monorepo (NestJS backend + frontend React/Vite), Prisma, PostgreSQL (Supabase), Redis/BullMQ, Clerk (auth), Stripe (pagamentos), OpenAI (visão), deploy na Render.

---

## Veredito rápido

| Área | Nota | Resumo |
|---|---|---|
| Segurança (código) | **Boa** | Auth server-side, sem segredos vazados, isolamento de dados correto, webhook verificado. |
| Limite dos 3 grátis | **Boa, com ressalvas** | É validado no servidor e não dá pra burlar pelo frontend. Tem 2 brechas (corrida + multi-conta). |
| Vazamento de dados | **Sem vazamento detectado** | Toda consulta é filtrada pelo dono. |
| Escalabilidade p/ 10k usuários | **Insuficiente hoje** | Tudo em plano `free` na Render. Não aguenta 10k simultâneos. |
| Organização do código | **Boa** | Modular, com testes, validação de DTO e validação de env no boot. |

Resumo de uma linha: **o código está bem feito e seguro; o gargalo é a infraestrutura (plano free) e dois ajustes finos no limite grátis.**

---

## 1. Segurança — está segura

O que está correto:

- **Autenticação real no servidor.** Todo endpoint sensível usa `AuthGuard`, que valida o token do Clerk no backend (`verifyToken`) com checagem de issuer, audience e authorized parties. Não dá pra forjar identidade pelo frontend.
- **Isolamento de dados (sem vazamento).** `getAnalysis(id, userId)` e `listAnalyses(userId)` filtram **sempre** pelo `userId` do dono. Não existe IDOR — um usuário não consegue ler a análise de outro trocando o ID.
- **Nenhum segredo no Git.** Varredura confirmou: nenhuma chave real (OpenAI, Stripe, Supabase, JWT) versionada. Só arquivos `.env.example` com placeholders. `.gitignore` cobre `.env` corretamente.
- **Chaves só no backend.** OpenAI, Stripe secret e Supabase **service role** existem apenas no backend. O frontend não expõe nenhuma `VITE_*` secreta.
- **Webhook Stripe verificado.** Assinatura validada via `constructEvent`; requisição sem assinatura válida é rejeitada (proteção contra webhook falso que ativaria assinaturas de graça).
- **CORS travado em produção.** Rejeita `*` em produção; só libera origens da allowlist.
- **Defesas padrão presentes.** Helmet (security headers), `ValidationPipe` com `whitelist` + `forbidNonWhitelisted`, limite de upload 10MB, validação de env no startup, e bloqueio explícito de `ALLOW_LEGACY_AUTH_FALLBACK` em produção.
- **Admin com trilha de auditoria.** Promoção a admin via allowlist de e-mail + registro em `AdminAudit`.

Conclusão: do ponto de vista de código, a plataforma está **segura e os dados não estão vazando**.

---

## 2. Limite dos 3 grátis — funciona, mas tem 2 brechas

**Como funciona hoje (correto):** o limite é aplicado no servidor em `enforceAccess`. Ele conta no banco quantas análises o usuário já fez com `isDemo = true`; ao atingir 3, lança `403 DEMO_LIMIT_REACHED`. O frontend, ao receber esse 403, redireciona para `/pricing`. **Isso não é burlável mexendo no frontend** — a regra vive no backend.

Brechas a corrigir:

- **[MÉDIA] Condição de corrida.** A checagem "já usou 3?" e a criação da análise são passos separados, sem transação atômica nem trava única. Como o endpoint `analyze` permite 8 req/min, um usuário disparando várias requisições ao mesmo tempo pode "furar" e conseguir mais de 3 (até ~8) antes do contador subir. *Correção sugerida (futuro): contador atômico — `UPDATE ... SET count = count+1 WHERE count < 3` ou constraint única por período.*
- **[MÉDIA — risco de negócio] Abuso por múltiplas contas.** O limite é por usuário (conta Clerk). Nada impede a mesma pessoa criar vários e-mails e ganhar 3 grátis em cada. Não há impressão digital por dispositivo, IP ou cartão. É a limitação clássica de qualquer trial. *Mitigações: exigir cartão no cadastro do trial, fingerprint de dispositivo/IP, ou verificação de telefone.*
- **[BAIXA — UX] Análise que falha consome crédito.** A linha `isDemo` é criada antes do processamento; se a IA falha, o usuário perde 1 das 3 grátis. Vale não contabilizar quando o resultado falha.

---

## 3. Escalabilidade para 10 mil usuários — não aguenta hoje

O código está pronto para escalar (fila, retries, índices), mas a **infraestrutura provisionada não está**. Em `render.yaml`, web, worker **e** Redis estão todos em `plan: free`.

Pontos críticos:

- **[ALTA] Web em plano free.** Instância única, ~512MB RAM, sem autoscaling, e que **hiberna após 15 min de inatividade** (cold start de 30–60s). 10k usuários simultâneos é impossível nesse plano.
- **[ALTA] Processamento síncrono de fallback.** Se a fila/worker estiver indisponível, a análise roda **dentro da requisição web**. Uma chamada à OpenAI leva 10–30s; poucas análises simultâneas saturam a instância única e tudo trava.
- **[ALTA] Redis free com `noeviction`.** Memória limitada; ao encher, a fila pode falhar/empacar em vez de descartar — sob carga vira gargalo.
- **[MÉDIA] Rate limiter em memória.** O throttler é in-memory (não usa Redis como store). Hoje (1 instância) funciona, mas ao escalar horizontalmente os limites passam a valer por instância e zeram a cada restart.
- **[MÉDIA — verificar] Pool de conexões do banco.** Prisma usa o adapter `pg` contra o Supabase. Confirme que o `DATABASE_URL` aponta para o **pooler do Supabase (porta 6543, modo transaction)** e o `DIRECT_URL` (5432) só para migrations. Sem o pooler, muitos usuários esgotam as conexões do Postgres. *(Não consegui validar os valores reais — o `.env` não está versionado, como deve ser.)*
- **[Custo/throughput] Teto da OpenAI.** Cada análise é uma chamada de visão (gpt-4o / gpt-4o-mini). 10k usuários ativos = custo alto + rate limits da própria OpenAI. O adapter já trata `openai_rate_limit`, mas o teto de throughput e o custo precisam de planejamento.

O que já ajuda na escala: fila BullMQ com retry/backoff, índices em `Analysis(userId, createdAt)` e `status`, imagens no Supabase Storage (não no banco), e o split web/worker.

### Para suportar carga real (ordem de prioridade)
1. Subir web, worker e Redis para planos pagos (com autoscaling no web).
2. Garantir que **toda** análise passe pela fila/worker — evitar o caminho síncrono em produção.
3. Confirmar Supabase **pooler** no `DATABASE_URL`.
4. Migrar o rate limiter para store no Redis antes de escalar horizontalmente.
5. Acompanhar custo e limites da OpenAI; considerar cache/limites por plano.

---

## 4. Organização e "peso" do código

Estrutura modular limpa (módulos `ai`, `auth`, `payments`, `ticks`, `prompt`, `calendar`, `health`), com testes (`.spec`), DTOs validados, pipeline de hooks e validação de env no boot. **Está organizado e legível.** "Peso" do backend é baixo; o que torna a experiência lenta sob carga é a infraestrutura free + chamada à OpenAI, não o código em si.

---

## Prioridades sugeridas (sem mexer em nada agora — só roadmap)

**Antes de divulgar/escalar:**
1. Sair do plano free na Render (web + worker + Redis).
2. Tornar o limite dos 3 grátis atômico (fechar a condição de corrida).
3. Forçar todas as análises pela fila em produção.
4. Confirmar pooler do Supabase no `DATABASE_URL`.

**Importante, porém secundário:**
5. Mitigar abuso multi-conta no trial (cartão/fingerprint).
6. Rate limiter no Redis ao escalar horizontalmente.
7. Não consumir crédito grátis quando a análise falha.

Nada acima exige reescrever a plataforma — são ajustes pontuais e mudança de plano de infra.
