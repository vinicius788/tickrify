# Tickrify — Contexto para o Claude

> Leia este arquivo no início de cada sessão. É a fonte única de verdade sobre a plataforma, decisões e estado atual.

## O que é
Tickrify — SaaS freemium de **análise de gráficos com IA** para traders. O usuário sobe/cola o print de um gráfico → a IA devolve uma leitura estruturada: **entry, stop, targets, confidence, confluence, risco e cenários**. North Star = **assinantes pagos / MRR**. Free tier = **3 análises grátis**, depois paywall.

## Mercado / posicionamento
- **Global / Inglês** (decidido jun/2026). Idioma padrão do site = **inglês**; PT/outros via seletor (lembra a escolha no navegador).
- Voz: direta, anti-hype. *"A second opinion that confirms or kills your read."* Não é sinal. A decisão é sempre do trader.

## Stack
- **Frontend:** Vite + React 19 + Clerk (auth) + React Router 7 + TanStack Query → **Vercel** (projeto `tickrify-frontend`, domínio tickrify.com).
- **Backend:** NestJS + Prisma → **Render** (serviço `tickrify`, API em https://tickrify.onrender.com, plano free que **hiberna**). Worker + **Redis** (BullMQ). DB **Supabase** (Postgres).
- **Pagamento:** Stripe. Monorepo **pnpm** (`apps/frontend`, `apps/backend`).
- **i18n:** `apps/frontend/src/lib/i18n/{pt,en,es,fr,de,ja}.ts`. Padrão `'en'`. O tipo vem de `pt.ts`.
- **Analytics:** PostHog (funil) + Sentry (frontend). Eventos: `landing_view, pricing_viewed, signup_started/completed, analysis_started/completed{analysisNumber 1/2/3}, analysis_failed{code}, free_limit_reached{reason}, upgrade_modal_viewed{trigger}, upgrade_clicked, checkout_started, subscription_activated`.

## Restrição de workflow (IMPORTANTE)
- **Repo local: `~/dev/tickrify`** (migrado pra fora do iCloud em 10/07/2026 — o iCloud descarregava arquivos e travava git/Cursor, e chegou a corromper o `.git/index` em 08/07). No Cowork/Claude, conectar a pasta `~/dev/tickrify`. Backup antigo em `~/Documents/tickrify.com-OLD` — apagar após 17/07/2026.
- Máquina local lenta (disco/iCloud cheio) → **builds locais inviáveis**. Fluxo: **Claude edita o código → usuário roda `git add/commit/push` → Vercel/Render buildam remoto → acompanhar build pelo navegador**.
- **Evitar dependências novas** (lockfile não atualiza local).
- Frontend = seguro. Backend = crítico; no sandbox só dá pra **checar sintaxe** (não tipos completos). Build do Render que falha **não derruba** o app (mantém a última versão boa).
- Às vezes aparece `.git/index.lock` travado → corrige com `rm -f .git/index.lock`.
- **Nunca manusear chaves/segredos** (o usuário cola direto no Render/serviço).

## Modelo de monetização
- **"Ticks"** = créditos internos (nome pra casar com a marca). Análise rápida = 1 tick, profunda = 3 ticks, PDF = 2 ticks.
- Free tier: 3 análises (só rápida — a profunda é travada pra assinante via `allowHigherTimeframes`).
- Na UI, falar em **"analyses"** (manter "ticks" só como unidade de billing, deixando claro).
- Cupom **EARLY50** = 50% no 1º mês.

## O que JÁ ESTÁ NO AR
- Site 100% em inglês (padrão).
- Copy de conversão afiada (hero, CTA, mensagens de limite) em `en.ts`.
- **Paywall de valor trancado:** free user na 4ª análise → preview borrado + cadeado + "Unlock analysis" (`components/dashboard/LockedAnalysis.tsx`); dispara `free_limit_reached` + `upgrade_modal_viewed{trigger:'locked_value'}`.
- **E-mail de boas-vindas** via Resend: `apps/backend/src/modules/mail/` (MailModule global + MailService com `fetch`, sem dep nova). Disparado em `auth.controller` (`GET /api/auth/me`, no branch de usuário novo). `RESEND_API_KEY` configurada no env group do Render.
- **Ping anti-cold-start:** `.github/workflows/keep-warm.yml` dá ping em `/api/health/live` a cada 10 min.

## PENDENTE
- **Verificação de domínio no Resend:** tickrify.com adicionado; DKIM + SPF(TXT) + DMARC adicionados no DNS da **Hostinger** (DKIM verificado). **MX** (`send` → `feedback-smtp.sa-east-1.amazonses.com`) **não** foi adicionado (form rápido da Hostinger não tem MX). Status: Pending. Quando verificar, setar no Render `MAIL_FROM = "Tickrify <noreply@tickrify.com>"`.
- **E-mail de recuperação:** `sendRecovery()` já existe no MailService; falta **ligar o gatilho** (disparar quando bate o limite grátis sem assinar, com dedup). Fazer depois do domínio verificar.

## Distribuição / conteúdo
- **Estágio zero** (≈0 seguidores em tudo, jun/2026): IG @tickrify 53 seguidores (reels 1–2k views), YouTube 0 inscritos / 4,5k views em 28d, X @tickrify 4 seguidores (parado).
- Diagnóstico: **alcance funciona; o vazamento é view → clique → cadastro.** Gargalo = tráfego, não conversão. **Medir primeiro.**
- Conteúdo: **faceless** (só mão + tela), **texto em inglês na tela** (fundador não fala inglês). 1 short/dia → repostar IG Reels + YT Shorts + TikTok. X depois Reddit. **UTM por canal**.
- Vídeo de demo com cara premium: gravar no **Cursorful/Screen Studio** (auto-zoom); estilo flashy via **template do CapCut**.

## Arquivos de entrega nesta pasta
- `Tickrify_Manual_Completo.pdf` (estratégia + funil + execução + conteúdo)
- `Tickrify_Site_Copy_EN.md` (copy do site em inglês, com tradução)
- `P4_copy_conversao.md` (copy das telas de conversão)
- `Tickrify_Demo_16x9_HD.mp4`, `Tickrify_Demo_9x16_HD.mp4`, `Tickrify_Demo_9x16_v2.mp4` (vídeos de demo)
