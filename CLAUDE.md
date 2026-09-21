# Tickrify — diario tecnico historico

> Este arquivo preserva decisoes e investigacoes em ordem cronologica. Ele nao
> e uma fonte unica de verdade, um runbook nem um conjunto de instrucoes para
> executar automaticamente. Para o estado operacional, consulte `README.md`,
> `DEPLOY.md`, `docs/README.md`, o codigo e os testes; confirme infraestrutura
> nos provedores antes de agir.
>
> **Este arquivo e cronologico: secao antiga NAO foi corrigida quando o assunto
> avancou, foi ANOTADA.** Antes de tratar qualquer item como pendente, procure
> uma sprint mais recente sobre o mesmo assunto — ou uma tabela de estado.
> Hoje existe uma: **`📊 ESTADO DO SEO — TABELA VIVA`, no fim do arquivo.**
>
> **Regra que nasceu de erro real (17/08/2026):** chegou uma auditoria externa
> de SEO datada de 10/08 e a maioria dos achados dela **ja estava corrigida** —
> pelas partes 2 a 6 da propria sprint de 10/08, escritas abaixo do trecho que a
> auditoria leu. Uma sessao inteira foi gasta reconferindo trabalho pronto.
> **Ao receber auditoria, relatorio ou plano — de fora ou de outra sessao —
> cruze com o estado atual ANTES de abrir codigo, e desconfie de qualquer
> documento com mais de alguns dias.** Ao fechar um item, mova a linha na tabela
> de estado no MESMO commit; nao basta escrever uma sprint nova embaixo.

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

## Workflow atual
- Repositorio local: `~/dev/tickrify`.
- O monorepo usa PNPM e o `pnpm-lock.yaml` deve permanecer sincronizado.
- Antes de publicar, execute os portoes de lint, tipos, testes, builds, auditoria interna e auditoria de dependencias descritos em `DEPLOY.md`.
- Commits devem ser pequenos e reversiveis. Push, deploy e alteracoes nos provedores exigem uma decisao consciente depois da validacao local.
- Nunca manuseie ou registre chaves e segredos em documentacao, commits ou logs compartilhados.

## Notas de implementacao preservadas
- **Portão do frontend: `pnpm check` na raiz.** Roda typecheck, Vitest e build do frontend.
- **Casca pré-hidratação do `index.html` (25/08/2026).** O bloco dentro de `<div id="root">` é o que a pessoa vê enquanto o bundle carrega, e é servido para TODA rota (o Vercel devolve este HTML para `/pricing`, `/terms`, `/dashboard` e tudo que não for arquivo estático). Por isso ele **não tem texto nenhum**: só a barra do cabeçalho com o logo, nas mesmas medidas da barra real (68px, mesma hairline, caixa de 1240px), pro React montar por cima sem nada saltar. Antes ele trazia o hero ANTIGO da landing embutido (Fraunces 6.5rem, verde `#5eea8a`), então abrir o site dava um lampejo do desenho velho e abrir `/terms` mostrava "Stop trading in the dark" antes dos termos. Texto duplicado fora do React é texto que diverge; já divergiu duas vezes. Isso matou a `replacePrehydrate` do `prerender.mjs`, removida junto. **Comentário dentro do `<style>` do `index.html` viaja pro navegador** em toda requisição, ao contrário dos comentários em `.tsx`: manter curto e explicar aqui.
- **CSS do site público: `.tk-site`/`.site-*` GANHAM do Tailwind (25/08/2026).** No `index.css` final as utilidades do Tailwind saem ANTES do bloco `SITE PÚBLICO v2`, então com a mesma especificidade quem vem depois vence. Misturar `h-9 w-9 p-0 rounded-xl` num elemento `.site-btn` NÃO funciona: o `.site-btn` sobrescreve altura, padding e raio. Foi assim que o menu sanduíche do celular virou um círculo vazio (36px de largura contra 20px de padding de cada lado = ícone espremido a zero). **Regra: quando um elemento tem classe `.site-*`, o ajuste vem de outra classe `.site-*`, nunca de utilidade do Tailwind.** As exceções que funcionam são utilidades cujo seletor sai DEPOIS no arquivo, como as de breakpoint (`md:hidden`), e nelas não dá pra confiar sem conferir. Duas outras armadilhas do mesmo bloco, já corrigidas: `.tk-site section` (0,1,1) vence `.site-hero` (0,1,0), e `.tk-site a { color: inherit }` vence `.site-btn-primary` — regras que precisam ganhar têm que ser prefixadas com `.tk-site`.
- **Nunca manusear chaves/segredos** (o usuário cola direto no Render/serviço).

## Modelo de monetização
- **PLANO ÚNICO desde 27/07/2026: US$ 29/mês (ou US$ 290/ano) com 200 ticks mensais.** (Passou por $19 no mesmo dia; ver "Preço" na seção Sprint 27/07.) Substituiu os 3 tiers (Starter $12 / Pro $29 / Elite $59), que diferiam APENAS em volume — mesma fila, mesmo modelo, mesmo suporte. O Starter a $0,267/análise era mais caro que o pacote avulso ($0,20): assinar era o pior negócio da loja. Agora $0,095/análise, metade do avulso mais barato.
  - No Stripe o valor foi **editado no objeto existente** (`Starter-usd` = `price_1TRvEJB1hl0IoocUvbCyxkt5`), então o price ID NÃO mudou. `pro` e `elite` seguem em `stripe.config.ts` como LEGADO — não apagar, assinaturas antigas resolvem por eles.
  - Checkout sempre em **USD** (o frontend força). BRL/EUR do Starter ficaram nos valores antigos e estão dessincronizados — irrelevante hoje, cuidado se ligar multimoeda.
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
- **Prompt v7.3 (13/07/2026):** calibração de confiança (bandas 62–78, >70 raro, confiança = probabilidade de TP1 antes do SL) + checklist com evidência obrigatória + entry alcançável (~1,5 ATR). Motivado pelo backtest (abaixo).
- **UI de tier de convicção (13/07/2026):** chip ao lado do BUY/SELL — conf <70 = "Read" (leitura, tooltip explicativo), ≥70 = "Signal". `getConvictionTier()` em `lib/trading-ui.ts`; i18n nas 6 línguas. Limiar 70 medido no backtest.

## Backtest do motor (13/07/2026) — régua objetiva
- **Pipeline reprodutível em `scripts/backtest/`** (README lá dentro): dados Binance (BTC/ETH 30m+4h, 12m) + Twelve Data (XAU/EUR; 30m só 60d), amostragem cega seed 20260713, render matplotlib estilo TradingView, runner com motor real (`apps/backend/scripts/backtest-runner.ts`, flags `--limit/--every/--ground/--out`), avaliação com Wilson/calibração/expectancy. Custo ~US$1/100 análises; API roda no terminal do usuário.
- **Resultados v1 (prompt v7.2, 300 análises):** win rate 45,3% (IC 35–56), expectancy +0,02R, WAIT 68%, confiança "75" fixa (sem informação). Relatórios locais (gitignored): `Tickrify_Backtest_Report*.md`.
- **v2 (v7.3 + grounding, 150 pareadas):** win rate bruto não melhorou (~37%), mas a confiança passou a DISCRIMINAR: conf 60–70 → 25% real, conf ≥70 → 56% real. Daí o limiar 70 na UI.
- **⚠️ PRODUÇÃO NÃO REPRODUZ ESSA SEPARAÇÃO (medido 27/07/2026, n=103 outcomes conclusivos):** conf 60–69 → 36,8% (IC 23,4–52,7) vs conf ≥70 → 38,5% (IC 27,6–50,6). Os intervalos se sobrepõem quase inteiros — no tráfego real o score de confiança **não prevê nada** até agora. A página `/accuracy` publica isso explicitamente em vez de esconder. Se a separação não aparecer com amostra maior, quem muda é o score, não a página.
- **Regras:** nenhum número vai pra marketing sem decisão explícita + metodologia + disclaimer. Posicionamento validado: "second opinion, not signals".
- **Backlog barato:** testar grounding isolado (~US$0,75), testar deep/gpt-4o vs mini (~US$4), ampliar amostra XAU/EUR 4h.

- **Grounding do quick (NO AR — commits 2e97324/bf2c0f5, 17/07/2026):** `AIAdapter.buildQuickGrounding` injeta candles reais no prompt (OKX primário — Binance bloqueia IP dos EUA/Render —, Binance fallback, XAU/EUR via Twelve Data se `TWELVE_DATA_API_KEY` no env) + contexto do MarketService. Flag `ENABLE_QUICK_GROUNDING` — **decisão consciente do dono: ligar em produção SEM backtest prévio** (tráfego ~0, kill-switch disponível, outcome tracking mede de graça). PENDENTE confirmar `=true` no env group do Render + linha `[QuickGrounding]` no log do tickrify-worker após análise de teste. Matemática idêntica ao `--ground` do runner.
- **Outcome tracking (NO AR — commit 2e97324, 17/07/2026):** `worker/outcome.sweeper.ts` + migração `20260716120000_analysis_outcome` (campos `outcome/outcomeAt/outcomeDetail` no Analysis). A cada 1h avalia análises completadas há 48h+: fill no entry → corrida TP1×SL em candles 30m (regra idêntica ao `evaluate.py`; mesmo candle TP+SL = LOSS). Outcomes: WIN/LOSS/TIMEOUT/NO_FILL/ABSTAIN/INCOMPLETE/UNTRACKABLE. Lotes 25/h com backfill. Kill-switch `ENABLE_OUTCOME_TRACKING='false'`. Com ~30–50 outcomes: calcular win rate real de produção (separar com/sem grounding pela data do deploy). Cria o dataset proprietário; depois expor "taxa de acerto histórica" na UI.
- **v7.4 (playbooks) segue LOCAL, não commitada** — `trading-system-prompt.ts` + `backtest-runner.ts` (strategyLine) + `evaluate.py`. Só sobe depois de medir (teste ~US$1,50). Pro teste de grounding isolado: `git stash push -- apps/backend/src/common/prompts/trading-system-prompt.ts` antes (volta pra v7.3), `git stash pop` depois.
- **19/07/2026 — grounding LIGADO em produção + incidente de migração resolvido:** `ENABLE_QUICK_GROUNDING=true` e `TWELVE_DATA_API_KEY` adicionadas no env do Render. Na sequência descobriu-se produção quebrada (P2022: colunas outcome/outcomeAt/outcomeDetail não existiam — a migração nunca rodou porque `RUN_MIGRATIONS_ON_START=false`, e ligar não resolve: `prisma migrate deploy` falha com P1001 porque `MIGRATIONS_DATABASE_URL` aponta pro host direto do Supabase, IPv6-only, inalcançável do Render). Correção: SQL da migração aplicado manualmente no SQL Editor do Supabase + INSERT no `public._prisma_migrations` com o checksum correto (sha256 do migration.sql). `RUN_MIGRATIONS_ON_START` voltou pra `false`. **REGRA: toda migração nova precisa ser aplicada manualmente no Supabase (SQL Editor) + registrada no `_prisma_migrations`, OU corrigir de vez `MIGRATIONS_DATABASE_URL` pro session pooler IPv4 do Supabase (aws-0-<região>.pooler.supabase.com:5432).**

## Sprint 20–21/07/2026 (tudo NO AR salvo indicação)
- **Migrações consertadas:** `MIGRATIONS_DATABASE_URL` no Render trocada pro session pooler IPv4 (`postgresql://postgres.xobqgbqemqsooabdwprg:<senha>@aws-0-us-west-2.pooler.supabase.com:5432/postgres`). `prisma migrate deploy` volta a funcionar do Render — fim do SQL manual. (Região real do Supabase = **us-west-2**, não sa-east-1.)
- **E-mails 100% funcionando:** domínio Resend verificou sozinho em 10/07 (DNS propagou); `MAIL_FROM=Tickrify <noreply@tickrify.com>` setado no Render. **Causa raiz dos e-mails que nunca saíam:** o session token do Clerk NÃO traz e-mail → `User.email` ficava NULL. Fix: `common/utils/clerk-email.ts` (busca na API do Clerk) + backfill no `auth.controller` (getMe) e no gatilho de recuperação.
- **E-mail de recuperação LIGADO:** `ai.service.triggerRecoveryEmail` dispara quando o free bate o limite; dedup permanente via `AdminAudit` (`action='recovery_email_sent'`, sem migração). Cupom do e-mail = **EARLY35** (35% 1º mês, confirmado vivo no Stripe 0/50; EARLY50 expirou em jun).
- **"What would change my mind"** no `AnalysisResult` para WAIT/HOLD (chaves i18n `flip*`): compõe entryCondition/alternativeScenario/invalidation/whyNotOpposite — SÓ campos que o motor já devolve, zero mudança de prompt. Confirmado no ar.
- **Calendário Econômico:** já estava implementado no `AnalysisResult` (accordion "Economic Events"); corrigido o bug de strings hardcoded em PT → 6 línguas (chaves `cal*` em `analysis.result`).
- **Blog SEO** em `apps/frontend/public/blog/` (4 artigos EN + índice) + `sitemap.xml` reenviado no Search Console (8 páginas encontradas). Marketing, não commitado no motor.
- **Heatmap de consistência** (`components/dashboard/ActivityHeatmap.tsx` + endpoint `GET /api/ai/activity` em ai.controller/ai.service): grade estilo GitHub dos últimos ~119 dias + streak atual/recorde. Mecânica de hábito + card "printável" pra conteúdo. i18n `heat*`. NO AR.
- **Backup diário do banco:** `.github/workflows/backup.yml` — pg_dump 07:00 UTC + manual, artifact privado 30d, sem 2º repo. Secret `SUPABASE_DB_URL` (= a string do pooler) no GitHub. Testado verde. Plano free do Supabase não tem backup — isto protege o dataset de outcomes.
- **Grounding do quick turbinado (21/07):** `buildCandleGroundingBlock` agora injeta **RSI(14) Wilder + posição no range (0–100%) + momentum ~6 candles**, tudo dos candles reais já buscados (zero API/dep nova), cada um com instrução de humildade (RSI extremo ≠ gatilho de reversão sozinho). Atrás da mesma flag `ENABLE_QUICK_GROUNDING`. Medir via outcome tracking; próximo candidato de indicador = **contexto HTF multi-timeframe** (maior salto, `extraImageUrls` já existe).

## PENDENTE (pós-sprint)
- **Emoji do motor: limpar no PROMPT quando for mexer nele (25/08/2026).** O modelo decora a saída com emoji (`🎯 Bullish OB/FVG confluence`, `💧 Unswept liquidity`, `🕯️ Upper-wick rejection`) e usa travessão em quase toda frase. Os dois são removidos **na exibição**, pelo `cleanModelText` em `AnalysisResult.tsx`, e essa foi a escolha certa naquele momento por um motivo específico: limpa também as ~395 análises **já gravadas**, coisa que mudar o prompt nunca faria. O custo é que o motor segue gastando token escrevendo decoração que é jogada fora. **Quando for mexer no prompt por outro motivo** (medição, A/B, v9), acrescentar a instrução de não usar emoji nem travessão — aí é economia de token, não correção de bug, e a limpeza da exibição continua valendo como rede para o histórico. Regra do repo permanece: motor só muda com medição, então isto NÃO justifica um deploy próprio.
  - Detalhe que não pode ser esquecido junto: os emoji do modelo hoje funcionam como **marcadores de lista** em `identifiedPatterns` (um por padrão) e os `✅/❌` são o que o `parseStructureChecklist` lê para saber o que passou. Tirar do prompt exige dar outro separador ao modelo, senão as duas seções voltam a virar parágrafo corrido.
- **Post 0 do relançamento de conteúdo** (só o dono grava) — kit pronto em `marketing-sprint/` e docs de estratégia. Estratégia nova = "The AI With Receipts" (SEG call / QUA your-chart / SEX receipt, 3x/semana).
- **Render pago (~US$7):** decisão do dono — NÃO assinar até o Post 0 ir ao ar (cold start só machuca com tráfego). Gatilho: dia do 1º short OU 1º assinante.
- ~~Confirmar `[QuickGrounding]` no log do worker~~ — **resolvido em 27/07**: `ENABLE_QUICK_GROUNDING=true` conferido no env do Render, e `TWELVE_DATA_API_KEY` está lá. (A linha `[QuickGrounding]` em si não aparece porque **nenhuma análise rodou em produção nos últimos 7 dias** — não é bug, é falta de tráfego.)
- ~~Conta Stripe chamada "WayPay"~~ — **resolvido**: a conta já se chama `tickrify` (verificado no dashboard em 27/07). Falta só conferir o *statement descriptor* (nome na fatura do cartão), que é campo separado.
- **v7.4 (playbooks)** continua fora da árvore (backup em `tmp/v74-playbooks-backup/`); medir ~US$1,50 antes de subir.

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

## Sprint 27/07/2026 — auditoria de claims (Fases 0, 1, 2, 5 do plano de correção)

**Princípio que governou tudo:** toda afirmação da vitrine precisa ser verdadeira ou verificável, porque a página `/accuracy` depende de a casa estar limpa. Commits: `1c209fa`, `ab4d36b`, `15a7f78`, `82373a1`.

### Fase 0 — dados fabricados removidos
- `RecentAnalysesSection`: array `FALLBACK` com 6 análises inventadas (preços defasados: BTC 104.500, XAU 3.310) **apagado**. Loading → skeleton; erro de fetch ou <3 análises reais → `return null`.
- `RecentTickerSection`: esteira 100% hardcoded (com uma confiança de 87%, impossível no motor) trocada por dados reais.
- Hook novo `useRecentPublicAnalyses` (TanStack Query, `staleTime` 60s) compartilhado pelas duas seções → uma requisição por carga.
- `GET /api/ai/public-analyses` ganhou `isDemo: false` — análises da demo anônima estavam vazando pra vitrine.
- **Regra permanente:** sem dado real, a seção não aparece. Nunca inventar para preencher.

### Fase 1 — claims falsos corrigidos (6 idiomas)
- Card **"2:1 validated minimum R/R · on every signal generated"** → morto. A regra do motor é 1.5, o piso do normalizador é 1.2, o R:R médio medido foi 1.19, e o guard está morto no adapter. Virou a taxa de abstenção.
- Hero e preview: confiança **80% → 68%** + chip "Read", R/R **2.0:1 → 1.6:1** (números que fecham a conta), badge **`● LIVE` → "Example"**.
- Features: `f5 "Real-time alerts"` e `f6 "Continuous education"` não existiam em lugar nenhum do código → trocados por **live candle grounding** e **economic calendar guard**, que estão no ar e não eram vendidos. Zero cards "Soon".
- Pricing: removidos `Priority responses`, `Priority execution`, `Priority support` (a fila BullMQ não tem campo `priority`) e `Institutional-grade AI` (o modelo é escolhido por tipo de análise, nunca por plano). A palavra "institucional" saiu da vitrine inteira (fica só no `orderBlockTip`, terminologia ICT correta).
- "Ações BR" saiu dos 5 idiomas; bloco `cta` alinhado ao inglês; `landing.how.*` reescrito ("From chart to a second opinion", "Confirm or kill your read") e FAQ `a2` reescrito para admitir o erro.
- `README.md` reescrito (estava em nov/2025, anunciava "Nível Institucional", 7 agentes que não existem no prompt, e deploy no Railway).

### Fase 3.1 — a hipótese do buraco de ativação foi DERRUBADA
Medido no Supabase em 27/07:
- Free users que esgotaram as 3 **sem ver nenhum sinal: 0** (de 4 que esgotaram, de 4 que já analisaram).
- **Abstenção real em produção: 39,4%** (153 WAIT de 388 análises) — não os 72,7% do backtest. P(3 WAITs) cai de 38% para ~6%.
- Motivo provável: o backtest sorteia gráficos às cegas; usuário real sobe print de gráfico em que já viu algo.
- **Conclusão: não mexer no free tier nem devolver tick no WAIT.** O gargalo é que só 4 pessoas na vida completaram uma análise grátis. É tráfego, não ativação.

### Fase 5 — página pública `/accuracy` NO AR
- `accuracy.util.ts` (novo): Wilson 95%, bandas de confiança, lista explícita de outcomes automáticos.
- `GET /api/ai/accuracy` no `ai.controller`, cache em memória de 1h (Render free), sem dep nova.
- `AccuracyPage.tsx` em `/accuracy`, linkada no rodapé (i18n nos 6) e no FAQ. **Texto só em inglês** (regra: texto público é em inglês).
- Números publicados hoje: acerto **37,9%** (IC 29,1–47,5, n=103), abstenção 39,4%.
- Diz em voz alta o que ninguém diz: sem custos de operação, amostra pequena e enviesada, taxa de acerto ≠ lucratividade, e que a calibração não se reproduziu em produção.

### ⚠️ Dois bugs de dados descobertos (não corrigidos ainda)
1. **`Analysis.outcome` mistura duas fontes:** o sweeper grava MAIÚSCULAS (`WIN`/`LOSS`/`ABSTAIN`/...) e o veredicto manual do usuário no My Trades grava minúsculas (`tp1`/`tp2`/`stop`/`open`). São ~8 registros hoje. O endpoint `/accuracy` já filtra, mas **qualquer query nova precisa filtrar também** — ou separar em coluna própria.
2. **O card "16s" da landing continua sem verificação e NÃO dá pra medir pelo banco:** a mediana de `updatedAt - createdAt` deu ~35 dias, porque o sweeper e o `setOutcome` reescrevem `updatedAt` muito depois. Precisa de log do worker ou de um campo dedicado de duração.

### Outros achados
- **As 2 "assinaturas ativas" no Stripe são do próprio dono** (`vm3441896@gmail.com`) — uma ativa, uma cancelando em 06/08. O MRR de R$ 297 no painel é a assinatura Elite de teste dele. **Não há cliente pagante real.**
- **Em 10 dias de grounding no ar, nenhuma análise nova chegou a resolver** (o split antes/depois de 17/07 tem n=0 do lado "depois"). Prova concreta de volume ≈ 0.
- O Prisma Client local está desatualizado (não conhece `outcome`) → `tsc` do backend acusa 7 erros que **não existem no build do Render** (que roda `prisma generate`). Rodar `npx prisma generate` em `apps/backend` para calar localmente.

### O que ficou de fora de propósito
- **Teto de rollover dos ticks** (Fase 2b): hoje acumulam pra sempre e a vitrine promete "Ticks never expire" — o que ainda é **verdade**, então não é claim falso. Mexer em `TicksService` é backend crítico; fazer em commit separado.
- **Fase 4 (teste de modelo)** inteira: o motor roda `gpt-4o-mini`/`gpt-4o`, família de ~2 anos atrás. O harness já aceita `AI_MODEL` por env, o teste custa ~US$3-8, e responde se o teto é o prompt ou o modelo. **A chave da OpenAI é do dono — ele roda o comando.**
- Tradução da `/accuracy` para os outros 5 idiomas.

## ⚠️ INFRA REAL (verificada nos painéis em 16/09/2026)

**Este bloco existe porque eu (Claude) errei um diagnóstico por não saber disto.**
O dashboard do Render mostra só DOIS recursos: o web service **`tickrify`** e o
**`tickrify-redis`**. Não existe serviço `tickrify-worker`. É fácil concluir daí
que o worker não roda. **Ele roda.**

- O serviço foi criado manualmente e se chama `tickrify`; não usa Blueprint.
- O Render usa o **`Dockerfile` da raiz**, com contexto `.` e sem comando Docker
  sobrescrito. Esse Dockerfile usa `infra/docker-entrypoint.sh` como `ENTRYPOINT`.
- Configurações antigas de Render, Railway e Vercel backend foram removidas em
  setembro de 2026 depois da conferência direta dos dois painéis.
- Esse entrypoint sobe **três coisas no mesmo contêiner**: a API, as migrações
  (se `RUN_MIGRATIONS_ON_START=true`) e o **worker embutido**:
  ```sh
  if [ "${RUN_EMBEDDED_WORKER:-true}" = "true" ]; then
    npm run worker:prod -w apps/backend &
  fi
  ```
  `RUN_EMBEDDED_WORKER` **não está no env** → default `true` → o worker roda.
  É ele que chama `startOutcomeSweeper`. Prova no log, a cada boot:
  `[Outcome] Outcome tracking ligado (varredura a cada 1h, maturidade 48h).`
- **NUNCA inicie o sweeper em outro lugar** (ex.: dentro do `main.ts`) sem antes
  desligar `RUN_EMBEDDED_WORKER` — dois sweepers no mesmo contêiner fazem
  varredura duplicada. Uma flag `ENABLE_SWEEPER_IN_API` chegou a ser criada em
  27/07 por causa do diagnóstico errado e foi **removida** no mesmo dia.

**Migrações:** `RUN_MIGRATIONS_ON_START=false` no env → o `prisma migrate deploy`
do entrypoint é pulado. Rodar `npm run migrate:deploy` na máquina do dono também
falha (`.env` local vazio → `P1012: Environment variable not found: DIRECT_URL`).
Na prática, **quem mantém o schema em dia hoje é o `ADD COLUMN IF NOT EXISTS` do
`AiService.onModuleInit`**, que roda a cada boot. Isso cobre coluna aditiva e
nada mais — índice, constraint ou rename vão exigir SQL manual no Supabase.

## Sprint 27/07 — parte 2 (fases 6.2, 6.3, modelos e preço)

- **Preço: US$ 29/mês e US$ 290/ano.** Subiu de $19 no mesmo dia, por sinalização
  (a $19 o produto lia como "mais ou menos" num nicho onde barato = suspeito),
  não por custo — a margem bruta é ~88% nos dois. Editado nos MESMOS price IDs
  do Stripe (`price_1TRvEJ...` mensal, `price_1TRvKH...` anual); os IDs nunca
  mudaram nas três edições ($12 → $19 → $29). 0 assinaturas afetadas.
- **6.2 verificado, nada a corrigir:** `normalizedAnalysisType` degrada `deep`
  para `quick` quando `hasPaidAccess` é falso, e é o valor NORMALIZADO que segue
  para `enforceAccessAndCreate` (linhas 242 e 340). Free não queima 3 ticks num
  `gpt-4o`. O débito só ocorre dentro do ramo pago.
- **6.3 FEITO — coluna `userVerdict`:** `outcome` guardava dois fatos que se
  destruíam. O sweeper busca `outcome IS NULL`, então trade marcado à mão nunca
  era avaliado (sumia da /accuracy); e o `setOutcome` fazia UPDATE cru, apagando
  WIN/LOSS já medido. Agora: `outcome` = o que o mercado fez (só o sweeper,
  MAIÚSCULO), `userVerdict` = o que o trader diz (só o `setOutcome`, minúsculo).
  O front não mudou: a API expõe `SELECT "userVerdict" AS "outcome"`.
  Backfill idempotente no `onModuleInit` moveu os 8 registros presos (confirmado
  no log: `[outcome] Backfill: 8 veredicto(s) manual(is) movido(s)`), e como o
  `outcome` deles voltou a NULL, o sweeper os reavalia e eles entram na amostra.

### Modelos de IA — o prazo que ninguém tinha visto
- A família atual da OpenAI é **GPT-5.6** (`sol` $5/$30 · `terra` $2,50/$15 ·
  `luna` $1/$6 por 1M tokens; input cacheado 10× mais barato).
- **`gpt-4o` — usado no deep — tem shutdown marcado para 23/10/2026.** Migrar não
  é opcional. Candidatos: `luna` no quick, `terra` no deep (mesmo preço de input
  que o gpt-4o atual).
- **Piloto de 10 análises custou US$ 0,00** (erro 400 não é cobrado) e achou a
  incompatibilidade real: GPT-5 **rejeita `max_tokens`** (exige
  `max_completion_tokens`) e **rejeita `seed`**. Corrigido em
  `modules/ai/openai-params.ts` → `buildSamplingParams(model, opts)`, usado nos
  dois call sites do adapter. Isso era dívida obrigatória pro deadline de outubro.
- **`AI_MODEL_QUICK` / `AI_MODEL_DEEP`** criados (`resolveModel()`): antes só
  existia `AI_MODEL`, que sobrescrevia quick E deep juntos — migrar o quick
  achataria o deep e mataria a diferença que justifica cobrar 3 ticks.
  Precedência: `AI_MODEL_QUICK|DEEP` → `AI_MODEL` → padrão histórico.
  **Nenhuma das três está setada no Render** → produção roda mini/4o.
- Custo por análise rápida: **~$0,003** no mini · **~$0,024** no luna ·
  **~$0,06** no terra. O `COST_PER_ANALYSIS_USD = 0.01` do runner é a estimativa
  antiga do mini — no luna, multiplique por ~2,4 o que ele imprime na tela.
- **Saldo OpenAI em 27/07: US$ 2,42**, auto-recharge desligado. As 150 análises
  do teste custam ~US$ 3,60. A perna baseline NÃO precisa ser refeita — o
  backtest v2 já é ela (mesmas amostras, seed 20260713, mesmo prompt v7.3).
- O runner é **retomável**: grava linha a linha e pula o que já analisou. Dá para
  fatiar o teste conforme o caixa; o mesmo `--out` vai se completando.

### Regra de experimento (custou caro aprender em outros projetos)
**Trocar modelo e prompt ao mesmo tempo invalida o teste.** Ordem obrigatória:
(1) v7.3 no modelo novo → isola o modelo; (2) só então v7.4 vs v7.3 no vencedor.
E cuidado com a intuição de "prompt mais complexo": o problema medido é
calibração, não cobertura. Mais estratégias dão mais formas de justificar setup
mediano. Um prompt mais ENXUTO pode performar melhor num modelo mais capaz —
boa parte da v7.3 é andaime para compensar limitação do mini de 2024.

## Sprint 28/07 — ativação + loop do veredito (Ondas 1 e 2)

### Onda 1 — telas vazias que ensinam
- `components/dashboard/EmptyState.tsx` (novo): componente ÚNICO usado em Watchlist,
  My Trades e Dashboard. Props `icon/title/description/ctaLabel/onCta`.
- `Watchlist` e `MyTrades` ganharam a prop `onStartAnalysis` (antes não recebiam
  prop nenhuma); o `DashboardPage` passa o `resetNewAnalysisView`. Sem rota nova —
  a navegação do painel é por `activeView`.
- **No My Trades há DOIS estados vazios distintos.** Sem nenhuma análise → EmptyState.
  Filtro sem resultado → linha simples. Unificar os dois faria quem filtra por "SL"
  ler "seu histórico começa com um gráfico", o que é falso.
- No Dashboard o EmptyState só troca os KPIs se `!isDemo && total === 0 && !loading`.
  Sem o `!loading` ele pisca a cada abertura do painel.
- Hero: chave `landing.hero.valueNow` — "sem histórico pra importar, sem 30 dias de
  diário; sobe o gráfico e a IA lê agora". É o diferencial contra os concorrentes de
  diário (a IA deles só funciona depois de 5-10 trades registrados à mão).

### Onda 2 — o loop do veredito (pergunta → marcação → cobrança → número)
- `lib/verdict.ts` (novo) é a **fonte única**: `Verdict`, `verdictFromOutcome`,
  `outcomeFromVerdict`, `loadVerdicts`, `saveVerdict`, `VERDICT_CFG`, `resolveVerdict`,
  `VERDICT_MIN_AGE_MS` (12h), `VERDICT_MAX_ROWS` (3), snooze de 24h.
  Mesma chave de localStorage de sempre: `tickrify_verdicts`.
- **2.2** — no `case 'analysis-result'`, dentro do card de gancho: "Taking this one?"
  com "I am taking it" (grava `open`) e "Passing". NÃO pergunta TP1/TP2/SL aqui — o
  trade acabou de nascer, não há resposta possível, e cobrar agora ensina a ignorar.
- **2.3** — bloco no topo do dashboard com os trades `OPEN` com +12h, máx 3 linhas,
  "ver todas", "agora não" (24h). Some sozinho quando o último é fechado.
- **2.4** — linha de taxa de acerto só com **≥5 decididos**, sempre com o n visível,
  e o R:R rotulado como **"proposto"** (vem da IA, não da execução do usuário).

### ⚠️ Regras que nasceram de bugs REAIS (não desfazer)
1. **O gatilho da cobrança é `open`, NUNCA `pending`.** O `pending` do
   `GET /api/ai/performance` é o `default` de um switch sobre TODAS as análises
   completadas — inclui WAIT. Na conta do dono isso daria "35 trades em aberto"
   para trades que nunca existiram.
2. **NUNCA deduzir qual análise marcar pela lista.** A 1ª versão usava
   `rawAnalyses.find(completed)`; como o `refetchAnalyses()` roda ao fim da análise,
   a lista trocava no meio e o clique marcava o trade ERRADO. Corrigido: o id vem do
   `createAnalysis` (`lastAnalysisId`).
3. **O filtro `OPEN` do My Trades só vem pré-aplicado pelo "ver todas".** A 1ª versão
   aplicava sempre que houvesse trade aberto — quem clicasse em My Trades no menu via
   1 análise em vez de 39. Usar `openMyTrades(filter?)`.
- O `MyTrades` **não usa** `getPerformance()`; calcula tudo do `useAnalyses(40)` +
  localStorage. O Dashboard faz igual, de propósito: o Render hiberna, o endpoint conta
  até 1000 análises e a tela carrega 40 — os números discordariam.

### Distribuição — números REAIS conferidos em 28/07 (os do CLAUDE.md estavam velhos)
- **Instagram @tickrify: 82 seguidores · 5 posts · 0 seguindo · ZERO reels.**
  (O registro antigo dizia 53 seguidores e "reels 1-2k views" — não há reels no perfil
  hoje; ou foram arquivados ou viraram post de feed.) Bio já em inglês e com UTM.
  Diagnóstico: conta não está morta, está **subalimentada** — e publicando no formato
  que menos distribui (feed em vez de reel).
- **Thread do X reescrita** em `_local/Thread_X_Receipts_2026-07.md` (fora do git).
  A antiga (`marketing-sprint/EXECUTAR_AGORA_X_REDDIT_YT.md`) está OBSOLETA: em PT para
  público BR, cupom FUNDADOR50 que não existe (o vivo é EARLY35), promete win rate
  público que agora já É público, e cita "~30s" (não medível).
- **A bio do Instagram diz "in 30s"** — mesmo claim não verificável do card 16s.
- `marketing-sprint/` (22 arquivos) estava VERSIONADO no git — **resolvido em 28/07**,
  movido para `_local/marketing-sprint/`. Varri o `CONTAS-E-CHAVES.md`: **não há segredo**.

## 🚫 REGRA PERMANENTE — não encher o repo de arquivo (28/07/2026)

O dono reclamou, com razão: **toda sessão de trabalho terminava com o projeto cheio de
documento solto.** Chegou a 9 `.md` na raiz + `marketing-sprint/` (22 arquivos
versionados) + 3 documentos de estratégia dentro de `docs/`.

**A regra, sem exceção:**

1. **Nenhuma sessão cria arquivo novo no repositório** a não ser que seja **código que
   roda** (`.ts`, `.tsx`, `.sql`, config, migração). Se você acha que precisa de um
   arquivo que não é código, a resposta padrão é: **não crie — pergunte.**
2. **Documento (plano, relatório, prompt, thread, roteiro, análise, handoff) vai para
   `_local/`**, que está no `.gitignore` — ou é entregue pelo chat. Nunca no git.
3. **Nada de `RESUMO.md`, `HANDOFF.md`, `PLANO_X.md`, `README` novo, `NOTES.md`.** O
   histórico do trabalho mora **aqui, no `CLAUDE.md`** — atualize este arquivo em vez de
   criar outro. Um arquivo de contexto, não vinte.
4. **Um arquivo de código novo precisa de justificativa** dita em voz alta antes de
   criar: por que não cabe num arquivo existente. Preferir editar a criar.
5. O `.gitignore` já bloqueia: `.md`/`.png`/`.csv`/`.xlsx`/`.pdf` na raiz, `_local/`,
   `marketing-sprint/`, `handoff/`, `planos/`, `relatorios/`, `prompts/` e
   `*.docx`/`*.xlsx`/`*.pptx`/`*.pdf` em qualquer pasta. **Se você precisar
   desligar uma dessas regras, você está fazendo a coisa errada.**

Limpeza de 28/07: 9 `.md`/`.csv` da raiz → `_local/arquivo/` · `marketing-sprint/` →
`_local/marketing-sprint/` · os 3 `.docx`/`.xlsx` de `docs/` → `_local/arquivo/`.
`docs/` continua no git só com doc **técnica** (ENV_VARIABLES, PROMPTS, runbooks).

## 🚫 REGRA PERMANENTE — nao deixar codigo morto para tras (21/09/2026)

Pedido explicito do dono. Vale para TODA mudanca, grande ou pequena:

1. **Quem tira o uso, tira o codigo.** Removeu a tela, a rota, o botao ou a
   chamada? Na MESMA mudanca remova o que so existia para ela: endpoint, metodo
   de service, hook, tipo, DTO, chave de i18n (nos 6 idiomas), mock de teste,
   dependencia npm, variavel de ambiente documentada. Nada de "fica para depois".
2. **Nada de casca "para nao quebrar import".** Se um export so sobrevive por
   causa de um mock ou de um comentario, apague os dois juntos.
3. **Codigo comentado, feature flag sem leitor, `console.log` de depuracao e
   helper duplicado nao entram em commit.** Log de operacao (linha de boot,
   `[funnel]`, `[Metrics]`) e intencional e fica.
4. **Antes de apagar, confirme** — "parece nao usado" nao basta:
   - busca no repo INTEIRO (frontend, backend, worker, scripts, `public/`,
     `.github/workflows`, Dockerfile/entrypoint), incluindo imports dinamicos;
   - rota de backend: conferir quem chama de FORA do site (Stripe/webhook,
     crons, GitHub Actions, operacao manual documentada);
   - dependencia: conferir se nao e peer/runtime de outra (ex.: `pg` do
     adapter do Prisma) e se configs (postcss, nest-cli) nao a usam sem import;
   - depois: typecheck, lint, testes e build dos DOIS lados. Mexeu em
     dependencia ou em infra: build da imagem Docker a partir de `git archive`
     e boot com Postgres/Redis descartaveis (receita na auditoria abaixo).
5. **Variavel de ambiente sem uso no codigo** se lista para o dono remover no
   painel; Claude nao remove sozinho (e config de producao).

## Sprint 29/07 — bug de cobranca em moeda + politica de privacidade

**Como apareceu:** a `/pricing` mostrava US$ 29 e o checkout da Stripe abria em
**R$ 57,00/mes**. Achado a partir de print do dono. Nao era um bug — eram tres.

### 1. A moeda do checkout era escolhida pelo cliente (bug de RECEITA + seguranca)
- `PricingCards.tsx` fazia certo (`const currency: Currency = "usd"`), mas o
  backend sobrescrevia: `stripe.service.createCheckoutSession` chamava
  `detectExistingCustomerCurrency()` e fazia `existingCurrency ?? currency`. A
  conta do dono tem assinatura de teste em BRL → todo checkout dele resolvia
  para o price BRL.
- **O price BRL do starter (`price_1TRv2f...`) esta congelado em R$ 57 desde
  jun/2026**, quando o plano custava US$ 12. As tres edicoes de preco
  ($12 → $19 → $29) foram feitas SO no objeto USD. Os 12 objetos BRL/EUR de
  todos os planos seguem nos valores antigos.
- Pior: `stripe.controller` aceitava `body.currency` do cliente. Um POST com
  `currency:'brl'` assinava o plano de US$ 29 por ~US$ 10. Mesmo furo no
  `ticks.controller` (`body.currency ?? 'usd'` escolhia a linha de preco do
  pacote). **Sem trafego ninguem explorou, mas era porta aberta.**
- `DashboardPage` (botao "Unlock analysis") usava
  `detectCurrency(navigator.language)` → qualquer visitante com navegador pt-BR
  caia em BRL.

### 2. O paywall vendia outro plano
`DashboardPage:386` chamava `createCheckoutSession('pro', ...)`. O `pro` e
LEGADO e da **150 ticks**; o `starter` da **200**. Em USD os dois custam $29 —
entao quem entrava pelo paywall pagava igual e levava 50 ticks a menos que quem
passou pelo `/pricing`. O default do `stripe.controller` quando o body vinha sem
`planType` tambem era `'pro'`.

### Decisao do dono: MOEDA UNICA, USD, para todo mundo
Manter 18 price IDs (3 planos × 2 ciclos × 3 moedas) sincronizados a mao foi o
que criou o bug e o recriaria no proximo reajuste. Agora sobra 1 preco para
manter, e a Stripe converte para a moeda local no checkout via **Adaptive
Pricing** (ja ligado — o `checkout.sessions.create` omite `payment_method_types`
de proposito, ver comentario no `stripe.service`).
- `frontend/lib/stripe.ts`: `detectCurrency` virou casca `@deprecated` que
  sempre devolve `'usd'`. **Nao foi apagada** so porque
  `__tests__/DashboardPage.test.tsx` declara ela no mock e o export sumindo
  daria erro de tipo. Apagar as duas juntas depois.
- `stripe.controller` e `ticks.controller`: moeda fixa em `'usd'`, ignorando o
  body. **Isso e fronteira de seguranca, nao preferencia — nao reverter.**
- `stripe.service`: `detectExistingCustomerCurrency` virou DIAGNOSTICO. So loga
  aviso; nao decide mais. Se sobrar cliente com compromisso legado em BRL/EUR, a
  Stripe recusa o checkout com "You cannot combine currencies on a single
  customer" — **falhar alto e o comportamento certo**, cobrar errado calado nao.
- Os price IDs BRL/EUR ficam no `stripe.config.ts`: assinaturas legadas ainda
  precisam deles para creditar os ticks certos. Nenhum checkout novo os alcanca.
- **PENDENTE do dono:** cancelar as 2 assinaturas de teste em BRL no Stripe,
  senao a propria conta dele bate no erro de moeda ao testar o checkout.

### 3. Politica de privacidade
- `PrivacyPolicyPage.tsx` estava **inteira em portugues** num site cujo padrao e
  ingles desde jun/2026 — e o rodape rotulava o link como "Privacy Policy".
  Reescrita em ingles.
- **Claim falso da mesma familia dos que a auditoria de 27/07 matou:** o "Ultima
  atualizacao" era `new Date().toLocaleDateString(...)`, ou seja, a pagina sempre
  afirmava ter sido atualizada HOJE, em qualquer dia que o visitante abrisse.
  Virou a constante `LAST_UPDATED`. **Ao editar o texto, atualize a data na mao.**
- Rota canonica agora e `/privacy`; `/privacidade` continua respondendo (link
  antigo/indexacao). Rodape aponta para `/privacy`.
- Texto ganhou paragrafo sobre transferencia internacional de dados e sobre
  usuarios fora do Brasil, ja que o produto vende global. **Nao houve revisao
  juridica** — LGPD segue como lei regente porque a operacao e brasileira.
- Nao existe pagina de Termos: o rodape usa `TermsOfServiceDialog` (modal).

### Verificacao
`tsc --noEmit` do frontend: **0 erros**. Backend: **7 erros**, todos do `outcome`
(Prisma Client local desatualizado) — nenhum novo.

---

## Sprint 29-30/07 — motor v9 + dois bugs silenciosos que quebravam produção

Objetivo do dono: um prompt novo, do zero, "com estratégias validadas e leitura de
fluxo". O prompt v9 saiu (`common/prompts/trading-system-prompt-v9.ts`, ~64k chars,
arquivo separado — **não** importado por ninguém, portanto não vai a produção sozinho).
Mas o que valeu mais foram os bugs achados no caminho.

### 🔴 BUG 1 — GPT-5 rejeita `temperature` E `top_p` (produção NÃO foi afetada — verificado)

```
400 Unsupported value: 'temperature' does not support 0.1 with this model.
    Only the default (1) value is supported.
```

`openai-params.ts` só tratava `max_tokens` e `seed` (achados em 27/07). O erro do
`temperature` estava **escondido atrás** do primeiro: só aparece depois de corrigir
o anterior. Corrigido — `temperature`/`top_p` agora só vão para a família 4o.

✅ **VERIFICADO no painel do Render em 30/07: NENHUMA das três variáveis
(`AI_MODEL`, `AI_MODEL_QUICK`, `AI_MODEL_DEEP`) está setada.** A lista de env vars
começa em `ALLOW_UNAUTHENTICATED` e é alfabética — `AI_*` viria antes e não está lá.
Ou seja: produção continua rodando `gpt-4o-mini`/`gpt-4o` (o default do
`resolveModel`) e **o bug nunca chegou ao usuário**. `ENABLE_QUICK_GROUNDING` está
setada (grounding ligado, como esperado).

**Consequência para o rollout do v9:** o v9 **não roda no mini** (nunca termina).
Então a ordem obrigatória é: (1) setar `AI_MODEL_QUICK=gpt-5.6-luna` no Render —
agora seguro, com o bug corrigido; (2) confirmar que as análises voltam e medir o
custo real (~US$0,032 vs ~US$0,013 no mini, ~2,4x); (3) só então ligar
`AB_PROMPT_V9_PERCENT`. Ligar o A/B antes da troca de modelo faria a perna B
falhar 100%.

**Consequência conceitual, não só técnica:** nos modelos GPT-5 **não existe controle
de sampling**. A `temperature: 0.1` que o motor usava para forçar consistência
sumiu. Confirmado na prática: o MESMO gráfico foi avaliado como compra numa rodada
e como venda na seguinte. A consistência agora depende só do prompt — o
`DETERMINISTIC_CONSISTENCY_INSTRUCTION` deixou de ser reforço e passou a ser a
única linha de defesa. Isso é risco de produto real (usuário sobe o mesmo print
duas vezes e vê leituras diferentes).

### 🔴 BUG 2 — a ordem do `json_schema` fazia o modelo decidir ANTES de analisar

Em structured outputs a ordem das chaves no schema **é** a ordem de geração. Estava:

```
is_financial_chart → recommendation → confidence → analysis (reasoning no fim)
```

Ou seja: o modelo escolhia BUY/SELL/HOLD e o número da confiança **sem ter escrito
uma palavra de análise**. Todo o resto era racionalização do que já estava decidido.
**Isso explica o mistério do backtest v2**: por que a confiança só saía 30, 45, 68
ou 72 — não era análise, era pescar um número da memória antes de olhar o gráfico.

Reordenado para `is_financial_chart → analysis (reasoning PRIMEIRO) → recommendation
→ confidence`. Efeito medido no mini, mesmo gráfico: o `reasoning` saltou de 212
chars de "not defined" para 965 chars com ARR, preços, playbook e a conta da
confiança. **Vale para a v7.3 também**, não só para o v9.

⚠️ Efeito colateral: com a decisão no fim, truncar deixou de ser "resposta cortada"
e passou a ser "veredito perdido" (o `repairTruncatedJson` fecha o JSON e
recommendation/confidence caem no padrão HOLD/0). Por isso o teto de saída do quick
subiu de 8.000 para 16.000 e o teto de tempo permitido de 120s para 180s (default
segue 55s).

### 💡 A imagem sempre foi o custo, não o prompt

Mesmo prompt + mesma imagem, tokens de ENTRADA cobrados:

| | gpt-4o-mini | gpt-5.6-luna |
|---|---|---|
| entrada | **52.953** | **17.077** |
| saída | 8.000 (truncado) | 2.422 (completo) |
| tempo | nunca terminava | 18s |
| custo/análise | ~US$0,013 | ~US$0,032 |

O prompt em texto são ~15k tokens nos dois. **O mini cobra ~38k tokens só pela
imagem em alta resolução**; o luna cobra ~2k. Conclusão: o medo de "prompt grande
é caro" era falso — v9 e v7.3 custam praticamente o mesmo no luna (US$0,032 vs
US$0,030), porque o prompt maior gasta na entrada o que o OUTPUT BUDGET economiza
na saída. E **o v9 não roda no mini**: nunca termina (>120s, satura o teto de saída).

### Veredito do v9 (medido, não opinado)

10 amostras espalhadas (BTC/ETH/XAU/EUR, 30m e 4h), mesmo modelo, mesmos dados,
só o prompt muda:

| | v7.3 | v9 |
|---|---|---|
| sinais | 2/10 | **0-1/10** |
| regimes distintos | trending 9, volatile 1 | ranging 4-6, trending 3-5, volatile 1 |
| força de tendência | **moderate 10 de 10** | weak 4, moderate 6 |
| confianças distintas | 6 de 10 | **8 de 10** |

**O v9 é melhor analista e pior gerador de sinal.** Na leitura ele ganha claramente:
discrimina regime onde a v7.3 escreve a mesma constante dez vezes, calcula a
confiança (`base 45 −5 sem gatilho −5 pressão divergente = 35`) em vez de decorar
quatro números, e acha spring/upthrust com preço.

Abstenção de 90-100%. Diagnóstico pelos portões: G6 (geometria) reprova 9/10, mas
**porque** G3 (playbook) e G4 (pressão) já reprovaram — em range com rotação de
duas vias e preço no meio não existe pressão direcional, então nenhum plano é
construído e não há geometria para avaliar. 6 dos 10 gráficos são exatamente isso.

**Isso não é bug, é disciplina.** Um trader passaria batido em 9 desses 10. A v7.3
chamou 9 de 10 de "tendência" — factualmente errado — e é assim que ela fabrica
sinal. Cruzando com o que já estava medido (expectancy −0,19R, faixa 60-70 acertando
25%), **a abstenção do v9 pode ser a resposta certa para o motivo pelo qual a v7.3
perde dinheiro.**

Quatro rodadas de ajuste (~US$1,20) não tiraram a abstenção de 90%. Parei de propósito:
mais voltas seria esculpir o prompt em cima de dez gráficos (p-hacking).

### ✅ A/B de prompt em PRODUÇÃO — a medição que não custa API

Em vez de gastar ~US$5/perna no backtest, a produção mede sozinha:

- **`AB_PROMPT_V9_PERCENT`** (default 0 = desligado). `20` → ~20% dos usuários recebem
  o v9. Sorteio **por usuário** (hash FNV-1a estável), não por análise: o mesmo
  usuário fica sempre do mesmo lado. Por análise seria pior justamente porque GPT-5
  não tem mais temperatura para atenuar variação.
- **`promptVer = -9`** marca a perna B. Negativo de propósito: nunca colide com versão
  real de `PromptConfig` e não exige tabela nova.
- **Coluna `Analysis.model`** — sem ela é impossível comparar calibração antes/depois
  de trocar de modelo. Aplicada no Supabase em 30/07 (`ADD COLUMN IF NOT EXISTS` +
  `Analysis_promptVer_outcome_idx`), e replicada no `onModuleInit` como rede.
- **`/accuracy` agora devolve `byPrompt` (v9 vs current) e `byModel`**, reaproveitando
  o mesmo `tally` com intervalo de Wilson.

**Por que isso é melhor que o backtest:** a limitação nº 1 do relatório interno é
*"gráfico renderizado ≠ print real de usuário"*. Os 300 gráficos do manifest são
matplotlib sem indicador e sem desenho. A produção mede com print de verdade, de
graça, e cresce sozinha — o `outcome.sweeper` já fecha TP1/SL 48h depois.

### Grounding: o que passou a ir no prompt

Os candles que o backend já baixava traziam **volume na coluna 5 e o código descartava**.
Agora vai: volume relativo à média de 20 (`2.4x SPIKE`), **mapa de volume por preço**
(POC + área de valor + gaps de baixo volume, aproximados distribuindo o volume no
range do candle) e **mapa de eventos** calculado (última perna de impulso com origem,
reversões recentes por CHoCH, base de acumulação e para que lado saiu, rompimento
falho spring/upthrust). Contar e localizar é o que modelo de visão faz pior — virou
aritmética determinística.

**Guarda de print velho** (`detectStaleChart`): o `extractSymbol` passou a ler também
o preço do último candle visível. Se ele divergir mais de 3 ATR do close real, o bloco
de dados é **retido** e entra um aviso de que o print é histórico. Sem isso, um print
de três dias atrás fazia o backend injetar "preço atual = X" e a IA montava
entrada/stop/alvo num preço que não é o do gráfico — errado com cara de certo.

### Backtest runner

- **`--prompt-file <caminho>`**: testa um prompt candidato sem tocar no ativo. Aceita
  `.ts` (extrai o template literal) ou `.md`/`.txt`.
- **Uma fonte da verdade**: o runner tinha cópia própria do bloco de dados reais e
  ficou defasada (sem volume, sem mapa de eventos) — passou a importar
  `buildRealDataBlock` de `ai.adapter`. Antes, o backtest media um motor que não era
  o de produção.
- **`BT_DEBUG_FIELDS=1`** grava tamanho de cada campo, o checklist e o reasoning
  íntegros. **`AI_DEBUG_DUMP_RAW=<arquivo>`** grava a resposta crua + tokens +
  `finish_reason` (só a resposta; o prompt do sistema nunca vai para arquivo).
- **`scripts/backtest/rodar-teste-v9.sh piloto|completo|avaliar [ambas|v73|v9]`**:
  trava antes de gastar se `AI_MODEL*` estiver setado (o teste tem de rodar no modelo
  da baseline) ou se `ENABLE_QUICK_GROUNDING=true` (injetaria dados em duplicidade).

### ⚠️ Pendências que só o dono resolve

1. ~~Conferir `AI_MODEL_QUICK` no Render~~ — **FEITO em 30/07: não está setada,
   produção nunca quebrou.** O que resta é a decisão de migrar para o luna (ver Bug 1),
   que é pré-requisito do v9 e obrigatória até 23/10 por causa do shutdown do gpt-4o.
2. `AB_PROMPT_V9_PERCENT` continua **desligada** — ligar em 20 é a decisão que
   transforma cada usuário real num ponto de medição.
3. Um teste de win rate honesto custa ~US$5/perna no luna. Saldo era US$2,42. Com
   n=25/perna o intervalo de confiança é largo demais para decidir nada.

---

## Sprint 10/08/2026 — auditoria de SEO + card de preço desalinhado

### O card de preço encostado na esquerda
`PricingCards.tsx` tinha `grid-cols-1 md:grid-cols-3` FIXO, herdado de quando eram
3 tiers. Desde o plano único (27/07) o card sozinho caía na **primeira coluna de
três** — o título e o banner acima seguiam centralizados e só o card ficava torto.
Agora a largura sai de `PLANS.length` (1 → `max-w-md`, 2 → `md:grid-cols-2`, 3+ →
`md:grid-cols-3`), então não quebra de novo se um segundo plano voltar.

### 🔴 O achado nº 1: todas as rotas serviam o mesmo `<title>`
SPA Vite sem SSR e sem helmet → toda rota React devolvia o `index.html` único.
**Verificado ao vivo antes da correção:** buscar `tickrify.com/pricing` devolvia
`"Tickrify — AI chart analysis for traders"`, o título do home. `/pricing`,
`/accuracy`, `/try` e `/privacy` eram a mesma página aos olhos do Google e nenhuma
podia rankear para nada específico.

**Correção:** `hooks/useSeo.ts` (arquivo novo, justificado: 5 páginas usam, não
cabe dentro de nenhuma). ~40 linhas mexendo direto no `document.head`, **sem
dependência nova** (`react-helmet-async` não entra — o lockfile não atualiza local).
Exporta `useSeo` (title/description/canonical/og/twitter/robots) e `useJsonLd`.
Ambos restauram o padrão no unmount: sem isso a meta de uma rota grudaria na
seguinte, porque o Router não recarrega o documento.

⚠️ **Isto resolve o Googlebot, que renderiza JS. NÃO resolve crawler que não
executa JS** (Bing, crawlers de IA, prévia de link do WhatsApp/Slack) — a meta só
existe depois da hidratação. A correção completa é **pré-renderizar as rotas
públicas no build** (`vite-plugin-ssg` ou pré-render), que continua PENDENTE e é o
item de maior retorno da lista inteira.

### 🔴 A marca não aparece no Google

> ⚠️ **A CONCLUSAO DESTA SECAO FOI DERRUBADA NA PARTE 6 DA MESMA SPRINT.** O
> Search Console mostrou que o site **ESTA indexado** — o problema e *o que* esta
> indexado (5 paginas, o blog inteiro fora). Nao rankear para a propria marca e
> autoridade zero, nao ausencia de indexacao. Leia a parte 6 antes de agir nisto.

Busquei `Tickrify` e `tickrify AI chart analysis` em 10/08: **o tickrify.com não
apareceu em nenhuma das duas.** Voltaram Tickify (ingressos), Ticklify (cripto) e,
na segunda, os concorrentes diretos. Ou o domínio não está indexado de verdade, ou
está com autoridade zero sendo canibalizado por marcas foneticamente próximas.
**PENDENTE DO DONO: abrir o Search Console (domínio já verificado via
`google66729000cdbf71c6.html`) e conferir Cobertura + Inspeção de URL.** Se o site
não estiver indexado, nenhuma outra recomendação de SEO importa.

### A `/accuracy` era órfã
Fora do sitemap, sem meta própria, e o único link era o do rodapé do app — que só
existe depois do JS carregar. É o ativo mais raro do site: auditei SnappChart e
Tickrad e **nenhum dos dois publica acurácia real**. Agora tem título próprio, está
no sitemap e recebe link dos 6 posts do blog e do índice — o blog é a única parte
estática e rastreável do site, então é de lá que o link precisa sair.

### Demais correções deste commit
- **sitemap.xml:** entraram `/try` e `/accuracy`; `/privacidade` saiu e virou
  `/privacy`. Todas ganharam `<lastmod>` (único dos três campos opcionais que o
  Google ainda usa); `changefreq` e `priority` saíram — são ignorados desde 2023.
- **Duplicata de privacidade:** as duas rotas renderizam o mesmo componente, e o
  sitemap listava justamente a NÃO canônica. O `useSeo` do `PrivacyPolicyPage` fixa
  o canonical em `/privacy` independente da rota servida.
- **Schema da /pricing:** `SoftwareApplication` + `Offer` ($29 USD) + `FAQPage`,
  montados a partir do MESMO objeto `PRICING_COPY` que a tela renderiza — se a copy
  mudar, o markup muda junto. Sem `aggregateRating`: não há avaliação real e
  inventar uma seria o claim que a Fase 1 removeu.
  ⚠️ **O FAQPage NÃO gera mais rich result** — o Google desativou FAQ rich results
  em **07/05/2026**. Ficou porque ainda é assim que buscador de IA lê a página.
- **og:image saiu do imgur** (`i.imgur.com/3Z3gY8A.png`, host de terceiros gratuito
  segurando todos os cards de compartilhamento) para `/public/og.png`, 1200x630, na
  identidade do site. Com `og:image:width/height` e alt corrigido.
- **`maximum-scale=1.0`** removido do viewport (bloqueava zoom com pinça =
  penalidade de acessibilidade e sinal negativo de mobile).
- **Descriptions cortadas** para 130–150 chars em `vs-chatgpt` (era 225),
  `vs-tradingview` (238), `best-ai-chart-analysis-tools` (178) e no `index.html` (171).
- **Canonical no `index.html`** — sem ele, `/` e cada variação de UTM que o próprio
  blog gera contavam como URLs distintas.

**NÃO fiz de propósito:** `dateModified` nos posts do blog. Adicionar um link não é
atualização de conteúdo, e carimbar "modificado hoje" por isso seria a mesma mentira
do `new Date()` que foi removido da política de privacidade em 29/07. Entra quando o
conteúdo for de fato aprofundado.

### Concorrência (auditada em 10/08)
| | Tickrify | SnappChart | Tickrad |
|---|---|---|---|
| páginas indexáveis | 7 (só o blog) | 25+ | ~10+ |
| profundidade média | ~660 palavras | 2.500–3.000 | n/d |
| landings plataforma/ativo | nenhuma | TradingView, cTrader, XAUUSD, forex, scalp/swing | TradingView, MT, Binance |
| ferramentas grátis | **nenhuma** | position size, breakeven win rate | risk calc, glossário, journal |
| **acurácia pública medida** | **sim** | não | não |

Perde em toda dimensão de infraestrutura (corrigível com engenharia) e ganha sozinho
na única que o concorrente não copia sem se expor.

### PENDENTE de SEO (ordenado por retorno)

> ⚠️ **ESTA LISTA ESTA HISTORICA — a versao viva e a `📊 ESTADO DO SEO — TABELA
> VIVA` no fim do arquivo.** Ela ficou aqui, com os itens riscados, porque foi
> exatamente lendo esta lista sem cruzar com as partes 2 a 6 da mesma sprint que
> uma auditoria externa reportou como pendente coisa ja no ar.

1. **Search Console** — só o dono. Antes de tudo. *(parcialmente resolvido em
   10/08 parte 6: o site ESTA indexado, mas so 5 paginas; sitemap reenviado,
   8 → 12 URLs. Falta reinspecionar URL por URL.)*
2. ~~**Pré-renderizar as rotas públicas**~~ — **FEITO em 10/08 (parte 3)**,
   `scripts/prerender.mjs`, confirmado em producao no commit `96073c2`.
3. ~~**Aprofundar os 6 posts** para 1.800–2.500 palavras~~ — **FEITO em 10/08
   (partes 2 e 4)**: os 6 estao entre 1.698 e 2.621 palavras.
4. ~~**3 calculadoras grátis**~~ — **FEITO em 10/08 (parte 5)**: `public/tools/`,
   as tres + indice, estaticas e no sitemap.
5. **Decisão de i18n do dono:** as 6 traduções vivem em `localStorage`, sem URL e sem
   `hreflang` → geram **zero** orgânico hoje. Ou rotas `/pt/`, `/es/`… com hreflang,
   ou assumir inglês como único idioma indexável (mais barato e alinhado com a meta
   US/UK), mantendo as traduções só como UX pós-login.
6. **Zero imagens em todos os 7 arquivos do blog** — num produto que é literalmente
   ler gráficos. Print real de análise em cada post = prova de produto + image pack.

### 10/08 — parte 2: profundidade nos dois posts que puxam o cluster

Escolha deliberada de risco: aprofundar o blog é **zero risco pro app** (são
arquivos estáticos em `public/`, fora do build do React), então veio antes da
pré-renderização, que mexe no build.

- **`best-ai-chart-analysis-tools`: 677 → 2.213 palavras.** O concorrente tem
  ~5.500 na mesma query. Entrou: sumário navegável, os 4 critérios virando seção
  cada, Tickrad na tabela (verificado no site deles em 10/08: "a partir de
  US$29/mo", garantia de 7 dias, risk calculator + glossário + journal + strategy
  lab), seção "como detectar um wrapper em 60s", seção de calibração com os
  números reais, teste de 5 passos, seção "o que não podemos te dizer" e FAQ.
- **`ai-chart-analysis` (pilar): 701 → 2.166 palavras.** Entrou: o pipeline de 5
  passos entre upload e resposta, tabela "lê bem × não lê", 2 novos itens de onde
  ajuda, **4º failure mode (inconsistência na mesma entrada)**, seção sobre o que
  é grounding de verdade (incluindo a guarda de print velho) e workflow de 6
  passos pra não terceirizar a decisão.
- Ambos ganharam **FAQPage schema** e `dateModified: 2026-08-10` — aqui o
  dateModified é legítimo, o conteúdo triplicou. Índice do blog e `lastmod` do
  sitemap alinhados.

**Claim corrigido de passagem:** o callout do post pilar dizia "a **calibrated**
confidence tier". A `/accuracy` diz que a calibração NÃO se reproduziu em
produção — então a vitrine estava afirmando o que a própria página de acurácia
desmente. Virou "a confidence tier" com link pra `/accuracy`. Mesma família dos
claims que a Fase 1 matou em 27/07; vale varrer o resto do site atrás de outros.

**Ângulo novo que os dois posts passaram a usar:** ChartSnipe publica um ranking
da categoria onde ele mesmo tira 47/50 e o segundo colocado 31/50 (lido em
10/08). Não é acusação — é a prova concreta da tese de abertura do post, e
justifica o Tickrify não pontuar ninguém. Combinado com a `/accuracy`, esse é o
posicionamento inteiro em duas frases.

### 10/08 — parte 3: pré-renderização do `<head>` (VERIFICADA COM BUILD REAL)

**Como isto foi verificado, já que build local é inviável:** clonei o frontend
pro sandbox da nuvem (tar via bridge → `_local/tmp-build/`), instalei e rodei
`vite build` de verdade, Vite 6, mesma config. Todo achado abaixo é observado no
output real, não deduzido.

**O mecanismo:** `scripts/prerender.mjs` roda depois do `vite build` e clona o
`dist/index.html` para `dist/<rota>/index.html` com title, description, canonical
e og/twitter próprios. Mesmo bundle, mesmo app — só o `<head>` muda.

**Não precisou tocar no `vercel.json`.** O `rewrites` do Vercel roda DEPOIS da
checagem de filesystem: existindo `dist/pricing/index.html`, o Vercel serve o
arquivo e o rewrite para `/index.html` nunca dispara. É o mesmo mecanismo pelo
qual as páginas de `public/blog` já funcionam em produção — não é teoria.

**Fonte única:** `src/lib/seo-routes.json`, lido pelo script (Node, no build) E
pelo app via `seoFor()` no `useSeo` (`resolveJsonModule` ligado no
`tsconfig.app.json`). Os títulos em dois lugares divergiriam na primeira edição,
e a divergência seria invisível — cada metade só aparece pra um público.

**Bug de sintaxe que só o build real pegaria:** `String.replace` com string de
replacement interpreta `$` como sintaxe de grupo. O preço `$29` virava
`grupo-2 + "9"` e a meta da /pricing saía anunciando **"9/mo"**. Todas as
substituições passaram a usar FUNÇÃO de replacement. (O outro erro pego no
caminho: `public/blog/*/index.html` dentro de bloco de comentário — o `*/` fecha
o comentário e o Node não parseia o arquivo.)

**Bug de UX consertado de brinde:** o `index.html` traz o hero da landing
embutido como pintura pré-hidratação, então abrir /pricing piscava "Stop trading
in the dark" antes do React montar. As rotas pré-renderizadas trazem um bloco
neutro montado a partir do próprio title/description da rota — sem copy nova, pra
não criar uma segunda cópia de texto de vitrine que divergiria da primeira.

**Fail-safe testado nos 3 cenários** (JSON ausente, `dist/` ausente, `#root` não
reconhecido): o script avisa e **sai com código 0**. Nenhum problema de SEO
derruba deploy — sem os arquivos gerados, o Vercel volta ao fallback da SPA e o
site se comporta como antes.

⚠️ **Só o `<head>` é pré-renderizado, não o conteúdo.** Renderizar o corpo exige
navegador headless no build (dependência nova, proibida). O que isto resolve:
Bing, crawlers de IA e prévia de link de WhatsApp/Slack/X, que leem HTML cru.

**Sobra pra limpar:** `_local/tmp-build/frontend*.tgz` (os tars da verificação).
`_local/` é gitignored, então não suja o repo — mas o bridge não consegue apagar
arquivo no Mac, então quem apaga é o dono.

**✅ CONFIRMADO EM PRODUÇÃO (10/08, commit `96073c2`).** Lido do HTML cru, sem
executar JS — que é exatamente o que Bing e crawler de IA enxergam:

| rota | `<title>` servido |
|---|---|
| `/` | Tickrify — AI chart analysis for traders (home intacto) |
| `/pricing` | Pricing — **$29**/mo for 200 AI Chart Analyses \| Tickrify |
| `/accuracy` | Tickrify Accuracy — Our Real Win Rate, Published |
| `/try` | Free AI Chart Analysis — No Signup Required \| Tickrify |

O `$29` saiu correto (era o bug do `$` como sintaxe de replacement) e o home não
regrediu. **O achado nº 1 da auditoria está fechado.**

### 10/08 — parte 4: os 4 posts restantes + varredura de claims

**Blog completo.** Os 4 que faltavam saíram de 540–730 para 1.386–1.688 palavras,
todos com sumário navegável, FAQ e `FAQPage` schema. Detalhe do processo: **o
schema é GERADO a partir do HTML visível** (o script extrai os pares h3/p da
seção de FAQ), então é impossível o markup afirmar algo que a página não diz.

- `chatgpt-chart-analysis` (1.688w): ganhou um **prompt copiável** que força
  estrutura, exige invalidação e autoriza "NO TRADE" — é o que quem busca essa
  query realmente quer; o teste de 30s que expõe o problema de preço; e uma
  tabela de workarounds grátis pra cada limitação. Entregar isso reduz a
  necessidade de pagar, e é justamente por isso que constrói confiança.
- `tickrify-vs-chatgpt` (1.666w): conta de custo real (ninguém compara $29 com
  grátis — compara com os ~$20 do Plus que já paga, ou seja ~$9 de diferença),
  seção "quando somos a escolha errada" com 5 casos, e duas coisas que o ChatGPT
  faz melhor que a gente (dá pra discutir com ele; e ele não tem interesse em
  você operar).
- `tickrify-vs-tradingview` (1.386w): "o que o TradingView faz que a gente nunca
  vai fazer" (5 itens), o workflow concreto em 6 passos e a conta de empilhar as
  duas assinaturas.
- `trading-second-opinion` (1.679w): a **aritmética de não operar** (o custo fixo
  por trade come a maior fatia justamente nos trades marginais), tabela
  "checkpoint x teatro" e um roteiro de 6 passos pra montar o checkpoint de graça.

#### 🔴 Varredura de claims — 4 achados

1. **`chatgpt-chart-analysis` já tinha um `FAQPage` no head** que eu ia duplicar.
   O antigo afirmava "calibrated confidence measured against real outcomes" —
   removido, ficou só o novo.
2. **Callouts de `chatgpt-chart-analysis` e `trading-second-opinion`** ainda
   diziam "calibrated confidence tier". Viraram "confidence tier com track record
   público" + link pra `/accuracy`.
3. **`tickrify-vs-tradingview`** dizia "calibrated against outcomes we track".
   Agora diz o que é verdade: a calibração medida no backtest **não se reproduziu
   em produção até agora**.
4. **⚠️ O pior: `es.ts`, `de.ts` e `ja.ts` estavam desatualizados.** O `39%` de
   abstenção é **hardcoded no `SocialProof.tsx`** e vem de PRODUÇÃO. en/pt/fr
   foram atualizados em julho para "388 análises reais em produção"; espanhol,
   alemão e japonês continuaram atribuindo esse mesmo 39% à metodologia velha
   ("150 amostras cegas de backtest"), cuja abstenção era outra. Três idiomas
   afirmando algo factualmente errado sobre o número que está na tela. Corrigido
   nos três.

**Lição que vale virar regra:** número em componente + metodologia em 6 arquivos
de i18n = divergência garantida. Quando um dado sai de produção, ele deveria vir
da API junto com o rótulo, não ser hardcoded ao lado de seis traduções soltas.

#### Pendências que a varredura levantou (NÃO corrigidas)

- **`fP1`–`fP5` e `fE1`–`fE5` nos 6 idiomas são strings mortas** do tempo dos 3
  tiers — falam de "150 Ticks" e "US$ 0,19 por análise", preço que não existe
  mais. Confirmado que NÃO são renderizadas (`PricingSection` usa `fS1`–`fS4`).
  Não removi pra não misturar limpeza com esta sprint, mas é lixo com preço
  errado esperando alguém reutilizar sem olhar.
- **O `388`/`39%` é um retrato de julho** e está congelado no código. Já deve ter
  mudado. Ou vira dado vivo da API, ou o rótulo precisa de revisão mensal.

### 10/08 — parte 5: calculadoras, limpeza do i18n e as flags visíveis

#### 🎯 As flags que a vitrine vende agora aparecem sozinhas
O `ENABLE_QUICK_GROUNDING` era uma pendência de **17/07 nunca confirmada**, e
isso deixou de ser detalhe de infra: o card de preço lista "Live candle
grounding" como feature paga e os posts do blog usam grounding como A diferença
entre a Tickrify e um wrapper de GPT. Se a flag estiver `false` no Render, a
vitrine afirma algo que a produção não faz — e ninguém percebe.

Em vez de continuar dependendo de alguém abrir o env group:
- **Log no boot** (`main.ts`): `🎯 Quick grounding: ON|OFF ⚠️` e
  `🧪 A/B prompt v9: X%`. Primeira tela do log de deploy no Render.
- **`/health`** (protegido por ops token) passou a devolver `ai.quickGrounding`
  (`enabled|disabled`), `ai.abPromptV9Percent`, `ai.modelQuick` e `ai.modelDeep`.

Trate `quickGrounding: 'disabled'` como **incidente de claim**, não como config.

#### 🧮 3 calculadoras grátis — `/tools/` (Fase 1 do plano, enfim)
Estáticas em `public/tools/`, mesmo mecanismo do blog (filesystem antes do
rewrite), então **zero risco pro app React**. Sem dependência, sem build:
o JS roda no navegador e nada sai dele.

- `/tools/position-size-calculator/` — tamanho, risco, distância do stop e a
  alavancagem que os inputs implicam.
- `/tools/risk-reward-calculator/` — razão + **o win rate de breakeven**, que é
  o número que decide se a razão significa alguma coisa.
- `/tools/breakeven-win-rate-calculator/` — breakeven **com custo por trade em
  R** (a maioria das calculadoras omite) + expectancy em R no win rate real.
- `/tools/` — índice, linkado dos 6 posts e do rodapé do blog. Todas no sitemap.

**Matemática verificada, não confiada:** as funções são puras e exportadas com
`module.exports`, então dá para testá-las no Node sem navegador. Rodei 39
asserções — incluindo conferir que **todo número escrito no texto das páginas
bate com o que o código calcula** (o "2.17", o "31.5%", o "+0.30R", e as 15
células das duas tabelas). Interatividade conferida com Playwright.

Fórmula que vale registrar, porque é o diferencial da terceira página:
`breakeven = (1 + custo_em_R) / (1 + R)`, de `w·R − (1−w) − c = 0`.

#### 🧹 i18n: 84 strings mortas removidas
`fP1`–`fP5`, `fE1`–`fE5`, `proBadge`, `eliteBadge`, `proCta`, `eliteCta` — 14 por
idioma, 6 idiomas. Restos dos 3 tiers, anunciando "150 Ticks" e "US$ 0,19 por
análise", preço que não existe desde 27/07. Confirmado por grep que nenhuma era
renderizada (`PricingSection` usa só `fS1`–`fS4`). Typecheck limpo depois.

**Verificação:** build completo rodado na nuvem — frontend e backend com
typecheck limpo, `dist/tools/` gerado, e as 5 rotas pré-renderizadas intactas.

### 10/08 — parte 6: o que os painéis mostraram (lido no navegador, nada alterado)

#### ✅ `ENABLE_QUICK_GROUNDING = true` — CONFIRMADO no Render
A pendência aberta desde 17/07 está **resolvida e era falso alarme**: a flag está
`true` no serviço. A promessa "Live candle grounding" do card de preço e dos posts
do blog **é legítima**. Fechado.

Detalhe que o CLAUDE.md registrava errado: **não existe env group** (Env Groups: 0).
As variáveis vivem direto no serviço `tickrify` (`srv-d6o0b5nafjfc73ap4270`).

Também confirmado pela lista (alfabética) de ~40 variáveis:
- **`AB_PROMPT_V9_PERCENT` NÃO existe** → default 0 → o A/B do v9 segue desligado.
- **`AI_MODEL_QUICK` e `AI_MODEL_DEEP` NÃO existem** → produção usa o default do
  código (`gpt-4o-mini` no quick, `gpt-4o` no deep). Bate com o verificado em 30/07.

#### 🔴 Search Console — o diagnóstico que faltava
O site **ESTÁ indexado**. A hipótese de "não indexado" (10/08, parte 1) está
**DERRUBADA**. O problema é *o que* está indexado — só 5 páginas:

| página | último rastreamento |
|---|---|
| `tickrify.com/` | 03/08 |
| `clerk.tickrify.com/` | 23/07 — subdomínio de auth, não deveria estar no índice |
| `tickrify.com/privacidade` | 17/07 — a versão NÃO canônica |
| `tickrify.com/sign-in` | 16/06 — está no `Disallow` do robots E MESMO ASSIM indexou |
| `tickrify.com/pricing` | **16/06** |

**O blog inteiro está fora do índice.** Nenhum dos 7 arquivos. E `/pricing` não é
rastreado desde 16/06 — nada do trabalho de julho foi visto.
Desempenho do período: **1 clique**.

**CAUSA RAIZ ENCONTRADA:** sitemap enviado em 20/07, última leitura 20/07, **8 URLs**.
Os posts do blog entraram em **22/07** — dois dias depois. O Google nunca viu essas
URLs, e sem link externo apontando pra elas, elas não existiam pra ele.
**Sitemap reenviado em 10/08: lido na hora, 8 → 12 URLs.** Gargalo destravado.

Inspeção de URL manual não rolou — a ferramenta do Google estava com erro
("tente novamente em algumas horas"). Refazer depois para `/accuracy`, `/try`,
`/blog/` e os posts.

#### 🆕 Lição técnica nova: `Disallow` ≠ `noindex`
`/sign-in` está bloqueado no robots.txt e **mesmo assim foi indexado**. Isso é
esperado: o robots impede RASTREAR, não INDEXAR — a URL entra no índice via link,
sem conteúdo. A correção certa é `noindex`, que exige que a página NÃO esteja
bloqueada (o Google precisa poder ler a meta). O `useSeo` criado hoje já tem o
parâmetro `noindex`; falta ligá-lo nas rotas de auth e emitir os shells no
pré-render. **PENDENTE.**

#### Continua pendente e só o dono resolve
- Ligar `AB_PROMPT_V9_PERCENT=20` (não fiz: altera produção e dispara redeploy).
- Cancelar as 2 assinaturas de teste em BRL no Stripe (não fiz: irreversível e
  mexe em cobrança).

---

### Sprint 11/08 — parte 7: fechamento das pendências de dono (Stripe + modelo)

Executado com autorização explícita do Vini, no navegador dele.

#### ✅ Stripe — pendência encerrada
A nota da parte 6 dizia "cancelar as **2** assinaturas de teste". **Estava errada.**
O filtro `?status=all` mostrou **5 assinaturas**: 4 já canceladas antes e **1 ativa**.

A ativa era `sub_1TazIdB1hl0IoocUQeVHAzxe` — cliente `vm3441896@gmail.com` (o próprio
Vini), produto **Tickrify • Elite** (tier removido da vitrine em 27/07), R$ 297,00/mês,
criada em 25/05/2026, próxima fatura R$ 0,00 (zerada pelo cupom `dev.cupom`).

**Cancelada em 11/08, imediatamente, sem reembolso** (a fatura mais recente era R$ 0,00,
não havia o que reembolsar). O filtro "Ativas" agora retorna **nenhuma assinatura**.

O loop fechou inteiro — o log do Render confirma que o webhook chegou e o backend
processou: `[StripeService] Subscription sub_1TazIdB1hl0IoocUQeVHAzxe marked as canceled
for user cmpkjptjh0003dl0767npi6w6`. Esse usuário voltou pro plano free.
**Isso também é prova de que o webhook de cancelamento funciona em produção** — coisa
que até hoje nunca tinha sido observada com um evento real.

#### ✅ Modelo — `AI_MODEL_QUICK` agora existe
A parte 6 registrava que `AI_MODEL_QUICK`/`AI_MODEL_DEEP` **não existiam** no Render e
que produção rodava no default do código. Isso mudou:

- `AI_MODEL_QUICK = gpt-5.6-luna` foi **criada** no Environment do serviço.
- Deploy do commit `52db73d` disparado por essa mudança: **live em 11/08 08:59**.
- Boot limpo: Nest subiu, Prisma conectou, `PromptSyncService` reportou `Prompt em dia (v10)`.
- `AI_MODEL_DEEP` foi deixada **intocada** de propósito → o deep continua no `gpt-4o`.
  A substituta sugerida pela OpenAI é `gpt-5.6-sol`, e trocar o deep é decisão separada,
  com custo e latência diferentes.

⚠️ **Ainda NÃO validado end-to-end.** O deploy subiu e o app está de pé, mas **nenhuma
análise real rodou desde a troca** — não há uma linha de log sequer citando o modelo.
Enquanto ninguém rodar uma análise de verdade, "luna está em produção" quer dizer só
"a variável está setada". **Próximo passo obrigatório: rodar 1 análise e conferir o log.**

🔒 **`AB_PROMPT_V9_PERCENT` continua em 0 e deve continuar** até essa validação passar.

> ✅ **DESTRAVADO EM 17/08/2026.** A validação passou: tres analises reais gravaram
> `gpt-5.6-luna` na coluna `model`, com resposta valida (inclusive um WAIT). O
> motivo do bloqueio ("ligar o A/B antes de provar que o luna aguenta o prompt e
> empilhar duas variaveis nao testadas") **deixou de existir**. Ligar o
> `AB_PROMPT_V9_PERCENT` agora e uma decisao aberta, nao mais um risco empilhado.
> Continua sendo decisao do dono — e, com trafego zero, o A/B levaria meses para
> juntar amostra. Ligar faz sentido DEPOIS que o conteudo trouxer gente.
O v9 não roda no `mini` (>120s, satura o teto de saída); ligar o A/B antes de provar que
o luna aguenta o prompt é empilhar duas variáveis não testadas de uma vez.

## Acesso do dono (comp) e um bug de e-mail suspeito — 17/08/2026

### O dono tem acesso pago SEM assinatura no Stripe
Ele queria usar o proprio produto de graca. O caminho do cupom (criou `TICKS`,
100% vitalicio) foi **descartado**: cupom de 100% nao cria "acesso gratis", cria
uma ASSINATURA REAL de valor zero no Stripe — e o Stripe acabou de chegar em
**0 assinaturas ativas** (as 5 anteriores, todas dele, estao canceladas (conferido 29/07)). Assinar
com o cupom devolveria "1 assinante ativo" falso justo na metrica que a auditoria
de 27/07 limpou.

O que destrava acesso pago e SO isto (`ai.service.hasPaidAccess`): uma linha em
`Subscription` com status `active`/`trialing`. Nao existe flag no User, nao existe
bypass por `role='admin'`, e cupom nao entra na conta.

**Linha inserida a mao no Supabase (17/08/2026):**
- `id='sub_owner_1'`, `stripeId='manual_owner_1'`, `status='active'`,
  `priceId='price_1TRvEJB1hl0IoocUvbCyxkt5'` (starter mensal USD, 200 ticks)
- `userId='cmpkjptjh0003dl0767npi6w6'` — a conta do dono, identificada por ter
  **403 analises** contra 25 do segundo colocado.
- Os ticks NAO entram no INSERT: `ensureTicksForActiveSubscriber` credita os 200
  na primeira analise, e so se o saldo estiver zerado.
- **Desfazer:** `DELETE FROM tickrify."Subscription" WHERE "stripeId" = 'manual_owner_1';`

**⚠️ CONSEQUENCIA QUE PRECISA ESTAR NA CABECA DE QUEM LER ISTO:** o BANCO conta o
dono como assinante ativo; o STRIPE nao. Qualquer contagem de "assinantes" tirada
do banco esta +1 e nao ha cliente pagante real. Filtrar sempre com
`WHERE "stripeId" NOT LIKE 'manual_%'`. O prefixo `manual_` existe exatamente pra
isso.

O cupom `TICKS` continua no Stripe, inofensivo: o DTO
(`create-checkout-session.dto.ts`) tem `@IsIn(['EARLY35'])`, entao nenhum checkout
consegue aplicar outro cupom programaticamente. Nunca se descobriu por que a
Stripe recusava o TICKS digitado no checkout — ficou sem diagnostico.

### ⚠️ `User.email` NULL em producao — CAUSA PROVAVEL ISOLADA (17/08)
Ao procurar a conta do dono por e-mail, o INSERT nao achou NINGUEM. A consulta
mostrou **`email` NULL nas 20 contas mais recentes** — por isso a primeira
tentativa deu "Success. No rows returned" sem inserir nada.

Isso contradiz a secao "Sprint 20-21/07", que declara **"E-mails 100%
funcionando"** apos o fix do `clerk-email.ts` + backfill no `getMe`. Se `email`
esta NULL, **o e-mail de boas-vindas e o de recuperacao nao tem destinatario** — e
o de recuperacao e a peca de ativacao que dispara quando o free bate no limite.
Pode estar falhando calado desde julho.

**Nao confirmado.** Hipotese alternativa: o backfill so roda quando o usuario
volta ao painel (`GET /api/auth/me`), e essas 20 contas seriam de gente que nunca
voltou. Mas 20 de 20 e forte demais para ignorar. **Investigar:** ler o backfill
do `auth.controller` + procurar no log do Render se ele executa.

### Nota de operacao
Escrever no banco de producao esta FORA do que o Claude consegue executar (o
ambiente bloqueia o painel do Supabase). SQL de producao e sempre entregue pronto
para o dono colar no SQL Editor — de preferencia com o id ja preenchido e com o
comando de desfazer junto.

### Auditoria de acesso de 12/08 — VERIFICADA em 17/08
Trabalho de outra sessao, encontrado sem commit na arvore. Conferido antes de subir:
- `GlobalAuthGuard` como APP_GUARD inverte o default do backend: rota sem
  decorator agora FECHA (antes nascia publica). Escape so via `@Public()`.
- `AuthGuard` ganhou memoizacao por request — sem ela, cada requisicao
  autenticada faria 2x `verifyToken` + 2x `user.upsert` (o guard roda como
  global E pelo `@UseGuards` que ficou nos controllers como defesa em profundidade).
- **Superficie publica COMPLETA hoje (7 pontos, todos conferidos):** controller
  `demo` inteiro · `POST /stripe/webhook` (HMAC) · `GET /calendar/events` ·
  controller `health` (com `/health` e `/health/ready` ainda atras do
  OpsTokenGuard) · `GET /ai/public-analyses` · `GET /ai/accuracy` ·
  `GET /market/context`. Bate exatamente com o que o frontend chama deslogado.
- `route-access.spec.ts` varre o FONTE e quebra o CI se alguma rota ficar sem
  decisao explicita de acesso. 7 testes.
- Migracao `20260812120000_analysis_isdemo_and_model`: `ADD COLUMN IF NOT EXISTS`
  para `isDemo`/`model`. **NO-OP na producao atual** (as colunas ja existem);
  conserta banco criado do zero.
- Verificacao: **jest 88/88 passando** (16 suites) e **`tsc --noEmit` do backend
  com 0 erros**.

**⚠️ CORRECAO: os "7 erros conhecidos do `outcome`" NAO EXISTEM MAIS.** O Prisma
Client local foi regenerado; o backend type-checa limpo. Se aparecer erro de
`outcome` de novo, e Prisma Client desatualizado — rode `npx prisma generate` em
`apps/backend`. Qualquer outro erro e problema real.

### Por que o `.git/index.lock` fica preso quando o Claude mexe no repo
O Claude opera o repo por um shell em sandbox que **nao tem permissao de apagar
arquivo** (`rm`/`unlink` retornam "Operation not permitted"). Qualquer comando git
que toque no index — `git status`, `git diff`, `git apply` — cria o
`.git/index.lock` e depois **falha ao remove-lo**. O git segue funcionando na
hora, mas o lock fica para tras e o SEU proximo `git commit` quebra com
"Unable to create index.lock: File exists".

Nao e corrupcao e nao ha risco: o arquivo tem 0 byte. Corrige com
`rm -f ~/dev/tickrify/.git/index.lock` antes do commit.

**Regra pratica:** o Claude deve evitar rodar `git status`/`git diff` na maquina
do dono quando puder responder de outro jeito, e sempre avisar que o lock pode
ter ficado. Ler arquivo com `grep`/`sed`/`python` nao cria lock — so comandos git.


---

## 📊 ESTADO DO SEO — TABELA VIVA (atualizada em 17/08/2026)

> **LEIA ISTO ANTES DE AUDITAR SEO NESTE PROJETO.** Esta secao existe por um
> motivo concreto: em 17/08 chegou um PDF de auditoria de SEO datado de
> **10/08**, e ao reconferir item por item descobriu-se que **a maioria dos
> achados ja tinha sido corrigida na propria semana de 10/08** — pelas partes
> 1 a 6 daquela sprint, registradas acima. Gastou-se uma sessao inteira
> reconferindo trabalho pronto.
>
> A auditoria nao estava errada; ela estava **desatualizada em uma semana**.
> A diferenca entre "achado" e "achado ja resolvido" nao estava escrita em
> lugar nenhum que se lesse rapido. Agora esta, aqui.
>
> **Regra:** ao receber uma auditoria (externa ou gerada por outra sessao),
> cruze com esta tabela ANTES de abrir codigo. So investigue o que estiver
> como PENDENTE. E ao corrigir qualquer item, mova a linha aqui no mesmo commit.

### Resolvido — nao reabrir sem evidencia nova

| Item | Onde vive hoje | Fechado em |
|---|---|---|
| Meta/title/description por rota | `hooks/useSeo.ts` + `lib/seo-routes.json` | 10/08 |
| Pre-renderizacao do `<head>` das rotas publicas | `scripts/prerender.mjs` (roda no `build`) | 10/08 |
| Canonical em todas as rotas React (inclusive home) | `useSeo` | 10/08 |
| `/privacidade` duplicada da `/privacy` | canonical fixo em `/privacy` no `useSeo` | 10/08 |
| Sitemap sem `/try`, `/accuracy`, sem `lastmod` | `public/sitemap.xml` (16 URLs) | 10/08 |
| `/accuracy` orfa | rodape + link nos 6 posts + sitemap + meta propria | 10/08 |
| `og:image` no imgur (host de terceiros) | `public/og.png`, 1200x630 | 10/08 |
| `maximum-scale=1.0` bloqueando zoom | removido do viewport | 10/08 |
| Descriptions de 178–238 chars | todas em 130–163 | 10/08 |
| `FAQPage` + `SoftwareApplication` + `Offer` na `/pricing` | `PricingPage.tsx`, gerado do MESMO objeto que a tela renderiza | 10/08 |
| Posts rasos (539–724 palavras) | os 6 estao entre 1.698 e 2.621 | 10/08 |
| `dateModified` nos posts | schema `Article` dos 6 | 10/08 |
| 3 calculadoras gratis | `public/tools/` (3 + indice), estaticas, no sitemap | 10/08 |
| 3 requisicoes bloqueantes de Google Fonts | **1** requisicao multi-familia no `index.html` | 17/08 |
| Sem `Organization` schema (logo + `sameAs`) | `@graph` no `index.html`, `sameAs` → X e Instagram | 17/08 |
| Blog sem `og:image`/`og:url`/`twitter:*` | os 7 arquivos; `image` tambem no schema `Article` | 17/08 |
| `/accuracy` sem structured data | `Dataset` schema com `variableMeasured` e `measurementTechnique` | 17/08 |
| `<html lang>` fixo em `"en"` | segue o idioma escolhido (`LanguageContext`) | 17/08 |
| `robots.txt` sem subdiretorio explicito | `Disallow` com e sem barra nas 4 rotas privadas | 17/08 |
| Sem landing por plataforma nem por classe de ativo | `public/for/`: hub de cobertura + `/for/tradingview/`, `/for/metatrader/`, `/for/bitcoin/`, `/for/gold/`, `/for/forex/`. Estaticas, mesmo mecanismo do `/blog/` e do `/tools/` (o Vercel serve o arquivo antes do rewrite), 1.066 a 1.406 palavras visiveis, `FAQPage` gerado do MESMO texto que a pagina mostra, no sitemap, linkadas dos 6 posts e dos dois indices. **NVDA/SPY ficaram FORA de proposito:** acao e ETF nao tem grounding de candle (`normalizeToBinancePerp` cobre 40 bases de cripto, `fetchFxCandles` cobre XAU/XAG e majors de FX, e mais nada), entao uma landing de acoes venderia dado ao vivo que nao existe. O hub publica a tabela de cobertura com os NAOs, que e o oposto do que o concorrente faz. | 26/08 |
| `/sign-in` indexado apesar do `Disallow` | `noindex` de verdade: as duas rotas de auth SAIRAM do `Disallow`, entraram no `seo-routes.json` com `noindex: true` (shell do `prerender.mjs`) e o `AuthScreen` do `App.tsx` chama o `useSeo` pos-hidratacao. `seoFor` passou a propagar o `noindex`, que ele descartava. | 26/08 |
| Corpo das rotas React invisivel sem JS (ZERO palavra em `/`, `/pricing`, `/accuracy`, `/try`) | `scripts/geo-body.mjs` gera o corpo dentro de `<noscript>` a partir do PROPRIO `en.ts` e da API de acuracia, e o `prerender.mjs` injeta. Home passou de 0 para 876 palavras em HTML cru. A nota antiga dizia que isto exigia navegador headless: exige para renderizar o APP, nao para servir o TEXTO. | 14/09 |
| JSON-LD so existia depois do JS (nenhum crawler de IA via schema) | `buildJsonLd` emite FAQPage na home, SoftwareApplication+Offer na /pricing e Dataset na /accuracy no HTML cru; `useJsonLd` passou a remover o bloco de mesmo id ao montar, entao o React substitui em vez de duplicar. | 14/09 |
| robots.txt sem regra nomeada para crawler de IA | 15 agentes liberados explicitamente em `public/robots.txt` (OAI-SearchBot, ChatGPT-User, GPTBot, Google-Extended, PerplexityBot, ClaudeBot, Bingbot, Applebot-Extended e outros). | 14/09 |

### ⚠️ Auditoria de SEO recebida em 26/08 — QUASE TODA desatualizada

Chegou uma auditoria de fora (formato Perplexity, com fontes) dizendo que o
Tickrify nao tem conteudo, nao tem meta title por rota, precisa de 10-15 posts e
de um artigo "Tickrify vs ChatGPT". **Tudo isso ja existia**, feito em 10/08.
Segunda vez que isto acontece (a primeira foi em 17/08 e originou esta tabela).

Tres recomendacoes dela eram ativamente PERIGOSAS e ficam registradas para
ninguem tentar de novo:
1. **"Canal Telegram com sinais gratis"** — mata o posicionamento inteiro. O
   produto nao e sinal, e segunda opiniao.
2. **Pitch "temos X% de acuracia"** — e exatamente a classe de claim que a
   auditoria de 27/07 passou uma sprint removendo. Numero so sai com
   metodologia e disclaimer, e a /accuracy ja publica o real.
3. **"Peca ao ChartSnipe para te incluir no ranking deles"** — o ChartSnipe e o
   concorrente que se autopontua 47/50 no proprio ranking. Isso ja esta
   documentado e e usado como argumento de abertura no nosso proprio post.

Ela acertou o que o projeto ja sabia: zero backlink, zero prova social, ausencia
das listas de comparacao. Gargalo e trafego, nao SEO tecnico.

### ⚠️ FALSO POSITIVO — nao "corrigir"

- **`&amp;` nas UTMs dos links do blog.** Auditoria marcou como sujeira. **Nao e.**
  `&amp;` e a codificacao CORRETA de `&` dentro de um atributo HTML; o navegador
  decodifica antes de montar a URL e o parametro chega limpo no analytics.
  Trocar por `&` cru e que seria HTML invalido. **Deixe como esta.**

### PENDENTE — e de quem e

| Item | Por que nao foi feito | Quem resolve |
|---|---|---|
| **Pedir indexacao de `/for/bitcoin/`, `/for/gold/` e `/for/metatrader/`** | A cota diaria da Inspecao de URL e de **10 pedidos por dia** e estourou em 26/08 no 11o (as 8 do blog/tools/try/privacy + `/for/` + `/for/tradingview/`). O proprio Google respondeu "A cota foi excedida. Tente novamente amanha". Nao ha urgencia: as tres estao no sitemap reenviado e linkadas das outras paginas. | Claude ou dono |
| **Imagens reais nos 6 posts** | **Bloqueado por falta de asset.** Os dois PNGs do repo (`demo-example-chart.png`, `demo-after-chart.png`) sao prints CRUS de XAUUSD M30 **sem nenhuma analise sobreposta** — nao sao prova de produto, e reancoram o conteudo na geo que foi abandonada de proposito. Colocar seria pior que nao ter. Precisa de screenshot real de uma analise em NVDA/SPY/BTC. | **dono manda o print**, Claude liga |
| **Autor pessoa (E-E-A-T)** | Schema `Article` usa `author: Organization`. Em YMYL financeiro o Google pesa autor pessoa com bio. Nao da pra inventar nome. | **dono define nome + bio** |
| ~~**Decisao de i18n**~~ | **DECIDIDO em 17/08/2026: ingles e o unico idioma indexavel.** Ver secao propria abaixo. | ✅ fechado |
| Glossario de padroes de candle | Cluster inteiro numa pagina. Multi-dia. | Claude |

### ✅ Search Console reinspecionado em 26/08 — diagnostico novo

Lido no navegador do dono. **O quadro mudou desde 10/08 e a causa raiz e outra.**

- **11 paginas indexadas** (eram 5 em 10/08) e 11 fora. O sitemap FUNCIONA: enviado
  em 10/08, ultima leitura **21/08**, status Processado, 16 URLs encontradas
  (bate com o sitemap antes dos 3 legais de 24/08).
- Das 11 fora: 3 "Pagina com redirecionamento", 8 **"Detectada, mas nao indexada"**
  e 1 indexada **"sem conteudo"** (sintoma classico de SPA; nao identificada qual).
- As 8 detectadas e nunca rastreadas (**Ultimo rastreamento: N/D** em todas):
  `/blog/`, `/blog/ai-chart-analysis/`, `/blog/best-ai-chart-analysis-tools/`,
  `/blog/chatgpt-chart-analysis/`, `/privacy`, `/tools/`,
  `/tools/breakeven-win-rate-calculator/` e `/try`.

**🔴 A causa raiz, lida na propria ficha de inspecao:** o campo *Pagina de
referencia* do `/blog/` dizia **"Nenhuma pagina foi detectada"**. Ou seja: o
Google so conhecia o indice do blog pelo sitemap, com **zero link apontando para
ele**, e URL sem link e a primeira coisa que ele despriorizava na fila de
rastreamento. Conferido no codigo depois: o unico link para `/blog/` no projeto
inteiro estava no `Footer.tsx` do React, que so existe depois do JS. **Nenhum
arquivo estatico linkava o indice do blog.**

Corrigido no mesmo commit: os 6 posts, as 5 landings do `/for/` e o `tools/index.html`
passaram a linkar `/blog/`. Os posts que JA tinham pagina de referencia
(`ai-chart-analysis` vinha de `best-ai-chart-analysis-tools`) confirmam que o
link interno e o que o Google segue.

**Indexacao solicitada nas 8** em 26/08, uma a uma, na Inspecao de URL. Nao ha o
que fazer alem disso: a fila e do Google. Reconferir em ~1 semana; o numero a
olhar e "Ultimo rastreamento" deixar de ser N/D.

⚠️ `/tools/breakeven-win-rate-calculator/`, `/try` e `/privacy` apareceram como
**"O Google nao reconhece o URL"** e "Nenhum sitemap de referencia foi detectado",
mesmo estando no sitemap. E consequencia da leitura de 21/08 ser anterior a
algumas dessas entradas. Reforca a pendencia de reenviar o sitemap pos-deploy.

### 26/08, pos-deploy (commit `ca6bf8f`) — verificado ao vivo

Conferido com `fetch` do HTML CRU (sem executar a SPA, ou seja o que Bing e
crawler de IA enxergam), nao por screenshot:

| rota | `<title>` servido | `robots` |
|---|---|---|
| `/sign-in` | Sign in \| Tickrify | **noindex,nofollow** |
| `/sign-up` | Create your account \| Tickrify | **noindex,nofollow** |
| `/pricing` | Pricing: $29/mo for 200 AI Chart Analyses | sem meta (indexavel) |
| `/for/` e as 4 filhas | titulos proprios, canonical proprio | sem meta (indexavel) |

`robots.txt` no ar sem o `Disallow` das rotas de auth; `sitemap.xml` no ar com
as 24 URLs, incluindo o bloco `/for/`.

**Sitemap reenviado em 26/08** (Search Console > Sitemaps). Atencao ao formato:
em propriedade de DOMINIO o campo exige a **URL completa** — `sitemap.xml`
sozinho e recusado com "Endereco do sitemap invalido". Enviar
`https://tickrify.com/sitemap.xml`.

**Cota da Inspecao de URL: 10 pedidos por dia.** Estourou no 11o. Ficou para
outro dia o pedido de `/for/bitcoin/`, `/for/gold/` e `/for/metatrader/`.

### 🔴 Claim corrigido antes de virar problema: VOLUME em forex e ouro (26/08)

Ao escrever a landing de forex fui reler o `ai.adapter.ts` e achei uma coisa que
eu mesmo tinha escrito errado horas antes, na primeira leva de paginas: a `/for/gold/`
e o hub afirmavam que a analise traz **volume contra a media de 20 e mapa de
volume por preco**. Isso e verdade em CRIPTO e **falso em forex e metais spot**.

O codigo esta certo e e explicito sobre isso:
- `safeVolume` (linha ~290): "Ausente/invalido vira 0, e 0 faz o bloco de volume
  ser omitido — nunca inventado."
- `buildVolumeProfile` (linha ~305): "Devolve null quando nao ha volume
  utilizavel (ex.: forex spot)."
- `fetchFxCandles` (linha ~1370): "Forex spot NAO tem volume centralizado — o
  campo costuma vir ausente ou zerado, e isso e correto."

Ou seja: quem construiu o motor tomou a decisao certa (nao inventar) e **a
vitrine ia contar a historia errada**. Corrigido nas duas paginas, e a
`/for/forex/` transformou isso em argumento de venda com uma secao propria
("What it refuses to fake: volume"), porque concorrente que promete volume
profile em forex esta mostrando tick volume ou estimativa.

**Licao que vale repetir:** a regra de "so afirmar o que o codigo faz" nao vale
so para auditoria de pagina velha. Vale para a pagina que voce esta escrevendo
AGORA, e a unica forma de cumprir e abrir o arquivo do motor antes de escrever
a frase, nao depois.

### Notas operacionais que custaram tempo (17/08)

- **`vitest` e `vite build` NAO rodam no VM que o Claude usa na maquina do dono**
  (`MODULE_NOT_FOUND` no binario nativo do `rollup`). `tsc --noEmit` e `eslint`
  rodam normalmente via `./node_modules/.bin/`. Nao use `npx` la — o VM nao tem
  rede e o npm tenta baixar o pacote (`403 Forbidden`).
- **Como validar o `prerender.mjs` sem `vite build`:** copie `scripts/`,
  `src/lib/seo-routes.json` e um `index.html` para uma pasta temporaria fora do
  repo e rode `node scripts/prerender.mjs` la. Ele avisa
  `bloco #root nao reconhecido` quando alimentado com o `index.html` FONTE — isso
  e esperado e nao e bug: o Vite move o `<script type="module">` para o `<head>`
  no build, e so ai o `</div>` fica colado no `</body>` que a regex ancora.
- **A URL consolidada do Google Fonts nao pode ser validada do sandbox**
  (o proxy bloqueia `fonts.googleapis.com`). A sintaxe multi-familia esta
  confirmada na doc oficial e cada spec de peso/eixo foi copiada verbatim das
  URLs antigas — mas **se as fontes quebrarem, e aqui que se olha primeiro.**

## Sprint 17/08 — segunda auditoria de claims, agora na LANDING

A auditoria de 27/07 limpou a vitrine, mas passaram batido tres alegacoes de
TEMPO e uma secao inteira que se contradizia. Achados de uma leitura da pagina
no navegador:

1. **Secao "FULL TRANSPARENCY" se autodestruia.** Titulo dizia *"Signals
   generated in real time"* e os cards logo abaixo mostravam "6d ago", "7d ago",
   "19d ago". Alem de falso, contradizia o posicionamento central
   ("nao e sinal, e segunda opiniao"). Virou *"The latest reads, unfiltered."*
2. **Card "16s average analysis time"** — o unico numero NAO verificavel da
   secao, embaixo de um titulo que diz literalmente **"Verifiable metrics"**.
   O `CLAUDE.md` ja registrava que essa duracao NAO e medivel pelo banco (o
   sweeper reescreve `updatedAt`). Trocado por **"104 trades scored
   automatically / 48h after each call"**, que vem da mesma fonte da /accuracy.
3. **Badge do hero `• real time`** e **CTA final "in 30 seconds"** — mortos.
   Tambem `how.highlight` "in seconds" → "before you enter".
4. **Rodape com 388 analises (julho)** → 395 (agosto). Numeros conferidos ao
   vivo no `GET /api/ai/accuracy` em 17/08: n=104, acerto 37,5% (IC 28,8-47,1),
   abstencao 39,2% (155 WAIT de 395).
5. **`cta.badge` "Open beta now"** → "Open now". "Beta" ao lado de US$ 29 puxa
   contra a disposicao de pagar.
6. **A /accuracy so aparecia no rodape.** E o unico ativo que nenhum concorrente
   tem e estava enterrado. Agora o primeiro card de metrica LINKA para ela
   (`SocialProof.tsx`, campo `href` opcional no REAL_STATS — precisou de tipo
   explicito no array, senao o TS reclama do opcional).

Tudo nos 6 idiomas, mesma chave, mesma posicao. `tsc --noEmit` do frontend: 0 erros.

### "Ouro/Dolar" na vitrine — RESOLVIDO no codigo (nao da para resolver em SQL)
A esteira publica mostrava **"Ouro/Dolar"** num site em ingles. Primeira tentativa
falhou com `ERROR 42703: column "symbol" does not exist`: **nao existe coluna
`symbol`** no `Analysis` — o simbolo mora DENTRO do JSON `result` (em
`result.analysis.symbol`, com fallbacks `symbol`/`ticker`/`asset` no payload
completo). UPDATE em SQL exigiria reescrever JSON linha a linha, com caminho
diferente por registro.

Resolvido na LEITURA: `normalizeSymbol()` em `common/utils/analysis-normalizer.ts`
mapeia legado PT -> ticker padrao (Ouro/Dolar -> XAUUSD, Euro/Dolar -> EURUSD,
etc.), ignorando acento e caixa. Aplicado nos DOIS pontos que expoem simbolo:
`ai.controller.getPublicAnalyses` (vitrine) e `ai.service.listAnalyses` (historico
do usuario). Simbolo desconhecido passa intacto; vazio vira 'N/A'.
5 testes novos em `analysis-normalizer.spec.ts`. Suite: 93/93.

### Contexto que nao pode ser esquecido ao mexer na landing
**Nao existe diagnostico de conversao.** So 4 pessoas na vida completaram uma
analise gratis. Com n=4, mudar a pagina e medir "melhora" e ruido. Estas
correcoes foram feitas por serem FALSAS, nao por serem hipotese de conversao.
O gargalo continua sendo trafego.

### E-mail NULL — a armadilha do OR (17/08/2026)
Investigado. O backfill esta CORRETO: `auth.controller.getMe` chama
`backfillEmailAndWelcome` para todo usuario sem e-mail, novo ou antigo. O
problema esta uma camada abaixo.

**`fetchClerkEmail` exige `CLERK_SECRET_KEY`. O `AuthGuard` aceita
`CLERK_SECRET_KEY` OU `CLERK_JWT_KEY`** (`auth.guard.ts` linhas 119-124: seta
`secretKey` se existir, `jwtKey` se existir, e o `verifyToken` funciona com
qualquer uma).

Consequencia: com apenas a `CLERK_JWT_KEY` no ambiente, **o login funciona
perfeitamente e todo e-mail fica NULL** — sem erro, sem log, sem sintoma. Bate
exatamente com o observado (20 de 20 contas sem e-mail, produto funcionando).

Pior: o proprio `/health/ready` escondia isso, porque reportava
`clerkSecretOrJwtKey` — um OR que dizia "configured" mesmo faltando a SECRET.

**Correcoes desta sessao (nao resolvem sozinhas — instrumentam):**
- `clerk-email.ts` deixou de falhar calado: `logger.error` explicito quando a
  SECRET_KEY falta, `warn` com status HTTP quando o Clerk recusa, `warn` quando
  a conta nao tem endereco. Antes, os tres casos retornavam `null` identicos.
- `/health/ready` agora reporta **`clerkSecretKeyForEmail`** separado do OR.

**PENDENTE DO DONO — provavelmente o conserto inteiro:** conferir se
`CLERK_SECRET_KEY` existe no Environment do servico `tickrify` no Render. Se nao
existir, adicionar resolve tudo sem uma linha de codigo. Se existir, o log novo
dira o motivo real na primeira visita ao painel.

## Migracao do DEEP — a conta (17/08/2026)

Estado: `AI_MODEL_QUICK=gpt-5.6-luna` (desde 11/08). **`AI_MODEL_DEEP` NAO esta
setada** -> o deep cai no default do codigo, `gpt-4o`, que a OpenAI desliga em
**23/10/2026**. Essa e a unica migracao que ainda falta.

### Perfil de tokens do quick (derivado, nao medido)
Resolvendo o sistema com os tres custos ja registrados no CLAUDE.md
(mini $0,003 / luna $0,024 / terra $0,06 por analise rapida):
**~12.000 tokens de entrada + ~2.000 de saida.** Os tres numeros fecham na mesma
solucao, o que indica que sao coerentes entre si.

### ⚠️ O QUE QUEBRA A CONTA INGENUA: tokens de raciocinio
`ai.adapter.ts`: `maxTokens = isNextGenModel(model) ? baseMaxTokens * 2 : base`
(16k -> **32k**). O teto foi dobrado porque modelo GPT-5 gasta tokens internos
invisiveis — e eles sao **cobrados como saida**. Ou seja: "terra tem o mesmo
preco de input que o gpt-4o" e verdade e e irrelevante, porque o custo migra
para a saida, que e onde o terra e 50% mais caro E onde o volume infla.

**Nao existe medicao do fator de inflacao.** Sem medir, qualquer numero de deep
em GPT-5 e chute. Abaixo, faixa entre "sem raciocinio" e "3x de raciocinio".

### Custo por analise DEEP (estimado; deep = 3 ticks)
| Modelo | in/out por 1M | sem raciocinio | com 3x de raciocinio |
|---|---|---|---|
| `gpt-4o` (hoje) | $2,50 / $10 | ~$0,05-0,09 | nao se aplica |
| `gpt-5.6-luna`  | $1 / $6     | ~$0,04 | ~$0,08 |
| `gpt-5.6-terra` | $2,50 / $15 | ~$0,06-0,11 | ~$0,20 |
| `gpt-5.6-sol`   | $5 / $30    | ~$0,12-0,21 | ~$0,39 |

### Margem no pior caso (plano $29, 200 ticks = 66 deeps/mes)
| Modelo no deep | 66 deeps custam | margem bruta |
|---|---|---|
| `gpt-4o` (hoje) | ~$4,60 | ~84% |
| `luna` | ~$5,15 | ~82% |
| `terra` | ~$13,20 | **~54%** |
| `sol` | ~$25,74 | **~11%** ⚠️ |

### ⚠️ A ARMADILHA ESTRATEGICA (mais importante que o custo)
O quick JA e luna. **Se o deep tambem virar luna, os dois tiers rodam o MESMO
modelo** — e cobrar 3 ticks pelo deep vira alegacao sem lastro, exatamente a
classe de claim falso que a auditoria de julho existiu para matar. A diferenca
passaria a ser so prompt/timeframes. Ou o deep ganha modelo melhor, ou o preco
de 3 ticks precisa cair.

### Decisao recomendada
**`terra` no deep.** `sol` no pior caso come quase a assinatura inteira num plano
de preco fixo, e `luna` destroi a justificativa do tier.

### Medir antes de decidir — custa ~US$ 0,60
Saldo atual: **US$ 10** (recarregado pelo dono em 17/08).
1. Setar `AI_MODEL_DEEP=gpt-5.6-terra` no Render.
2. Rodar **3 analises deep** pelo painel.
3. Ler o consumo real no dashboard de uso da OpenAI e dividir por 3.
Isso substitui a faixa estimada acima por um numero medido, e e a unica forma de
saber o fator de raciocinio real. **Atualizar esta tabela com o valor medido.**

### Risco de cauda que ninguem contabilizou
Os ticks **nao expiram e acumulam para sempre** (registrado na auditoria de
27/07 como "nao e claim falso, mas fica de fora"). Num plano de preco fixo, isso
significa que o teto de 66 deeps/mes NAO e um teto de custo no longo prazo: um
assinante antigo pode acumular centenas de ticks e gastar tudo em deep num mes
so. Com `sol` isso seria prejuizo direto.

## Verificacao de 17/08 (noite) — o que a coluna `model` provou

Query em producao, 4 analises rodadas pelo dono entre 17:54 e 18:13 UTC:

| createdAt | model | rec | email | ticks |
|---|---|---|---|---|
| 18:13:09 | **gpt-4o** | SELL | NULL | 358 |
| 18:10:07 | gpt-5.6-luna | WAIT | NULL | 358 |
| 17:57:39 | gpt-5.6-luna | BUY | NULL | 358 |
| 17:54:17 | gpt-5.6-luna | BUY | NULL | 358 |

### ✅ RESOLVIDO: `gpt-5.6-luna` VALIDADO end-to-end em producao
A pendencia aberta em 11/08 ("a variavel esta setada mas nenhuma analise real
rodou, entao 'luna em producao' quer dizer so 'a variavel esta setada'") esta
**fechada**. Tres analises rapidas gravaram `gpt-5.6-luna` na coluna `model`.
O motor roda GPT-5.6 no quick, com resposta valida — inclusive um WAIT, ou seja
a abstencao sobreviveu a troca de modelo. **O `gpt-4o-mini` saiu do quick.**

### ❌ NAO ACONTECEU: a medicao do `terra`
A analise deep das 18:13 gravou **`gpt-4o`** — o default do codigo. Ou seja,
`AI_MODEL_DEEP` estava VAZIA no momento da chamada (`resolveModel` so cai no
default quando nem `AI_MODEL_DEEP` nem `AI_MODEL` existem). Causas possiveis:
variavel nao salva, ou o redeploy do Render ainda nao tinha terminado quando a
analise rodou. **Nao existe um unico token de `terra` consumido — a tabela de
custo do deep continua 100% estimada.**

Alem disso rodou **1 deep, nao 3**: mesmo com a variavel certa, uma amostra so
nao separa custo fixo de variavel.

### ❌ CONTINUA QUEBRADO: `email` NULL
As 4 linhas saem com `email` NULL, inclusive a conta do dono. O commit `f2d8ab6`
(log explicito no `clerk-email.ts`) ja deve estar no ar — entao **o log do Render
agora diz o motivo**. Procurar por `[email]` ou `ClerkEmail` nos logs:
- `CLERK_SECRET_KEY ausente` -> e so adicionar a variavel;
- `Clerk respondeu 401/404` -> chave errada ou usuario inexistente;
- silencio total -> o backfill nao esta sendo chamado (hipotese nova).

### Nota sobre ticks: saldo 358, os 200 NAO foram creditados
`ensureTicksForActiveSubscriber` so credita **se o saldo estiver zerado**. O dono
ja tinha saldo acumulado de compras de teste antigas, entao os 200 do plano nunca
entraram. Nao e bug — e a regra de nao empilhar. Irrelevante na pratica (358
ticks e muito), mas explica por que o numero nao e 200.

## 🔴 CAUSA RAIZ DO E-MAIL — achada em 17/08/2026

**O frontend NUNCA chamou `GET /api/auth/me`.** Busca por `auth/me` no `src/`
inteiro do frontend: **zero resultados**. E o `getMe` do `auth.controller` e o
UNICO gatilho de `backfillEmailAndWelcome`.

Consequencias, todas silenciosas desde julho:
- `User.email` NULL para todo mundo (20 de 20 contas conferidas).
- **O e-mail de boas-vindas nunca foi enviado a ninguem.** Ele foi escrito,
  testado, o dominio do Resend verificado, `MAIL_FROM` setado no Render — e a
  funcao que o dispara jamais foi chamada.
- O e-mail de recuperacao tem gatilho proprio (`ai.service` linha ~1210), entao
  nao depende disto — mas tambem nunca teve e-mail persistido para usar.

**As hipoteses anteriores estavam ERRADAS e ficam registradas para nao voltarem:**
- "CLERK_SECRET_KEY ausente" — plausivel, nao comprovada. Pode ate faltar, mas
  nao era A causa: a funcao que a usa nunca era executada.
- "O upsert do AuthGuard sobrescreve o e-mail com null" — **falso**, verificado
  no codigo: `update: { ...(email ? { email } : {}) }` so escreve se existir.

### Correcao
- `lib/api.ts`: metodo `syncUserProfile()` + wrapper no `useAPIClient`.
- `DashboardPage.tsx`: `useEffect` que chama uma vez por montagem, pula demo,
  engole erro. Todo usuario autenticado passa pelo painel.
- O backend NAO mudou — ele sempre esteve certo. Faltava alguem bater na porta.

### Como validar (nao dar por resolvido antes)
1. Deploy, abrir o painel logado.
2. `SELECT email FROM tickrify."User" WHERE id = 'cmpkjptjh0003dl0767npi6w6';`
   -> deve deixar de ser NULL.
3. Se continuar NULL, AI o log `[email]` do `clerk-email.ts` (commit f2d8ab6)
   diz o motivo real — e ai sim a hipotese da `CLERK_SECRET_KEY` volta a valer.

### ✅ E-MAIL RESOLVIDO E VERIFICADO EM PRODUCAO (17/08/2026, noite)
Commit `dfa80ac` no ar. Verificacao feita chamando o endpoint com o token real da
sessao do dono, pelo navegador dele:

```
GET /api/auth/me  ->  200
{ "email": "vm3441896@gmail.com", ... }
```

O `getMe` devolve a linha do BANCO — logo o e-mail esta **persistido**. O campo
saiu de NULL. O backfill roda.

**Consequencias:**
- Todo usuario existente ganha o e-mail preenchido na proxima visita ao painel.
- O **e-mail de boas-vindas passa a ser enviado de verdade** para quem se
  cadastrar. Ate hoje, nenhum usuario recebeu um.
- O e-mail de recuperacao (free que bate no limite) agora tem destinatario.

**Hipotese `CLERK_SECRET_KEY` DEFINITIVAMENTE DESCARTADA:** ela sempre esteve
correta no Render. Se faltasse, `fetchClerkEmail` devolveria null e o campo
continuaria NULL mesmo com a chamada nova. O problema era 100% a rota orfa.

**Licao para as proximas investigacoes:** antes de suspeitar de ambiente,
verificar se o codigo que usa aquele ambiente **chega a ser executado**. Duas
hipoteses caras (variavel ausente, upsert sobrescrevendo) foram levantadas antes
de alguem fazer o grep de 5 segundos que resolveu.

## ✅ DECISAO DE i18n — ingles e o unico idioma indexavel (17/08/2026)

Decidido pelo dono. **Nao reabrir sem evidencia nova.**

### O que foi decidido
O site indexa em **ingles, e so em ingles**. As 6 traducoes
(`lib/i18n/{pt,en,es,fr,de,ja}.ts`) continuam existindo como **conforto de UX**
para quem ja esta no produto — nao como canal de aquisicao.

### Por que quase nao houve trabalho: ja era o estado de fato
Verificado no codigo em 17/08, antes de decidir:
- **Zero ocorrencias de `hreflang` ou `x-default`** no projeto inteiro.
- **Zero `og:locale`, zero `<link rel="alternate">`, zero `Content-Language`.**
- Canonical e UM por rota, sem variante de idioma (`useSeo`).
- `sitemap.xml`: 16 URLs, nenhuma com prefixo de idioma.
- O idioma vive em `localStorage` — e **o Googlebot nao tem localStorage**, entao
  sempre recebe o padrao `'en'`.

Ou seja: o crawler ja via um site monolingue em ingles. A decisao **formalizou o
que ja acontecia**, em vez de construir seis portas para um produto que ainda nao
ranqueia em uma.

### Consequencias praticas
- **Nao adicionar `hreflang`.** Sem URL por idioma, `hreflang` nao tem para onde
  apontar — seria marcacao invalida. Se uma auditoria futura apontar "falta
  hreflang", isso e **falso positivo neste setup**. Cruze com esta secao antes.
- `document.documentElement.lang = language` (`LanguageContext`) **fica como
  esta**: serve acessibilidade e leitor de tela do usuario real, e nao afeta
  indexacao (o crawler nunca chega a trocar o idioma).
- Texto publico continua sendo escrito em ingles primeiro (regra ja existente).

### ⚠️ O risco que sobra, e que NAO foi resolvido por esta decisao
Manter 6 idiomas continua custando **superficie de claim falso em idiomas que o
dono nao le**. Ja aconteceu: numa revisao passada, alemao e japones continuaram
atribuindo o numero de abstencao a uma metodologia velha depois que o portugues e
o ingles foram corrigidos. Toda mudanca de copy repete esse risco.

**Mitigacao acordada:** ao mudar qualquer string que contenha NUMERO ou
AFIRMACAO VERIFICAVEL, mudar nos 6 no mesmo commit e conferir um a um — nunca so
nos idiomas que o dono le. A alternativa mais forte (cortar para EN+PT) foi
apresentada e **recusada**; fica registrada aqui caso o custo de manutencao
volte a morder.

### O que reabriria esta decisao
Trafego organico relevante chegando em UM idioma. Enquanto o produto nao ranqueia
em ingles, criar rotas localizadas e multiplicar por seis um canal que ainda vale
zero.

## ⏱️ Latencia da analise — CORRIGE a nota de 27/07 E a correcao dela

**A nota anterior desta secao estava errada** e mandou pelo menos uma sessao
para um beco: dizia que bastava buscar `[Metrics]` no log do Render. Nao
bastava, porque essa linha nunca existiu para uma analise real.

`logMetricsHook` (analysis-pipeline.ts) e chamado em UM lugar so:
`ai.service.processSynchronously`. Esse metodo e o **fallback sem fila**. Em
producao `RUN_EMBEDDED_WORKER=true`, a fila existe e tem worker, entao toda
analise passa por `worker/ai.worker.ts` — que ate 08/09/2026 nao media nada.
`Date.now()` nao aparecia uma vez no caminho de analise.

### Agora mede (08/09/2026)

`worker/ai.worker.ts` emite, em sucesso, falha, retry e validacao invalida:

```
[Metrics] analysis <outcome> | analysisId=<id> userId=<id> analysisType=<quick|deep>
  attempt=<n> queueWaitMs=<ms> promptMs=<ms> aiMs=<ms> parseMs=<ms>
  annotateMs=<ms> persistMs=<ms> latencyMs=<ms> [errorCode=<code>]
```

- `aiMs` e a chamada a OpenAI, o grosso do tempo.
- `queueWaitMs` e tempo parado esperando worker livre. Sobe quando
  `concurrency: 3` satura. Se ele crescer, o gargalo e capacidade, nao modelo.
- `annotateMs` e o upload da imagem anotada, que ninguem contava.
- Fase com `-1` = nao chegou a rodar. Nao confundir com zero.

`[Cost]` (model-cost.ts) ja emitia `prompt=`, `completion=` e `reasoning=` em
producao. Com as duas linhas juntas da para dividir tempo por token.

### Numeros MEDIDOS (backtest, gráfico real, caminho de producao)

De `scripts/backtest/results/*.jsonl`, campo `durationMs`:

| Configuracao | n | p50 | p90 |
|---|---|---|---|
| gpt-4o-mini + v7.3 | 321 | **12,9s** | 18,6s |
| gpt-5.6-luna + v9 | 50 | **18,9s** | 22,0s |
| gpt-5.6-luna + v7.3 (= producao hoje) | 11 | **21,9s** | 23,9s |
| luna + `reasoning_effort=medium` | 3 | 26,6s | 29,0s |
| luna + `reasoning_effort=high` | 3 | 53,9s no unico que terminou; 2 de 3 estouraram | falha |

**Trocar o quick para `gpt-5.6-luna` em 11/08 custou +9s de p50** (12,9 → 21,9).
Foi setado sem validacao de qualidade (ver PRD linha 589). O v9, apesar de ter
o dobro de texto, e 15% MAIS RAPIDO que o v7.3 no luna, porque faz o modelo
escrever menos (6002 chars contra 7926 no mesmo grafico).

De `tmp/raw-v73-luna.txt` (a chamada de 22,1s): `prompt=11998 completion=2962
reasoning_tokens=1051`. Isso da 134 tok/s, e o orcamento fecha:
**35% do tempo e raciocinio invisivel**, 60% e o texto do JSON, 5% e prefill.

### Alavancas, em ordem de risco
1. **Ler o log primeiro.** Agora existe.
2. `reasoning_effort` — **ESTA implementado** (`resolveReasoningEffort` em
   openai-params.ts, lido pelas duas rotas). A nota antiga dizia que nao. E a
   alavanca mais direta que existe: `AI_REASONING_EFFORT_QUICK=low|minimal`,
   env var, sem deploy, reversivel na hora. Ataca os 35% invisiveis.
   `high` esta MEDIDO como inutilizavel: passa dos 55s do timeout.
3. `AI_MODEL_QUICK=gpt-4o-mini` — devolve os 9s e corta o custo pela metade.
   Custa qualidade de leitura. Decidir com o `evaluate.py`, nao no olho.
4. Campos do schema: 46 required, e `reasoning` + `executiveSummary` +
   `technicalAnalysis` + `structureValidation` sao 62% de tudo que o modelo
   escreve (medido em `fieldSizes` de 50 respostas).
5. `maxTokens` (16k / 32k) — **nao e alavanca**. Teto e limite, nao consumo.

### ⚠️ Regra de momento
**Nao mexer em parametro de modelo as vesperas de uma demo de alto risco.**
Mudar `reasoning_effort` ou modelo degrada a analise de forma dificil de
prever, e o custo de uma analise ruim para o primeiro usuario influente e maior
que o de dez segundos a mais de espera.

### 09/09/2026 — o log foi lido. O Render esta inocente.

Primeira linha `[Metrics]` de uma analise real em producao (deep, 09:25 BRT):

```
queueWaitMs=3 promptMs=10 aiMs=29832 parseMs=0 annotateMs=0 persistMs=36
latencyMs=29900
```

**49ms de backend contra 29,8s de OpenAI.** Fila zerada, banco instantaneo,
upload da imagem anotada em zero. Nao existe overhead de infra para cortar, e
o plano pago de US$7 (`0.5c-512mb`, contratado 08/09 22:52) so comprou o fim do
spin-down: os 8s que sumiram (39s -> 31s) eram cold start, nada mais.

De 50 linhas `[Cost]` dos dias 07 a 09/09:

| tier | n | completion (mediana) | reasoning | faixa |
|---|---|---|---|---|
| quick | 41 | 2517 | 763 | 730 a 4080 |
| deep | 9 | 3040 | 898 | 2390 a 3993 |

3040 tokens em 29,8s = **102 tok/s**. A conta fecha inteira: o tempo de espera
E a velocidade de escrita do modelo. A variacao de 730 a 4080 tokens explica
por que a mesma plataforma responde em 18s ou em 40s.

**Correcao de duas notas erradas deste arquivo:**
1. `AI_MODEL_DEEP` **esta setada** e vale `gpt-5.6-luna` (o log diz
   `deep model=gpt-5.6-luna`). A nota que diz que ela nao existe e que o deep
   roda `gpt-4o` esta desatualizada. Consequencia real: quick e deep rodam o
   MESMO motor hoje, diferenciados so pelo prompt, e o deep cobra 3 ticks.
2. `AI_REASONING_EFFORT_QUICK` / `_DEEP` nao existiam no Environment ate
   09/09 (conferido pela ordem alfabetica da lista: pula de `AI_MODEL_QUICK`
   direto para `ALLOW_UNAUTHENTICATED`). O dono setou `QUICK=low` em 09/09.

**Prompt cache nao esta pegando.** 13322 x $1/1M + 3040 x $6/1M = $0,0315
contra $0,0316 no log: nenhum token de entrada entrou como cacheado. Com uma
analise a cada 30-60min o cache da OpenAI expira antes da proxima. Resolve
sozinho quando o trafego subir; ate la sao ~$0,013 desperdicados por analise.

**Feito em 09/09 (passo 2 da lista de alavancas):** limites de caracteres
explicitos nos 17 campos de texto do contrato de saida do
`trading-system-prompt.ts` + regra 20 (WORD BUDGET). Os quatro maiores
(`reasoning` 1408 chars, `executiveSummary` 616, `technicalAnalysis` 454,
`structureValidation` 362) sao 59% de tudo que o modelo escreve. O `reasoning`
e o maior de todos e **so aparece na tela como fallback** quando
technicalAnalysis e executiveSummary vem vazios (AnalysisResult.tsx:677 e 795),
entao foi o corte mais agressivo: virou trilha de decisao em clausulas de ate
12 palavras, teto de 500 chars. Esperado: -400 tokens = -4s. Medir na proxima
analise pelo `completion=` do `[Cost]`, nao no olho.

O `PromptSyncService` publica isso sozinho no boot do proximo deploy (cria v11
e ativa). O v9 (`trading-system-prompt-v9.ts`) NAO recebeu os cortes: esta com
A/B OFF e nao roda em producao.

### RESULTADO MEDIDO (09/09, deploy ddc9840 as 10:23)

Quatro analises quick reais depois do deploy, contra a mediana das 41 de antes:

| | completion | reasoning | custo |
|---|---|---|---|
| antes (n=41) | 2517 | 763 | ~$0,0275 |
| 10:30 | 1222 | 209 | $0,0208 |
| 10:41 | 1106 | 134 | $0,0183 |
| 10:59 | 1408 | 279 | $0,0199 |
| 11:59 | 1285 | 233 | $0,0191 |
| depois (mediana) | **1254** | **221** | **~$0,0195** |

**Completion caiu 50%. Latencia na tela: 31,4s -> 18,5s (-41%).** Custo por
analise quick caiu 29% e a margem foi de ~81% para ~86,5%.

A conta fecha: -1263 tokens a 102 tok/s = -12,4s, e o dono cronometrou -12,9s.
Credito dividido entre `AI_REASONING_EFFORT_QUICK=low` (-542 de reasoning) e os
tetos de caracteres (-721 de texto visivel).

**O que falta vigiar:** completion de 1106 e o menor ja registrado num caminho
saudavel. O risco agora inverteu de lado: nao e mais lentidao, e resposta curta
demais. Conferir na tela se `executiveSummary` e `structureValidation`
continuam uteis; se ficarem rasos, o teto a afrouxar primeiro e o do
`executiveSummary` (450 chars), nunca o do `reasoning`.

---

## Sprint 25/08/2026 — calendário econômico devolvendo vazio + aviso desatualizado

**Como apareceu:** o dono perguntou pelo aviso de risco ("a IA não tem
conhecimento de notícias") e se isso batia com a estratégia — a plataforma
deveria trazer eventos/notícia de até 24h na análise.

### O que já existia (achado ao investigar, não construído agora)
O pipeline de **calendário econômico** (ForexFactory, `EconomicCalendarService`)
já estava todo no ar desde 02/06: fonte, endpoint público
`GET /api/calendar/events`, bloco no prompt do deep, guard que rebaixa sinal
pra WAIT com evento High iminente, e accordion "Economic Events" na tela.
**Isto NÃO é notícia/manchete** — é calendário de eventos AGENDADOS (CPI,
payroll, decisão de juros). Não existe no projeto nenhuma fonte de manchete
(procurado: NewsAPI, Finnhub, Marketaux, CryptoPanic, RSS — nada).

### 🔴 Bug real: a fonte estava falhando calada e ninguém via
Testado ao vivo em 25/08: `GET /api/calendar/events?symbol=XAUUSD&hours=168`
em produção devolvia `{"events":[]}` — zero evento em 7 dias, o que não existe
(a fonte ForexFactory tinha 79 eventos na semana, confirmado buscando o feed
direto). Causa: `calendar.service.ts` gravava `this.cache = { data: [], ... }`
mesmo quando as DUAS URLs falhavam — um array vazio por falha de rede ficava
servido por 1h como se fosse "confirmado, sem notícia agendada". A causa raiz
do fetch falhando (bloqueio de IP do Render? rate limit?) **não foi
diagnosticada** — só o log novo (abaixo) vai revelar isso na próxima falha.

**Agravantes encontrados:**
- `AnalysisResult.tsx` mostrava **"✅ Nenhum evento de alto impacto"** sempre
  que `events.length === 0` — inclusive quando a causa era falha de rede, não
  ausência real de evento. Pior modo de falha possível num produto de trading:
  a tela afirmava tranquilidade que ninguém checou.
- `ai.adapter.ts` criava `new EconomicCalendarService()` a cada análise deep —
  cache zerado toda vez, batendo na fonte externa sem necessidade.
- Bloco do prompt usava janela de **12h**; a UI e o guard já usavam 24h.
  Alinhado pra 24h nos três lugares.

### Correção (commit: usuário ainda vai rodar `git add/commit/push`)
- `calendar.service.ts`: `getEventsForSymbol` agora devolve
  `{ events, degraded }`. **Nunca mais sobrescreve o cache num ciclo sem
  sucesso** — se as duas fontes falharem, serve o cache velho (ou vazio, se
  nunca teve sucesso) e marca `degraded: true`. Log separa HTTP não-ok, corpo
  não-JSON (sintoma de bloqueio/challenge page) e falha de rede — antes os três
  caíam no mesmo `catch` genérico. Novo `getFeedStatus()` para diagnóstico.
- `calendar.controller.ts`: `GET /api/calendar/events` agora devolve
  `{ symbol, events, degraded }`.
- `useEconomicCalendar.ts` (frontend): novo campo `unreliable` (true em erro de
  rede OU `degraded` do backend). `AnalysisResult.tsx` **para de mostrar
  "✅ limpo" quando `unreliable`** — mostra aviso amarelo
  "Couldn't check the economic calendar right now" em vez disso. Chave
  `calUnavailable` nova nos 6 idiomas.
- `ai.adapter.ts`: `buildCalendarEnrichment` passou a reaproveitar uma
  instância única (mesmo padrão já usado em `signal-decision.ts`, cache de 1h
  compartilhado) em vez de instanciar o serviço a cada chamada; janela 12h →
  24h; se vier `degraded`, não injeta bloco nenhum (mais seguro que arriscar
  vazio-por-falha lido como "sem evento").
- `signal-decision.ts`: adaptado ao novo retorno `{ events }`. O guard
  continua best-effort — `degraded` não muda o comportamento dele de propósito.
- `/health` (`health.controller.ts`, protegido por ops token) ganhou o campo
  `calendar: { status: 'ok'|'degraded'|'unavailable'|'unknown', lastSuccessAt,
  lastAttemptAt, cachedEvents }` — mesmo padrão do `quickGrounding` já existente:
  trate `degraded`/`unavailable` como **incidente de claim** (a vitrine vende
  "Live candle grounding + economic calendar" e "Economic calendar guard"),
  não como config. `HealthModule` passou a importar `CalendarModule`.
- `RiskDisclosurePage.tsx`: o item "it has no knowledge of news, order flow…"
  estava simplesmente errado sobre calendário — reescrito para "checks the
  economic calendar for scheduled high/medium-impact events... best-effort —
  but has no access to breaking news headlines, market sentiment, or order
  flow". Só existe em inglês (página pública, regra de sempre).

**Verificação:** `tsc --noEmit` do backend limpo, `tsc -b --force` do frontend
limpo, `jest` do backend **150/150** (precisou atualizar
`health.controller.spec.ts` e `health.security.spec.ts` pro novo parâmetro do
construtor), `eslint` limpo nos arquivos tocados dos dois lados. `vitest` não
roda neste sandbox (limitação de VM já registrada, `MODULE_NOT_FOUND` do
rollup nativo) — não foi possível rodar a suíte de componente do frontend.

### ⚠️ PENDENTE — o que isto NÃO resolve sozinho
1. **A causa raiz do fetch falhando não foi diagnosticada.** O código agora
   *revela* a falha (log distingue HTTP não-ok / corpo não-JSON / erro de rede,
   e `/health` expõe o status) em vez de escondê-la. Only depois do próximo
   deploy + próxima falha real é que o log do Render vai dizer qual dos três
   casos é. Suspeito nº 1: bloqueio de IP de datacenter pela Cloudflare/origem
   do ForexFactory — não confirmado.
2. **Notícia/manchete de verdade (não calendário agendado) continua fora do
   projeto.** Se a estratégia do dono depende de sentimento/manchete em tempo
   real, isso é trabalho novo (fonte tipo NewsAPI/Finnhub/CryptoPanic — nenhuma
   integrada hoje). Calendário agendado (o que existe) é uma coisa diferente e
   mais estreita.
3. ~~Não commitado~~ — **subiu em 25/08/2026**: backend em `bc25ad3`, frontend
   em `8df5d8b`. Conferido ao vivo depois do deploy: `/api/calendar/events`
   responde `{"symbol":"XAUUSD","events":[],"degraded":true}`, ou seja, a falha
   da fonte está acontecendo AGORA e o front já mostra o aviso em vez do falso
   "tudo limpo". Isso também estreita o item 1: a falha é **persistente**, não
   intermitente, o que reforça a hipótese de bloqueio de origem e enfraquece a
   de instabilidade de rede. `/api/health` exige o ops token, então quem tem o
   segredo é que consegue ler qual dos três casos o log registrou.

### 31/08 — parte 2: custo por analise medido, e `reasoning_effort` (passos 1 e 2)

**Contexto:** o `gpt-4o` do deep morre em 23/10/2026. O `terra` foi RECUSADO
pelo dono por custo, e a conta confirma que ele estava certo (abaixo). A saida e
`luna` nos dois tiers, diferenciados por esforco de raciocinio — mas antes de
gastar, instrumentar.

#### O numero que decide tudo: receita por tick
`$29 / 200 ticks = **$0,145 por tick**`. Quick = 1 tick = $0,145. Deep = 3 ticks
= **$0,435**. Toda decisao de modelo se resolve contra esses dois numeros.

**Por que o `terra` foi recusado, em uma linha:** o teto de custo de um deep no
`terra` (~$0,53, com a saida saturando os 32k tokens) **passa da receita de um
deep** ($0,435). O `terra` TEM cenario matematicamente perdedor. O `luna`
(teto ~$0,21) nao tem. Isso esta travado por teste
(`model-cost.spec.ts` → "o TETO do luna cabe na receita de um deep; o do terra NAO").

**Por que os 200 ticks NAO devem ser cortados** (perguntado pelo dono em 31/08):
os pacotes avulsos em USD sao 20/$3,99 · 50/$9,99 · 150/$25,99 → **$0,17 a $0,20
por tick**. A assinatura a $0,145 e 16% mais barata que o maior pacote. Cortar
para 150 ticks daria **$0,193/tick — MAIS CARO que o avulso**, recriando
exatamente o bug de 27/07 ("assinar era o pior negocio da loja") que motivou o
plano unico. **Piso: ~180 ticks.** A alavanca certa nao e o numero de ticks, e
sim a razao do deep (3 ticks) e o teto de rollover.

#### 🆕 `model-cost.ts` — o custo real, sempre logado
O `usage` da OpenAI **ja chegava em toda resposta e era jogado fora**, exceto
com `AI_DEBUG_DUMP_RAW` gravando em arquivo local (inutil no Render, disco
efemero). O campo que importa e `completion_tokens_details.reasoning_tokens`:
nos GPT-5 e o gasto INVISIVEL de raciocinio, **cobrado como saida**, e e a
unica variavel que separa "usuario custa $5" de "custa $9".

Agora toda analise emite, sem flag nenhuma:
```
[Cost] deep model=gpt-5.6-luna prompt=20000 completion=10000 reasoning=7500 \
       cost=$0.0800 revenue=$0.4350 margin=81.6%
```
- **Grep `[Cost]` no log do Render** = custo real por tipo e por modelo.
- `⚠️ CUSTO ACIMA DA RECEITA` aparece se custo > receita. **Nunca deveria
  aparecer com `luna`** — se aparecer, e incidente, nao curiosidade.
- **Armadilha travada por teste:** `reasoning_tokens` JA ESTA DENTRO de
  `completion_tokens`. Somar por fora conta em dobro e inflaria o custo
  justo no modelo onde a margem e mais apertada. NAO "corrija" isso.
- Preco de modelo mora SO no `PRICING` do `model-cost.ts`. Modelo fora da
  tabela devolve `costUsd: null` em vez de inventar preco.
- Tudo dentro de try/catch: **instrumentacao nunca derruba a analise que ela
  esta medindo.**

#### 🆕 `reasoning_effort` — o controle de custo que nao existia
`AI_REASONING_EFFORT_QUICK` / `AI_REASONING_EFFORT_DEEP`
(`minimal|low|medium|high`), resolvidos por `resolveReasoningEffort()` em
`openai-params.ts` e aplicados nos DOIS call sites do adapter.

- **Nenhuma setada = `undefined` = padrao da OpenAI = comportamento de hoje.**
  Nada muda em producao ate alguem decidir que muda.
- **Valor invalido e IGNORADO, nao repassado.** Um typo no painel do Render
  derrubaria 100% das analises com 400 — falha total por digitacao nao e modo
  de falha aceitavel para uma variavel de ajuste fino. Travado por teste.
- So vai para GPT-5+; mandar para a familia 4o da 400 (mesma logica ja usada
  para `temperature`/`seed`).
- ⚠️ **Troca velocidade por profundidade.** Esforco alto pode estourar o
  `ANALYZE_TIMEOUT_MS` (default 55s) e virar **ERRO, nao espera**. Subir o
  esforco sem subir o timeout junto e trocar qualidade por falha.
- `/health` passou a reportar `reasoningEffortQuick`/`reasoningEffortDeep`.

#### PENDENTE DO DONO — passo 3, o unico que gasta (~$0,30)
1. No Render: `AI_MODEL_DEEP=gpt-5.6-luna` + `AI_REASONING_EFFORT_DEEP=medium`
   (**medium, nao high** — ja diferencia do quick e custa bem menos).
2. Rodar **3 analises deep** pelo painel.
3. `grep '[Cost]'` no log do Render e ler o `reasoning=` real.
4. Com o numero medido: decidir o teto de `maxTokens` (hoje 32k) que trava o
   custo dentro do orcamento de ~$9/usuario, e decidir se o deep continua a 3
   ticks ou vai para 4. **Atualizar esta secao com o valor medido.**

Piso de seguranca do `maxTokens`: abaixo de ~16k o veredito comeca a se perder
(medido em 29/07 — a resposta trunca e o BUY vira WAIT na tela, porque
`recommendation` e gerado por ULTIMO desde a reordenacao do schema).

**Verificacao desta parte:** backend `tsc --noEmit` 0 erros · **jest 162/162**
(20 suites, 12 testes novos em `model-cost.spec.ts`) · frontend `tsc -b` 0 erros.

### 31/08 — parte 3: o custo do raciocinio, MEDIDO (o passo 3 saiu)

Rodado localmente pelo Claude com o `backtest-runner` (450 graficos de amostra
ja existem em `scripts/backtest/charts/`, e o runner cai no fallback do prompt
de arquivo quando o banco nao responde — **nao precisa de Render, nem de deploy,
nem de painel**). 6 analises reais, ~US$ 0,18 do saldo do dono.

Comando (a chave estava no `.env` local; ela nunca sai do terminal do dono):
```
cd apps/backend && AI_MODEL=gpt-5.6-luna AI_REASONING_EFFORT_QUICK=medium \
  ./node_modules/.bin/ts-node --transpile-only scripts/backtest-runner.ts \
  --limit 3 --yes --out custo-luna-medium.jsonl
```

| | `medium` | `high` |
|---|---|---|
| completaram | **3 de 3** | **1 de 3** ⚠️ |
| tempo/analise | ~26s | varios minutos |
| tokens de raciocinio | 346 · 1.024 · 1.255 (**~875**) | **4.096** |
| custo/analise | **$0,0275** | $0,0465 |
| margem no quick (1 tick) | **~81%** | 67,9% |

#### 🔴 `high` e INUTILIZAVEL — nao e questao de custo, e de falha
**2 de 3 analises morreram com `openai_request_failed`** (estouro do
`ANALYZE_TIMEOUT_MS`, default 55s). O aviso escrito na parte 2 ("esforco alto
vira ERRO, nao espera") esta agora MEDIDO. Nao usar `high` sem subir o timeout —
e mesmo assim o usuario esperaria minutos. **Use `medium`.**

#### ✅ O medo do raciocinio era infundado
A analise de custo da parte 2 trabalhava com cenarios de 5.000 a 30.000 tokens
de raciocinio. **O real no `medium` e ~875** — 6 a 30 vezes menor. A tabela de
"pior caso" daquela secao continua valida como TETO matematico, mas nao descreve
nada parecido com a operacao real.

#### Custo por usuario que queima os 200 ticks — agora com numero medido
- **200 quicks × $0,0275 = $5,50** ← este e o caminho MAIS caro do plano
- 66 deeps × ~$0,038 (projetado: entrada maior com enriquecimento/HTF, mesma
  saida) = **~$2,51**

**Cabe no orcamento de $9/usuario do dono, e ate nos $6.** O quick custa mais que
o deep no total do plano, o que confirma que a razao de 3 ticks para o deep esta
generosa com a casa — **nao ha motivo para subir para 4 ticks.**

#### ⚠️ Correcao de um numero que estava errado no proprio CLAUDE.md
O quick no `luna` custa **~$0,028-0,032**, NAO os "~$0,024" que circulavam. A
medicao de 29/07 ja dizia "~$0,032"; a derivacao otimista de $0,024 estava
errada. Consequencia que ninguem tinha notado: **desde 11/08, quando o quick foi
para o `luna`, o custo por analise rapida subiu 2,4x** (era $0,013 no
`gpt-4o-mini`). Isso nunca entrou em nenhuma conta de margem.

Observacao de qualidade: as 3 analises do `medium` voltaram **WAIT** (conf 42-44)
— a abstencao sobrevive ao esforco de raciocinio.

#### PENDENTE DO DONO (agora e so uma decisao, nao uma medicao)
No Render: `AI_MODEL_DEEP=gpt-5.6-luna` + `AI_REASONING_EFFORT_DEEP=medium`.
Isso fecha o prazo do `gpt-4o` (23/10) sem comer margem. **Nao setar `high`.**
Falta so confirmar o custo do deep REAL depois (o runner so roda `quick`; a
projecao de $0,038 assume entrada maior e mesma saida).

### 31/08 — parte 4: timeout subido dos DOIS lados (estao acoplados)

O `medium` medido roda ~26s no quick; o deep e mais pesado e o default de 55s
fica apertado. Subir so o backend seria pior que nao subir:

**O modo de falha e traicoeiro.** O worker CONCLUI a analise e grava no
histórico, mas a tela ja desistiu e mostra erro. O usuario ve falha numa analise
que existe e que ele pagou — e o tick foi debitado.

- **Backend:** `AI_ANALYZE_TIMEOUT_MS=120000` (env no Render; o codigo ja aceita
  de 20s a 180s, default 55s — nao precisa de deploy).
- **Frontend (`lib/api.ts`, precisa de deploy):** `POLL_TIMEOUT_MS` 180s → 300s
  e `ANALYZE_TIMEOUT_MS` 120s → 150s. Os 180s originais eram dimensionados para
  `55 + 5 + 55 + 30 + 55`; com 120s no backend eles nao cobririam nem duas
  tentativas.

⚠️ **REGRA: nunca mexa em um sem o outro.** O comentario no `api.ts` diz isso.

### 🔴 `RESEND_API_KEY` NAO EXISTE no Render (achado em 31/08)

Lista completa do Environment conferida com o dono: existe `MAIL_FROM`, **nao
existe `RESEND_API_KEY`** — e `mail.service.ts:10` le exatamente esse nome.
Sem ela o servico loga "RESEND_API_KEY ausente — pulando envio" e **nao manda
nada**.

**Isto CORRIGE o registro de 20-21/07 deste arquivo, que afirma que a chave
estava configurada no Render. Nao esta.**

Consequencia: mesmo depois do conserto de 17/08 (a rota orfa do `auth/me`, que
fazia `User.email` ficar NULL), **nenhum e-mail sai**. Consertou-se o
destinatario e o envio segue morto por falta de chave. Vale para o de
boas-vindas E para o de recuperacao — este ultimo e a unica peca de ativacao de
quem esgotou as 3 analises gratis.

Falha 100% silenciosa: nada quebra, o app funciona, ninguem recebe e-mail.
**PENDENTE DO DONO:** pegar a chave em resend.com/api-keys e colar no Render.

**Licao (a terceira vez que isto morde):** o CLAUDE.md afirmava um estado de
ambiente que nao era verdade. Estado de env so vale se foi LIDO do painel, nunca
"lembrado" de uma sprint anterior. As duas vezes anteriores foram a
`CLERK_SECRET_KEY` (suspeita infundada) e o `ENABLE_QUICK_GROUNDING` (falso
alarme). Agora foi o contrario: o arquivo dizia que estava e nao estava.

### 31/08 — parte 5: espelho do calendario, e a URL morta que ninguem tinha visto

#### 🔴 `ff_calendar_nextweek.json` responde 404 — e estava no codigo
Medido em 31/08 (junto com `lastweek`, tambem 404): **so `thisweek` existe.** O
`FF_URLS` pedia as duas a cada ciclo, e a segunda nunca funcionou. Nao era a
causa do `degraded` (sucesso parcial ja contava como sucesso), mas significa que
**nunca houve duas semanas de dados**, ao contrario do que o array sugeria — e o
log ganhava um aviso perpetuo. URL removida. A janela real do produto e de 2h
(guard) a 24h (UI); uma semana sobra.

#### ⚠️ CORRECAO (31/08, pos-deploy): NAO era bloqueio permanente de IP

O paragrafo abaixo afirmava "bloqueio por IP de saida do datacenter, nenhuma
mudanca no calendar.service.ts conserta". **Isso esta ERRADO e fica registrado
como erro de diagnostico.**

Medido depois do deploy: `GET /api/calendar/events?symbol=EURUSD&hours=168`
devolve **11 eventos, `degraded: false`** — e isso ainda com o codigo ANTIGO, sem
o espelho. O que destravou foi o **restart do Render**, disparado ao salvar as
variaveis de ambiente.

A evidencia original era real (falha em 25/08 e de novo na manha de 31/08), mas a
conclusao de permanencia nao se sustenta. Hipotese nova, mais provavel: **conexao
ou DNS presos no processo**, que o restart limpa. Nao bloqueio de origem.

**Consequencia pratica se isto voltar a acontecer: REINICIE O SERVICO no Render
antes de investigar qualquer outra coisa.** E o teste de 30 segundos que teria
economizado esta sprint inteira.

O espelho NAO vira lixo com isso — vira seguro em vez de conserto. Custa um
workflow de 6h, so entra se a fonte direta falhar inteira, e protege contra a
recorrencia de uma falha que ja aconteceu duas vezes. Mas **nao era necessario**,
e a urgencia registrada abaixo estava inflada.

#### ✅ Espelho proprio (`.github/workflows/calendar-mirror.yml`)
O bloqueio e por **IP de saida do datacenter**, nao por header nem pela fonte —
medido em 31/08: a mesma URL responde 200/JSON valido/15KB de uma maquina comum,
e o User-Agent nao e o gatilho (testado com o do codigo, `Mozilla/5.0`, e com um
honesto: os dois passam). **Nenhuma mudanca no `calendar.service.ts` conserta
isso.**

Solucao com a infra que ja existe: workflow de 6 em 6h baixa o feed e commita em
`apps/frontend/public/calendar/thisweek.json`, servido estaticamente pela Vercel
(mesmo mecanismo do `/blog/` e do `/tools/`). O backend passa a ter fallback.

- **Ordem: direto SEMPRE primeiro**, espelho so se a fonte direta falhar
  INTEIRA. Nunca misturar as duas — as semanas se repetiriam e o mesmo evento
  entraria duas vezes na janela do guard.
- O workflow **valida com `jq` que a resposta e um array** antes de gravar. Sem
  isso ele publicaria a challenge page (que vem com status 200) por cima de dado
  bom — **pior que nao atualizar**, porque o backend leria "sem eventos" como
  confirmado. Mesmo raciocinio do `degraded`.
- Commita **so se mudou**, com `[skip ci]`. Falha de download mantem a copia
  anterior.
- `fetchFromUrls()` extraido; os tres modos de falha (HTTP nao-ok / corpo
  nao-JSON / erro de rede) seguem logados separados, agora com a origem
  (`[direto]` / `[espelho]`).
- **O espelho ja foi populado a mao** (112 eventos, 15 de alto impacto) para
  funcionar no primeiro deploy em vez de esperar o primeiro cron.

#### ❌ Teto de rollover: DECIDIDO NAO FAZER (corrige a nota de 27/07 e a parte 2)
Este arquivo registrava o rollover como "a unica exposicao sem teto". **A conta,
com os custos MEDIDOS, desmente.** Um tick custa no maximo 19% da receita dele
($0,0275 de custo no quick contra $0,145 de receita; no deep e 9%).

Cenario extremo (assina 12 meses, acumula tudo, queima de uma vez):
| | receita | custo | margem |
|---|---|---|---|
| 2.400 ticks em quick | $348 | $66 | **81%** |
| 2.400 ticks em deep | $348 | $30 | **91%** |

O motivo: **cada 200 ticks ja veio com $29 de receita.** Acumular nao cria custo
sem receita — adia um custo ja pago. Era risco real com `terra`/`sol` (deep a
$0,39); com `luna`, nao e.

E o outro lado: capar tornaria **falso** o "Ticks never expire", que esta vivo em
**3 lugares × 6 idiomas** (`topup`, `secure`, `neverExpire`). Seria construir
algo desnecessario que quebraria um claim publicado.

**So reabrir se o custo por tick passar de ~$0,07** (metade da receita) — o que
exigiria trocar para um modelo bem mais caro que o `luna`.

**Verificacao desta parte:** backend `tsc --noEmit` 0 erros · **jest 162/162** ·
YAML do workflow validado.

### ✅ Verificacao em PRODUCAO — 31/08, pos-deploy do commit `0787cf1`

Testado ao vivo, nao deduzido. (Nota de processo: os 5 commits ficaram parados
sem `git push` por um bom tempo; `git rev-list --count origin/main..main` e o
jeito rapido de flagrar isso sem criar `.git/index.lock`.)

| verificacao | resultado |
|---|---|
| `/llms.txt` | 113 linhas, texto real (nao a casca da SPA) |
| `/calendar/thisweek.json` | JSON valido, 112 eventos, 15 de alto impacto |
| copy `f3d` nova (1.2:1) no bundle | presente em EN, PT e JA |
| copy `f3d` antiga (`eliminatory 1.5:1`) | **ausente** |
| copy `f1d` antiga (`probability in seconds`) | **ausente** |
| 8 rotas pre-renderizadas (`/`, `/pricing`, `/accuracy`, `/try`, `/for/`, `/for/gold/`, `/blog/`, `/tools/`) | titulos proprios, sem regressao |
| `noindex` em `/sign-in` e `/sign-up` | `noindex,nofollow` |
| `sitemap.xml` | 25 URLs · `robots.txt` 200 |
| `/api/calendar/events` | 11 eventos, `degraded: false` |
| `/api/ai/accuracy` | n=112, 40,2% (IC 31,6-49,4) |
| `/api/ai/public-analyses` | 6 analises, simbolos normalizados (XAUUSD, GER40) |

**Env conferido no painel:** `AI_MODEL_DEEP=gpt-5.6-luna` ✅ (o prazo de 23/10
esta resolvido) e `AI_ANALYZE_TIMEOUT_MS` setada.
`AI_REASONING_EFFORT_DEEP` ainda NAO — e opcional, e so vale a pena depois de
medir o custo do deep real.

**NAO verificado (fora do alcance do Claude):** a linha `[Cost]` no log do
Render, que exige rodar uma analise deep logado e ler o painel. **Esse e o unico
passo que falta para fechar a conta de custo do deep** — hoje os ~$0,038 sao
projecao, nao medicao.

## Sprint 31/08 — parte 6: a vitrine parou de exigir que voce ja tenha uma leitura

**O problema, achado ao reler a landing:** a copy vendia o produto como validador
de uma tese que o usuario ja teria. `hero.subtitle` dizia "a second opinion that
confirms or kills your read", `how.s1d` pedia "a screenshot of your setup", e as
6 paginas `/for/` abriam o CTA com "You already have the chart open".

**Isso e uma condicao de entrada FALSA.** Verificado no
`common/prompts/trading-system-prompt.ts` (v7.3, o que roda em producao): zero
ocorrencias de "your setup" ou "already have". O motor le a imagem do zero e nao
assume nada. Quem abre um grafico sem tese lia a home e concluia que o produto
nao era para ele. Cliente perdido por uma frase, nao pelo produto.

**Enquadramento novo:** a IA le frio. Cole qualquer grafico, desenhado ou em
branco. A frase que resolve, no passo 3 do "como funciona":
"Arrive with a thesis and it is a second opinion. Arrive with none and it is the
first one."

### ⚠️ "second opinion" NAO foi removido, e isso e deliberado
A expressao continua na vitrine e nas paginas `/for/`. Ela e keyword de SEO viva
(existe um post inteiro em `/blog/trading-second-opinion/`) e continua sendo
verdade. O que era falso e o **pre-requisito**: "on a setup you already have".
**Se uma auditoria futura marcar "second opinion" como inconsistencia, e falso
positivo.** Cruze com esta secao.

### O que mudou
- `landing.hero.subtitle`, `landing.how.{title,highlight,subtitle,s1d,s3t,s3d}` e
  `landing.cta.{title,highlight,subtitle}` nos **6 idiomas**, mesmo commit.
- Meta description da home em 5 lugares: `index.html` (meta, og, twitter e o
  campo do JSON-LD) e `src/lib/seo-routes.json`. **Duas variantes**: a do JSON-LD
  termina com "The final call is yours" e as outras tres com "3 free analyses, no
  card". Substituicao cega quebraria uma.
- As 6 paginas `public/for/`: o CTA final nas seis, a resposta de "is this a
  signal service?" em `for/` e `for/forex/` (nas DUAS copias, texto visivel e
  `FAQPage`), e a meta e o passo numerado do `for/tradingview/`.
- `public/blog/index.html` e `public/llms.txt`, que de quebra tinham travessao.

### O que NAO mudou, de proposito
- **`landing.features` inteiro.** Reli os seis cards: nenhum afirma o
  pre-requisito. `f1d` diz "before you enter", que e momento e nao condicao.
  Mudar sem motivo abre superficie de claim novo em 6 idiomas sem ganho.
- Os 6 posts do blog e o `/blog/trading-second-opinion/`. Conteudo longo
  recem-indexado, e a tese do post continua valida.
- "The final call is always yours", o WAIT explicito, o link para `/accuracy`.
- **Os 6 posts em `public/blog/<slug>/` seguem com o enquadramento velho**, e isso
  e divida NOMEADA, nao esquecimento: `tickrify-vs-tradingview` ("You already
  have the chart open"), `ai-chart-analysis`, `best-ai-chart-analysis-tools` e
  `trading-second-opinion`. Ficaram de fora porque sao conteudo longo
  recem-indexado. **Auditoria futura que reportar isso esta certa, mas a decisao
  foi deliberada.**
- **⚠️ O prompt v9 ainda carrega o enquadramento ABANDONADO.**
  `trading-system-prompt-v9.ts` instrui o modelo a ser "a second opinion that
  confirms or kills the user's read". Hoje e inofensivo porque
  `AB_PROMPT_V9_PERCENT` esta em 0. **No dia em que o A/B for ligado, o motor
  passa a operar com o enquadramento que a vitrine acabou de abandonar.**
  Corrigir o v9 ANTES de ligar o A/B, nao depois.

### 🔎 Achado de i18n: o `hero.subtitle` ja estava divergido HA MESES
Os 5 idiomas nao-ingleses NAO tinham a frase da segunda opiniao. Eles carregavam
uma versao anterior ("Seu copiloto de trading: le o grafico, calcula o risco e
estrutura a decisao"). Nao era claim falso, era atraso: o ingles avancou e os
outros ficaram. Os 6 estao alinhados agora.

Isto e a terceira vez que divergencia de i18n aparece (as anteriores: o numero de
abstencao em es/de/ja em 10/08, e as 84 strings mortas dos 3 tiers). **O
`tsc -b` pega chave AUSENTE e nao pega traducao DESATUALIZADA.** So conferencia
manual chave a chave pega. Nao existe portao automatico para isto hoje.

Tambem corrigido de passagem: `ja.ts` tinha virgula dupla ("、、") no
`how.subtitle`, erro tipografico que sumiu com a reescrita da linha.

### Verificacao
`tsc -b` do frontend com 0 erros. `vitest` e `vite build` nao rodam no sandbox
(limitacao de VM ja registrada). Varredura por `grep` do padrao "your read|your setup|already
have" em `src/lib/i18n`, `seo-routes.json`, `index.html`, `public/for`,
`public/llms.txt` e `public/blog/index.html`. Ela devolve TRES linhas, e as tres
sao legitimas: `en.ts:371` ("We already have your reports", outra feature, fora
do bloco landing), `llms.txt:6` (texto novo, numa frase que NEGA o
pre-requisito) e `for/tradingview/index.html:101` (texto novo, que diz que
desenhar e opcional). **O padrao e mais largo que o alvo, entao saida vazia NAO
e o resultado esperado.** Quem repetir esta varredura no futuro deve conferir o
contexto de cada linha, nao contar linhas. JSON-LD das 3 paginas editadas reparseado com `node`.

**O padrao de varredura usado nesta sprint era ESTREITO DEMAIS.** Ele nao pegou
`for/bitcoin/index.html`, que dizia "a setup you **brought**" nas duas copias
(texto visivel e `FAQPage`). Achado so na revisao final, por leitura. Quem
repetir esta checagem deve buscar tambem `setup you brought`, `second read on` e
`confirms or kills`, e mesmo assim ler as paginas, porque o pre-requisito pode
ser reescrito de infinitas formas e nenhum grep cobre todas.

### Contexto que nao pode ser esquecido
**Isto nao e hipotese de conversao e nao vai ser medido.** So 4 pessoas na vida
completaram uma analise gratis; com n=4, medir "melhora" e ruido. A mudanca foi
feita porque a frase era FALSA, mesmo criterio da auditoria de 27/07. O gargalo
continua sendo trafego.

---

## Sprint 01/09/2026 — card de compartilhamento da analise

**Pedido do dono:** toda analise com um "compartilhar", para postar no X e no
Reddit. Referencia visual: o card de posicao da fomo.family (print de +$1,1M de
lucro). **O pedido veio ja corrigido pelo proprio dono:** "pode ser igual o da
fomo, mas mais como explicacao, nao como lucro". Esse detalhe define tudo.

### O que foi entregue
`components/dashboard/ShareCard.tsx` (arquivo novo, justificativa no cabecalho
dele): botao **Share** no cabecalho de TODA analise nao-demo. Gera um PNG
1200x675 (@2x) com Canvas 2D nativo, abre um dialog com previa e quatro acoes —
**Post on X** (copia a imagem e abre o compositor com o texto pronto),
**Copy image**, **Download** e **More** (menu nativo do sistema, so onde
`navigator.canShare({files})` existe; no celular e ele que abre Instagram,
WhatsApp e Telegram).

### As tres decisoes de PRODUTO que nao podem ser desfeitas sem pensar
1. **O card NAO mostra entry, stop nem alvo.** Post com nivel de preco aberto le
   como SINAL, e o posicionamento ("segunda opiniao, nao sinal") custou duas
   sprints de auditoria de claim. O card mostra simbolo, timeframe, veredito,
   chip Read/Signal, confianca e **a leitura em prosa** — o porque.
2. **WAIT/HOLD ganha card igual aos outros.** ~39% das analises sao WAIT, e "a
   IA mandou NAO operar, e aqui esta o porque" e o unico conteudo desta
   categoria que nenhum concorrente publica. Esconder o WAIT transformaria isto
   em maquina de print de sinal — o produto passaria a mentir por omissao.
3. **O texto pre-preenchido do post e SEMPRE ingles e nao cita performance.**
   Texto publico que a pessoa posta sem reler e o lugar mais provavel de uma
   alegacao nao verificavel voltar a existir. Ele descreve o que a IA leu e
   linka a `/accuracy` com UTM (`utm_source=x&utm_campaign=share_card`).

### Decisoes tecnicas
- **Zero dependencia nova** (`html2canvas`/`satori` fariam em menos linhas, mas o
  lockfile nao atualiza na maquina do dono). Canvas 2D puro.
- **O grafico do usuario NAO entra no card.** `Analysis.imageUrl` e opcional e o
  backend parou de salvar a imagem para economizar espaco — um card com print
  funcionaria na hora da analise e quebraria ao recompartilhar pelo historico.
- **Zero backend, zero migracao, zero rota nova.** Tudo acontece no navegador.
- `document.fonts.ready` antes de desenhar: sem isso o Canvas usa a fonte de
  fallback se a Geist ainda nao chegou, e o card sai fora da identidade **sem
  erro nenhum**.
- Espacamento entre letras e feito caractere a caractere: `ctx.letterSpacing`
  nao existe no Firefox e e ignorado em silencio.
- A copia para o clipboard acontece ANTES do `window.open` do X. Depois dele o
  documento perde o foco e o navegador recusa a escrita no clipboard.
- O bloco de texto e **centralizado verticalmente** entre cabecalho e rodape,
  com a altura medida antes de desenhar. Com `y` fixo, leitura curta deixava
  ~180px de vazio no pe e o post parecia inacabado.
- Evento novo no funil: **`analysis_shared`**, com `step` =
  `opened | copied | downloaded | x_opened | native_shared`. Sem o `step` nao da
  para distinguir "gerou o card" de "postou", que e a falha mais provavel.
- i18n do BOTAO nos 6 idiomas (`analysis.share.*`). O texto DENTRO da imagem e
  so ingles, de proposito: a imagem e artefato publico (mesma regra do site) e
  vitrine em 6 idiomas ja produziu claim falso tres vezes neste projeto.

### Como isto foi verificado (nao foi "parece certo")
`vitest` e `vite build` continuam sem rodar no VM do sandbox (limitacao ja
registrada). Entao: o codigo de desenho REAL foi extraido do `ShareCard.tsx`,
transpilado com esbuild e executado num **Chromium headless com as fontes Geist
de verdade**, e os PNGs resultantes foram olhados um a um em 7 cenarios —
BUY/SIGNAL, SELL/READ, WAIT com "what would change it", simbolo longo demais,
leitura longa demais (confirma as reticencias), leitura curta e analise vazia.
Foi assim que o vazio no pe do card apareceu. `tsc -b` do frontend com 0 erros e
`eslint` sem erro nos arquivos tocados (so os avisos de `react-refresh` que a
pasta inteira ja tem).

`__tests__/share-card.test.ts` trava as duas coisas que falham em SILENCIO:
`wrapText` (texto que nao cabe e desenhado para fora da imagem e some, sem
erro) e `buildShareText` (assercoes de que o texto do post nunca contem
`entry`/`stop`/`target`/`$` nem `win rate`/`profit`/`guarantee`).

### O que ficou FORA, e por que
- **Link publico por analise (`/s/:token`)**: exigiria coluna nova, endpoint
  publico e rota nova — e o preview do link no X sairia generico de qualquer
  forma, porque o `prerender.mjs` roda no build e nao gera `og:image` por
  analise. Imagem circula melhor que link em rede social; o card resolve o
  pedido inteiro sem tocar no backend.
- **Publicacao automatica no X**: exige conta de desenvolvedor, OAuth, chaves no
  Render e um job. E o unico item que depende de aprovacao de terceiro e, com
  trafego ~0, o de pior retorno por hora. Decisao do dono: depois.

### Correcao 02/09/2026 — primeiro card real revelou dois defeitos
O card foi ao ar e o PRIMEIRO gerado de verdade (XAUUSD 5m, HOLD 42%) mostrou o
que 7 cenarios sinteticos nao mostraram:

1. **Teto de 4 linhas cortava a leitura com espaco sobrando.** O corte caiu em
   "Do not chase…" — comeu justo a parte acionavel, com ~90px de vazio abaixo.
   Agora o numero de linhas e DERIVADO do espaco (`AREA_HEIGHT`, `LABEL_H`,
   `READ_LH`): 6 linhas quando nao ha flip. O mesmo texto passou a caber
   inteiro. **As constantes de altura sao usadas tanto para MEDIR o bloco
   quanto para avancar o `y` ao desenhar** — se alguem mudar uma sem a outra, o
   texto passa por cima do rodape sem erro nenhum.
2. **A imagem dizia HOLD e o texto do tweet dizia "said WAIT", no mesmo post.**
   Agora existe `publicVerdict()`, usada pelo desenho E pelo `buildShareText`:
   uma funcao so, divergencia impossivel de voltar. Teste trava que a palavra
   HOLD nunca sai no texto publico.

**Prioridade quando os dois blocos disputam espaco:** a leitura ganha sempre. O
"what would change it" entra com o que sobrou e SO se couberem as duas linhas
dele — flip de uma linha sai truncado no meio da condicao, pior que nao ter.

### Achado de claim que o dono precisa saber (nao resolvido, decisao consciente)
O card nao tem campo de entry/stop/alvo, como projetado. **Mas a prosa da IA
carrega niveis de preco** ("4.602,00-4.610,00", "4.586,38") — o modelo escreve
os numeros dentro da leitura. A regra "sem nivel de preco" vale para a
ESTRUTURA do card, nao para o texto do motor. Discutido com o dono em 02/09:
filtrar numeros da prosa deixaria a leitura generica, e a diferenca entre "a IA
viu um OB nessa regiao" e uma tabela de operacao continua real. **Mantido como
esta, de propOsito.** Quem revisitar isto nao deve tratar como bug esquecido.

### Nota de operacao: o bundle no ar so se confere com grep completo
O botao "sumiu" em producao e foram tres rodadas ate achar que era **cache do
navegador** (`Cmd+Shift+R` resolveu). Duas armadilhas no diagnostico, para nao
repetir:
- `WebFetch` num bundle de 1,4MB le so ~185KB e responde "ABSENT" para TUDO,
  inclusive para a palavra `tickrify`. **Conclusao tirada dali e falsa.** Sempre
  rodar uma string de controle antes de acreditar no resultado.
- O jeito confiavel, do terminal do dono:
  `curl -s "https://tickrify.com/assets/$(curl -s https://tickrify.com | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)" | grep -c "<string>"`

### 02/09/2026 — link publico por analise: PROPOSTO E RECUSADO pelo dono
O dono pediu "igual a fomo: a imagem aparece no X e clicar leva pro site".
Descoberta importante: **a fomo NAO envia imagem para o X.** O que aparece na
timeline e a PREVIA DO LINK (`og:image`), por isso clicar volta pro site deles.
Uma coisa so, nao duas — e nao exige a API do X nem OAuth.

Caminho levantado (nao construido): coluna de token publico + PNG do card
subindo pelo `ImageStorageClient` (Supabase Storage, ja existe) + funcao
serverless no **Vercel** servindo `/s/:token` com as tags og/twitter + pagina
publica. A funcao TEM que ser no Vercel, nao no Render: o free do Render
hiberna, e o crawler do X desiste no cold start — a previa nao aparece e nao ha
erro nenhum para ver.

**O dono decidiu NAO fazer:** quer so o card, sem tocar no backend. Quem
revisitar isto nao deve tratar como pendencia esquecida — foi escolha, com o
caminho ja mapeado acima caso mude de ideia.

**Consequencia aceita:** no DESKTOP o fluxo continua sendo copiar + colar
(Cmd+V) no compositor do X; nenhuma rede social aceita imagem por URL de
intent. No CELULAR o botao "More" (`navigator.share({files})`) ja abre o app do
X com a imagem ANEXADA, sem colar nada — esse caminho ja funciona hoje e e o
mais parecido com o que o dono pediu.

## Sprint 31/08 — parte 7: perfil de estrategia (recurso pago)

O assinante declara a estrategia dele uma vez, em campos FECHADOS, e toda
analise volta com um selo `ideal|good|poor|conflict` dizendo se aquele setup e
do tipo que ele opera.

### As duas travas, e por que elas existem

**TRAVA 1 — a estrategia FILTRA, nunca CRIA.** Tres defesas, nao uma:
1. **Ordem do `json_schema`.** Em structured outputs a ordem das chaves E a
   ordem de geracao. `strategyFit` entra DEPOIS de `recommendation` e
   `confidence`, entao quando o modelo chega nele o veredito ja esta escrito.
   Mesma mecanica da correcao de 29/07. **Mover o campo para cima desfaz a
   trava sem quebrar nenhum teste de tipo** — por isso existe um teste que le o
   fonte e confere a ordem.
2. **`recommendation` nunca muda por causa do selo.** Nem no backend nem na
   tela. WAIT continua WAIT.
3. **A regra vai escrita dentro do prompt.** As defesas estruturais impedem o
   modelo de reordenar, nao de racionalizar.

**Limite honesto:** numa chamada so, o texto da estrategia esta no contexto
durante a leitura inteira. A ordenacao garante que o modelo ESCREVE a decisao
antes, nao que nao foi influenciado ao forma-la. Isolamento real exigiria duas
chamadas, que dobram custo e latencia. **O sinal de que isso virou problema e a
abstencao de quem tem perfil cair em relacao a de quem nao tem** — o
`strategyHash` permite medir exatamente isso.

**TRAVA 2 — analise com estrategia fica FORA do que o site publica.** Coluna
`Analysis.strategyHash`, NULL quando nao houve estrategia. **Sao QUATRO queries
no `ai.controller.ts`, nao tres:** a esteira da landing (234), os outcomes do
sweeper (294), a contagem de WAIT (333) e o total (336). A quarta quase passou
batido porque nao e estatistica, e vitrine, e a secao dela se chama "The latest
reads, unfiltered". `strategy-accuracy-guard.spec.ts` varre o fonte e quebra o
CI se alguma perder o filtro.

**⚠️ LIMITE DO GUARD, achado na revisao e que precisa estar escrito:** ele
identifica "query publica" pelo marcador textual `isDemo: false` e **so varre o
`ai.controller.ts`**. Uma query publica futura que filtre demo de outro jeito
(outro nome de flag, `NOT isDemo`, SQL cru) ou que viva em outro arquivo
**escapa da rede**. Ao criar rota publica nova, o filtro `strategyHash: null` e
responsabilidade de quem escreve; o guard cobre as quatro de hoje, nao o futuro.

Hash e nao booleano de proposito: booleano so permite excluir, hash permite
excluir E segmentar depois.

### Seguranca: zero texto livre, e isso nao e negociavel
O perfil e formulario de campos fechados. `sanitizeStrategyProfile` trabalha por
whitelist e descarta o que nao reconhece, inclusive chaves desconhecidas.
**Texto livre do usuario dentro do prompt do motor e injecao de prompt, e o alvo
mais valioso do ataque e a abstencao de 39,2% que sustenta a /accuracy.**
Sanitizacao e delimitador nao sao defesa completa contra um modelo. Campo
fechado e. Ha teste para o caso de ataque.

### 🔎 Achado: `/api/ai/analyze/stream` NAO TEM NENHUM CHAMADOR
O frontend so chama `/api/ai/analyze` (`lib/api.ts:402`). O caminho de streaming
e um pipeline de analise paralelo COMPLETO, que persiste analise, **sem
`json_schema` e sem grounding**, e o produto nunca o alcanca. A estrategia NAO
foi implementada nele de proposito: e codigo morto, e a trava de ordenacao nem
existiria la, porque ele parseia JSON de texto livre.

**Isto e divida nomeada.** Ou o caminho e removido, ou ele precisa ganhar
`json_schema` e grounding antes de qualquer uso. Hoje ele produziria analise
com qualidade diferente da do caminho principal, sem ninguem perceber.

### Colunas novas
`User.strategyProfile` (JSONB) e `Analysis.strategyHash` (TEXT). **Sem indice
em `strategyHash`, de proposito:** a coluna e NULL em quase 100% das linhas e as
quatro queries filtram por NULL, entao um indice comum nao acelera e so custaria
escrita. Se um dia houver volume, o indice certo e PARCIAL
(`WHERE "strategyHash" IS NOT NULL`). Nos DOIS lugares, migracao Prisma e
`ADD COLUMN IF NOT EXISTS` do `onModuleInit`, porque
`RUN_MIGRATIONS_ON_START=false` em producao. Mesmo cuidado que faltou na
`isDemo` e quebrou banco novo.

### 🔴 O bug que quase passou: o worker descartava o perfil em silêncio
A revisão da tarefa do adapter achou um Critical que o plano tinha deixado
passar. O `ai.service` sincrono propagava o `strategyProfile` corretamente,
mas **o `worker/ai.worker.ts` nao**: o tipo `JobData` declarava o campo, e o
`processAnalysis` nao o extraia do `job.data`, e o `resolveAiSource` chamava
`analyzeImage` com quatro argumentos em vez de cinco.

**Por que isso seria devastador e invisível:** `RUN_EMBEDDED_WORKER` e `true`
por padrao, entao **quase toda analise vai pela FILA**. O caminho sincrono, o
unico que funcionava, e o caminho morto em producao. O assinante pagaria, o
`strategyHash` seria gravado na analise, o bloco nunca entraria no prompt, o
`strategyFit` nunca seria gerado, e a analise dele ainda sairia da amostra
publica sem ter recebido tratamento nenhum diferente.

**Licao:** ao acrescentar um parametro ao `analyzeImage`, ha DOIS caminhos de
producao a alimentar, e o obvio e o errado. Existe agora um teste que exercita
a fila e asserta o quinto argumento; o teste estatico do schema passava 13 de
13 com o bug presente.

### ⚠️ Limite do `strategy-accuracy-guard`, que precisa estar escrito
Ele identifica "query publica" pelo marcador textual `isDemo: false` e **so
varre o `ai.controller.ts`**. Uma query publica futura que filtre demo de outro
jeito (outro nome de flag, `NOT isDemo`, SQL cru) ou que viva em outro arquivo
**escapa da rede**. Ao criar rota publica nova, por o `strategyHash: null` e
responsabilidade de quem escreve. O guard cobre as quatro de hoje, nao o futuro.

### Achados preexistentes levantados de passagem (nao corrigidos)
- **A barra de abas mobile do `DashboardPage` tem rotulos hardcoded em
  PORTUGUES e com EMOJI** (`▦ Painel`, `⊕ Analise`, `↺ Trades`,
  `☆ Watchlist`), num site cujo padrao e ingles desde jun/2026 e num projeto
  que proibe emoji na interface. O item novo do perfil entrou usando a chave de
  i18n e sem emoji, de proposito: o novo esta certo, os quatro vizinhos nao.
  Nao foram reescritos por serem fora de escopo.
- **`/blog/` e `/tools/` tem travessao no proprio `<title>`**, que e texto que
  aparece no resultado de busca do Google.

### 🔴 O bug que chegou ao usuario: DTO sem decorator com `forbidNonWhitelisted`

O salvar do perfil quebrava **100% das vezes** em producao, com
`["property timeframes should not exist", ...]` para todos os seis campos. A
tela montava, o backend estava correto, `tsc` e `jest` passavam.

**Causa:** o `ValidationPipe` global (`main.ts`) roda com `whitelist: true` E
`forbidNonWhitelisted: true`. Propriedade declarada sem decorator do
`class-validator` **nao existe para o pipe**, e ele rejeita a requisicao
inteira. O `SetStrategyDto` tinha os seis campos como propriedades TypeScript
puras. Os DTOs vizinhos (`set-outcome`, `set-favorite`) sempre usaram decorator;
so este nao usava.

**Por que nenhum portao pegou:** typecheck nao sabe de decorator de runtime, e
nao havia teste que exercitasse o pipe. Existe agora:
`set-strategy.dto.spec.ts` instancia o `ValidationPipe` com a MESMA config do
`main.ts` e passa um corpo igual ao que a tela envia. Provado em duas rodadas:
com o DTO antigo, dois testes falham; com o novo, os quatro passam.

**Regra que nasce disto:** DTO novo neste projeto precisa de decorator em TODO
campo, e de um teste contra o pipe real. Sem o decorator o campo e invisivel;
sem o teste, o unico lugar onde isso aparece e a requisicao de verdade.

**Achado de brinde:** com `forbidNonWhitelisted`, chave desconhecida nao e
descartada em silencio, e **rejeitada**. Isso e mais forte, e e a primeira
barreira contra alguem tentar enfiar instrucao no perfil por um campo que nao
existe no formulario. Esta travado por teste.

### 🔴 O KPI de analises do painel era um numero FALSO (03/09/2026)

Reportado pelo dono: "fiz seis analises e o painel continua em 38, e eu tenho
essa conta ha muito tempo".

**Causa:** `dashboardKpis.total` era `rawAnalyses.filter(completed).length`, e
`rawAnalyses` vem de `useAnalyses(40)`. O painel nao contava as analises da
conta, contava **quantas ele tinha carregado**. Analise nova entrava no topo da
lista de 40 e uma antiga saia embaixo, entao o numero ficava preso em 38-40 para
sempre. A conta do dono tem 403 analises e a tela exibia 38.

Agravante: o rotulo embaixo do numero diz **"all time"**. Era claim falso dentro
do produto, mesma familia dos que a auditoria de 27/07 removeu da vitrine.

**Correcao:** `getUsage` passou a devolver `analysesAllTime`, de um
`prisma.analysis.count({ where: { userId, status: 'completed' } })`. Escolhas:
- **`/usage` e nao `/performance`**: o painel JA chama o `/usage` pelo
  `useAnalysisLimit`, entao custa ZERO requisicao a mais. O `/performance` ainda
  faz `findMany take:1000` so para contar, o que e caro e continua tendo teto.
- **`count()` e nao lista**: nao carrega linha nenhuma e nao tem teto.
- **O contador local continua como fallback**, de proposito: o Render hiberna e
  a tela precisa mostrar algo enquanto o `/usage` nao responde. Ele so deixou de
  ser a fonte final.

Travado por teste em `ai.service.spec.ts`, que distingue as duas contagens do
metodo pela clausula e nao pela ordem da chamada, e assere a clausula exata.
Provado nas duas direcoes: com o numero preso, o teste falha.

### ⚠️ PENDENTE, achado junto e NAO corrigido: o historico esta cortado em 40
`listAnalyses` **nao tem paginacao**: sem cursor, sem offset, e o backend limita
a 100 (`Math.min(100, ...)`). O frontend pede 40. Consequencia: das 403 analises
da conta do dono, **363 nao sao alcancaveis por nenhuma tela**. Elas estao no
banco e contam para a /accuracy, mas o usuario nao consegue ver.

Isso e trabalho de verdade (endpoint, hook e tela), nao remendo, e ficou de fora
de proposito. O conserto do numero foi feito primeiro porque era claim falso; o
historico truncado e limitacao de produto, nao mentira.

### ✅ RESOLVIDO no mesmo dia: o historico cortado em 40 (03/09/2026)

Fecha a pendencia anotada na secao acima. `listAnalyses` ganhou **paginacao por
cursor**, e as 363 analises inalcancaveis passaram a ser alcancaveis.

**Cursor e nao offset, de proposito.** A lista e ordenada por data decrescente.
Com offset, uma analise nova entrando no topo empurra tudo para baixo e a pagina
seguinte passa a repetir ou pular linhas. O cursor e uma ancora por id e e imune
a isso, inclusive quando o usuario esta paginando e uma analise nova chega.

**`orderBy` levou `id` como desempate.** Duas analises podem compartilhar o
mesmo `createdAt`; sem o desempate a ordem nao e total e o cursor fica ambiguo
exatamente na fronteira entre paginas.

**O hook virou `useInfiniteQuery` mas continua devolvendo array ACHATADO.** Isso
e o que mantem o `DashboardPage` intocado: ele consome `analyses` como antes,
nunca chama `loadMore`, e por isso continua recebendo so a primeira pagina. Quem
quer o historico inteiro (`MyTrades`) usa `hasMore`/`loadMore`/`loadingMore`.

#### 🔴 O achado da revisao: cursor do cliente nao pode ir cru para o Prisma
A primeira versao mandava o cursor direto para o `findMany`. A query principal
filtra por `userId`, entao **conteudo alheio nunca vazava**, mas sobravam dois
problemas:
1. o Prisma localiza a linha do cursor **pelo id, antes de aplicar o `where`**.
   Um id de analise de outra conta respondia diferente de um id inexistente, o
   que e um oraculo de existencia entre contas;
2. id inexistente fazia o Prisma lancar, virando **500 cru** numa rota que
   deveria apenas dizer "acabou o historico".

Corrigido: o cursor so vira ancora depois de um `findFirst({ id, userId })`.
Cursor que nao e do usuario **encerra a paginacao devolvendo lista vazia**.
Devolver a primeira pagina seria pior, porque a tela concatena e o usuario veria
as mesmas analises duplicadas. Travado por teste, provado nas duas direcoes.

#### Limitacao conhecida e aceita
`hasMore` e calculado por "a pagina veio cheia". Se o historico for multiplo
exato do tamanho da pagina, o botao aparece uma vez a mais, o clique traz lista
vazia e ele some. E o comportamento padrao desse tipo de paginacao e nao vale a
complexidade de uma contagem extra por pagina para evitar um clique.

---

## Sprint 14/09/2026 — GEO/AEO: o corpo das paginas passou a existir sem JavaScript

**Por que isto virou prioridade 1 (dado de negocio, nao de SEO):** o maior canal
de aquisicao do produto e o **ChatGPT**. Em 30 dias, **368 de 1017 pageviews**
chegaram com `utm_source=chatgpt.com`, contra 24 do Google organico, 14 do
Instagram e 6 do Facebook. Pelo menos um dos 3 assinantes (Reino Unido, 08/09)
veio por ai. Nenhum assinante veio de anuncio pago. O canal que funciona e
organico, gratuito e ninguem tinha otimizado para ele.

### 🔴 O ACHADO: as rotas React serviam ZERO palavra em HTML cru

Medido no proprio codigo, nao deduzido. O `index.html` traz dentro do
`<div id="root">` apenas a barra do cabecalho com o logo, **sem texto nenhum**
(decisao correta de 25/08, ver aquela secao). O `prerender.mjs` consertava o
`<head>` e **so o head**. Resultado: `/`, `/pricing`, `/accuracy` e `/try`
entregavam zero palavra de conteudo para quem nao executa JavaScript.

**Nenhum crawler de IA executa JavaScript.** OAI-SearchBot, PerplexityBot e
ClaudeBot leem o HTML cru e vao embora. O **Googlebot executa JS**, e e por isso
que este problema sobreviveu a duas auditorias de SEO: pelos olhos do Google o
site estava certo. A `/accuracy`, que e o ativo mais raro do produto, era
literalmente invisivel para o canal que mais traz gente.

### A correcao: `scripts/geo-body.mjs` (arquivo novo, justificado)

O `prerender.mjs` ja passava de 200 linhas e o corpo e outro assunto (carrega
copy, busca API, monta HTML). Nao cabia la dentro.

**Onde o corpo e injetado: dentro de `<noscript>`, e isso e deliberado.**
Texto dentro do `#root` e pintado antes do React montar e some quando ele monta.
Este projeto ja pagou por isso: o `index.html` trazia o hero embutido, `/terms`
piscava "Stop trading in the dark", e em 25/08 a casca foi esvaziada por causa
disso. Repetir aquilo para agradar crawler seria trocar um bug por outro.
`<noscript>` nao tem esse custo: navegador com JS nunca renderiza (zero flash,
zero regressao visual) e todo crawler que le HTML cru le o conteudo.

**FONTE UNICA, que e o ponto inteiro.** Nada ali e copy escrita a mao:
- texto: carregado do **proprio `src/lib/i18n/en.ts`**, o mesmo arquivo que a
  tela renderiza;
- numeros da acuracia: buscados da **mesma API** que a `AccuracyPage` consome,
  no momento do build, e carimbados com a data (`Measured accuracy, as of ...`);
- preco do schema: extraido do bloco `offers` do **proprio `PricingPage.tsx`**.
  Mudou la e nao aqui, aqui **para de emitir o Offer** em vez de anunciar preco
  velho. O valor ja passou por tres edicoes ($12, $19, $29).

Divergencia entre uma segunda copia de texto e a tela ja aconteceu **tres vezes**
neste projeto (abstencao em es/de/ja, as 84 strings mortas dos 3 tiers, o hero da
casca). Copy escrita a mao aqui seria a quarta.

**Como o `en.ts` e lido sem dependencia nova:** ele e um objeto literal e nada
mais (`export default { ... } as const`, sem anotacao de tipo, sem import). Tirar
o `as const` deixa um modulo ES valido que o Node importa por data URL. O esbuild
(dependencia do Vite, resolvido por `createRequire`) fica como SEGUNDA tentativa,
para o dia em que alguem puser TypeScript de verdade no arquivo.
⚠️ **O binario do esbuild em `node_modules` e `darwin-arm64`**, entao ele NAO roda
no VM Linux que o Claude usa na maquina do dono. O caminho sem transpilador foi
escolhido justamente por poder ser verificado em qualquer maquina.

### Resultado medido (com a API mockada em localhost, fluxo real do script)

| rota | palavras em HTML cru, antes | depois |
|---|---|---|
| `/` | **0** | **876** |
| `/pricing` | 0 | 419 |
| `/try` | 0 | 320 |
| `/accuracy` | 0 | 380 |
| `/terms`, `/privacy`, `/cookies`, `/risk` | 0 | ~136 cada |
| `/sign-in`, `/sign-up`, `/admin` | 0 | **0, de proposito** (noindex nao ganha corpo) |

### 🔴 Bug pego no teste: rodar o script 2x contaminava todas as rotas

O `base` e lido uma vez e reusado. Na segunda execucao sobre o mesmo `dist`, o
`dist/index.html` ja voltava com o corpo da HOME dentro, e como a injecao era
idempotente por presenca, **toda rota filha herdava o texto da home**. Reproduzido:
a `/pricing` passou a servir `<h1>Stop trading in the dark.</h1>`. O Vercel builda
do zero e nunca cairia nisso; um build repetido na mao, sim.

Corrigido com `stripBody()` antes de escrever, ancorado no marcador
`<noscript data-prerender="body">` (so remove o que o script gerou, nunca um
`<noscript>` posto a mao). **Verificado estavel em 3 execucoes seguidas.**

### JSON-LD tambem so existia depois do JS

O `useJsonLd` injeta o schema na hidratacao, ou seja **nenhum crawler de IA viu
um bloco de structured data sequer** ate hoje. Agora o HTML cru ja traz:
`FAQPage` na home (que nao tinha schema em lugar nenhum), `SoftwareApplication` +
`Offer` na `/pricing` e `Dataset` na `/accuracy`.

⚠️ **`useJsonLd` passou a remover o elemento de mesmo id antes de inserir o dele.**
Sem essa linha a pagina teria dois elementos com o mesmo id e schema duplicado.
**Nao remover.** Os ids do pre-render batem de proposito com os das paginas
(`ld-pricing`, `ld-accuracy`).

### robots.txt: 15 crawlers de IA liberados por nome

`User-agent: *` ja liberava, mas regra nomeada e o sinal inequivoco. Entraram
OAI-SearchBot, ChatGPT-User, GPTBot, Google-Extended, PerplexityBot,
Perplexity-User, ClaudeBot, Claude-SearchBot, Claude-User, Bingbot, Applebot,
Applebot-Extended, Amazonbot, meta-externalagent e cohere-ai. Os comentarios
explicam que os agentes **nao sao intercambiaveis** (GPTBot e treino e nao gera
citacao; OAI-SearchBot e ChatGPT-User e que geram).

### Travessao removido do texto publico (regra do dono, estava sendo violada)
A meta description da home dizia "Try 3 analyses free — no card required" no
`seo-routes.json` E em 3 metas do `index.html`. Mais 4 no `llms.txt`. Todos
trocados. **Varredura do bloco gerado: 0 travessoes.**

### `llms.txt`
Ganhou `Last updated: 2026-09-14` e uma secao **"How to cite this product"**, que
e o que aumenta chance de citacao: nome, descricao de uma linha, o motivo unico
para citar (publica a propria acuracia com n e intervalo de confianca) e o pedido
explicito de linkar `/accuracy` quando a pergunta for sobre quanto AI chart
analysis funciona de verdade.

### Verificacao
`tsc -b --force` do frontend: **0 erros**. `eslint` nos 3 arquivos tocados:
limpo. Script rodado em ambiente isolado fora do repo (`/tmp/pretest`, com
symlink para o `node_modules`), 3 execucoes seguidas, HTML final reparseado com
`HTMLParser`, JSON-LD reparseado com `json.loads`. O caminho da API foi validado
ponta a ponta com um servidor mock em `127.0.0.1` (o VM do Claude nao tem rede),
confirmando a tabela de numeros e o `dateModified` no schema.

⚠️ **NAO foi possivel rodar `vite build`** (limitacao de VM ja registrada:
`MODULE_NOT_FOUND` no binario nativo do rollup). O `prerender.mjs` foi exercitado
contra um `dist/` montado a mao com o `index.html` real.

### PENDENTE desta frente (ordenado por retorno)
1. **Bing Webmaster Tools** (so o dono, exige login): cadastrar o site e enviar
   `https://tickrify.com/sitemap.xml`. O ChatGPT depende muito do indice do Bing,
   entao isto e o par obrigatorio do trabalho acima.
2. **Conferir em producao depois do deploy**, lendo HTML CRU e nao screenshot:
   `curl -s https://tickrify.com/ | grep -c "data-prerender"` deve dar 1.
3. Reescrever as paginas publicas no formato que LLM cita (pergunta no H1,
   resposta direta nos dois primeiros paragrafos, tabela comparativa). Isso mexe
   na UI e foi deixado separado de proposito.
4. Presenca em terceiros (Reddit, Product Hunt, AlternativeTo, G2, Capterra), que
   e de onde nasce a maioria das citacoes.
5. Dashboard no PostHog por `utm_source` e `$referring_domain` de IA. Nota tecnica:
   `$initial_utm_source` e `$initial_referring_domain` estao VAZIAS no projeto 473872.

### 🔴 14/09, commit a9ab59b: o backend subiu SEM COMPILAR

O commit foi feito com `git add -A` e levou junto trabalho de backend que estava
parado na arvore de outra sessao. Esse trabalho **nao type-checava**:

```
src/common/guards/global-auth.guard.ts(30,5): error TS2554: Expected 2 arguments, but got 1
src/modules/auth/auth.guard.spec.ts(29,13): error TS2554
src/modules/auth/__tests__/auth.guard.forged-token.spec.ts(29,13): error TS2554
```

O `AuthGuard` ganhou `MailService` como segundo parametro do construtor (para
disparar o e-mail de boas-vindas no ponto onde o usuario e de fato criado) e os
tres call sites nao foram atualizados. O `GlobalAuthGuard` **estende** o
AuthGuard, e herdar um guard significa herdar as dependencias dele.

**⚠️ CORRECAO (15/09, lido no painel do Render, nao inferido):** eu afirmei
aqui que "o build do Render falhou". **ESTAVA ERRADO.** A lista de deploys
mostra `a9ab59b` como **Deployed**, 28,8s, junto com todos os outros. O build
do Render **NAO barrou** o erro de tipo.

Ou seja, o oposto do que eu disse: o codigo que nao type-checa **FOI PARA
PRODUCAO** e rodou por cerca de 3 horas, ate o `75784f1` (tambem Deployed)
corrigir. Nao tentei reproduzir o comportamento do `nest build` aqui porque o
sandbox nao consegue apagar o `dist/` (EPERM) e o teste fica inconclusivo.

**O QUE ISSO SIGNIFICA PARA SEMPRE: o build do Render NAO e um portao de tipo.**
Este arquivo dizia "build do Render que falha nao derruba o app". A verdade e
pior: com erro de tipo ele nem falha. O unico portao real e o `pnpm check` na
raiz, rodado ANTES do commit. Nao existe rede de seguranca depois.

**Impacto do bug enquanto esteve no ar:** so o ramo de usuario NOVO.
`GlobalAuthGuard` chamava `super(prisma)` sem o `mail`, entao `this.mail` ficava
`undefined` e `this.mail.sendWelcome(...)` lancaria no cadastro de conta nova.
Usuario existente passava normal (nao toca nesse ramo). O trafego do periodo e
quase so health check, entao a chance de alguem ter sido afetado e baixa, **mas
isso NAO foi confirmado no banco** (escrever/ler no Supabase esta fora do que o
Claude alcanca). Se aparecer relato de cadastro que falhou na madrugada de
14 para 15/09, a causa e esta.

O Vercel nao foi afetado: o frontend compila, e o deploy do GEO saiu normalmente.

Dois problemas de teste que so apareceram ao rodar o jest, ambos corrigidos:
- o `auth.guard.spec.ts` ainda montava mock de `upsert`, e o guard tinha passado
  para **find-then-create**. O teste falhava com "prisma.user.findUnique is not
  a function", ou seja **estava falhando por motivo errado e nao cobria mais a
  trava que ele existe para cobrir** (o `role` vem do banco, nunca do token do
  Clerk, onde o proprio usuario consegue escrever via `unsafe_metadata`).
  Reescrito, e ganhou um segundo caso cobrindo a criacao de usuario novo.
- o mock do MailService precisa de `mockResolvedValue`, nao `jest.fn()` seco: o
  guard faz `void this.mail.sendWelcome(...).catch(...)` e um mock que devolve
  undefined derruba a autenticacao inteira no teste.

Depois do conserto: `tsc --noEmit` do backend com 0 erros, **jest 190/190**.

**Licao, e ja e a segunda vez:** `git add -A` num repo com trabalho de outra
sessao parado na arvore commita esse trabalho junto, sem ninguem ter rodado
portao nenhum nele. Antes de commitar com `-A`, rodar
`git --no-optional-locks status --porcelain` e olhar o que vai junto. O
`--no-optional-locks` tambem evita o `.git/index.lock` preso que o sandbox deixa.

### Nota de operacao: o push pode ser rejeitado sem ninguem ter feito nada

Aconteceu em 14/09 logo depois do `6a5ddc5`: `! [rejected] main -> main
(non-fast-forward)`. **Nao era outra pessoa nem outra sessao.** O workflow
`.github/workflows/calendar-mirror.yml` commita o espelho do ForexFactory a cada
6 horas (`calendario: espelho automatico do feed [skip ci]`), entao o remoto
anda sozinho varias vezes por dia.

Conserto, e ele preserva trabalho nao commitado de outra sessao na arvore:
`git pull --rebase --autostash origin main && git push`

O `--autostash` e a parte que importa: sem ele o git recusa o rebase com
"cannot pull with rebase: You have unstaged changes". Conflito e improvavel
porque o commit do workflow toca so `apps/frontend/public/calendar/thisweek.json`.

## 15/09/2026 — o que o bundle de producao revelou (lido, nao suposto)

Verificacao feita no navegador do dono, lendo o JS servido em producao
(`assets/index-Bydxw76R.js`, 1.513 KB) e o `dataLayer` em runtime.

### ✅ Corpo pre-renderizado CONFIRMADO em producao, rota a rota
HTML cru, sem executar a SPA:

| rota | palavras | h1 servido | JSON-LD | robots |
|---|---|---|---|---|
| `/` | **889** | Stop trading in the dark. | ld-home (FAQPage) | indexavel |
| `/pricing` | 432 | Pricing: $29/mo for 200 AI Chart Analyses | ld-pricing | indexavel |
| `/accuracy` | 393 | We score our own AI and publish the losses. | ld-accuracy (Dataset) | indexavel |
| `/try` | 320 | Free AI Chart Analysis, No Signup Required | - | indexavel |
| `/terms` | 136 | Terms of Service | - | indexavel |
| `/sign-in` | **0** | (sem corpo, correto) | - | **noindex,nofollow** |

A tabela da /accuracy saiu com numero real buscado no build:
**38,8% (IC 30,4 a 47,9), n = 116**, sob o titulo `Measured accuracy, as of
2026-09-14`. O `$29` do title da /pricing saiu certo (o bug do `$` como
sintaxe de replacement nao voltou).

### ✅ Tag do Google Ads confirmada no ar
`dataLayer` de producao traz `config` para **AW-18439434622**. A pendencia
"conferir se a tag carrega em producao" esta fechada.

### 🔴 ACHADO: o GA4 NAO ESTA MEDINDO NADA
No mesmo `dataLayer` existe **um unico id configurado, o AW**. Varredura do
bundle inteiro: **zero ocorrencias de `G-XXXXXXX`**.

O codigo esta correto (`analytics.ts` monta
`GOOGLE_TARGETS = [GA_ID, ADS_ID].filter(Boolean)` e faz `config` em cada um).
O que falta e a env var: **`VITE_GA_TRACKING_ID` nao esta setada na Vercel**.
Como o Vite substitui `import.meta.env.*` por literal no build, uma env var
ausente simplesmente nao deixa rastro, e o `filter(Boolean)` descarta em
silencio. Nada quebra, nada loga, e o GA4 fica vazio.

Consequencia pratica hoje e pequena (o funil de verdade e o PostHog), mas
qualquer conclusao tirada do GA4 e sobre um conjunto vazio. **PENDENTE DO
DONO:** setar `VITE_GA_TRACKING_ID` na Vercel, ou assumir o PostHog como
unica fonte e parar de esperar dado no GA4.

**Regra confirmada de novo:** env var ausente no Vite nao e erro, e ausencia
silenciosa. Vale para `VITE_GA_TRACKING_ID` como valeu para
`ENABLE_QUICK_GROUNDING` e `RESEND_API_KEY`.

### Sentry: `environment` blindado e ruido filtrado
O `environment` era `VITE_APP_ENV || MODE || 'development'` e o painel
mostrava erro de producao como `development`. **Nao deu para ler o literal
compilado** (o minificador dobrou a expressao), entao em vez de caçar a env
var o codigo ficou imune: um build de producao nao consegue mais se rotular
como development, porque a decisao passou a sair de `import.meta.env.PROD`,
que o Vite resolve no build e nenhuma env var alcanca. Um valor proprio como
`staging` continua valendo; so a combinacao "build de producao dizendo
development" e corrigida.

Ruido filtrado no cliente, nao por regra no painel (evento descartado no
cliente nao gasta cota): as mensagens de `removeChild`/`NotFoundError` do
**Google Translate** (58 eventos; ele reescreve os nos de texto por fora do
React, e isso nao tem conserto do nosso lado) e as duas de `ResizeObserver`.
O **WebView do Instagram** e apenas MARCADO com `tags.webview='instagram'`,
nao descartado: o trafego de anuncio cai todo la dentro e um erro de conversao
que so acontece nesse ambiente precisa continuar visivel.

Verificacao: `tsc -b --force` e `eslint` do frontend, limpos.

## 15/09/2026 — Bing Webmaster Tools cadastrado e verificado

O par obrigatorio do trabalho de GEO: o indice do Bing e o que alimenta boa
parte das respostas do ChatGPT, que hoje e o maior canal de aquisicao.

**Conta: `tickrify@gmail.com`** (a conta da empresa, nao a pessoal).

### ⚠️ O Search Console NAO esta na conta da empresa
A importacao do Google Search Console (caminho que dispensaria verificacao)
**foi tentada e abandonada**, e vale registrar por que, para ninguem repetir:
a `tickrify@gmail.com` **nao tem acesso** a propriedade `tickrify.com` no GSC.
O Google respondeu literalmente "voce nao tem acesso a esta propriedade". O
Search Console esta na conta PESSOAL (`vm3441896@gmail.com`).

Consequencia: a importacao teria voltado vazia. Foi conferido ANTES de conceder
o OAuth, entao nenhum acesso a conta pessoal foi concedido ao Bing.

### Verificacao: meta tag, nao arquivo XML
`<meta name="msvalidate.01" content="70A5C858B0BB161FBE84C3D4F902E8E2" />` no
`index.html` (commit `fac5235`). Escolhida em vez do `BingSiteAuth.xml` por
dois motivos: edita arquivo existente em vez de jogar mais um arquivo solto no
repo (regra de 28/07), e o `prerender.mjs` propaga a meta para todas as rotas
de graca.

**NAO REMOVER a meta.** O Bing revalida periodicamente depois de verificado, e
tirar a tag derruba a propriedade. Ja tem comentario no `index.html` avisando.

### ✅ Sitemap enviado (15/09)
`https://tickrify.com/sitemap.xml` submetido em 15/09. Painel confirma
**Known sitemaps: 1**, status `Submitted / Processing`, 0 erros, 0 avisos.

**Como foi enviado, porque isto vai se repetir:** o modal de "Submit sitemap"
**nao abre por clique** no navegador interno do Claude (tentado 4 vezes, em
800px e em 1440x900; o clique registra e o dialogo nunca entra no DOM). O que
funcionou foi JavaScript direto na pagina:

1. `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Submit sitemap').click()`
2. preencher o input com o **setter nativo** do `HTMLInputElement` e disparar
   `input`/`change` com `bubbles: true`. O Fluent UI do Bing e React: atribuir
   `input.value` direto NAO funciona, o componente ignora e o botao Submit
   continua desabilitado. Foi por isso que o `form_input` falhou antes.
3. clicar no `Submit`.

Mesmo padrao serve para qualquer formulario React que resista a automacao.

### Achado de brinde
O menu do Bing Webmaster Tools tem uma secao **`/webmasters/aiperformance`**
(AI Performance), que reporta desempenho em respostas de IA. Com o site recem
verificado ela ainda nao tem dado ("ate 48 horas para processar"), mas e
exatamente a metrica que este projeto quer acompanhar. Conferir na semana que
vem.

## 15/09 — auditoria das promessas da landing contra o motor

Pedido antigo do dono ("auditar promessas da landing contra o que o produto
entrega de verdade, ex.: Multi-Timeframe Analysis"). Feita lendo o codigo do
motor, nao a copy.

### ✅ Confirmados VERDADEIROS (nao reabrir sem evidencia nova)
- **f5d, live candle grounding** (RSI(14), posicao no range, momentum): existe,
  `buildQuickGrounding` + `ENABLE_QUICK_GROUNDING=true` conferido no Render.
- **f6d, economic calendar guard "checked before every read"**: VERDADE. O
  `decideSignal` roda dentro do `analyzeImage`, que e o caminho unico de quick
  E deep. O news guard rebaixa para WAIT com evento High entre -15min e +45min,
  e `ENABLE_NEWS_GUARD` tem `defaultValue: 'true'`, entao vale mesmo sem env var
  no Render. O exemplo da copy ("NFP in 18 minutes") cai dentro da janela.
  Calendario conferido ao vivo em 15/09: `degraded: false`.
- **Guard de R/R vivo**: `applyRiskRewardGuard` dentro do `decideSignal`,
  `ENABLE_RR_GUARD` tambem com default `true`. (A nota de 27/07 dizia "o guard
  esta morto no adapter" — isso foi CORRIGIDO desde entao; o guard dispara.)

### 🔴 Claim impreciso CORRIGIDO nos 6 idiomas: o f3d
Dizia **"Anything below 1.2:1 R/R is automatically downgraded to WAIT"**. O
codigo nao faz isso: o guard usa o **MELHOR alvo** (maior entre TP1 e TP2) e so
rebaixa quando NEM esse alcanca 1.2. Um setup com TP1 a 1.0R e TP2 a 2.5R passa
liso.

A copy prometia MAIS rigor do que o motor aplica, que e a mesma familia de
claim que as auditorias de 27/07 e 17/08 removeram. Agora diz "when not even
the best target clears 1.2:1". Corrigido nos 6, mesmo commit.

### ⚠️ ACHADO NAO CORRIGIDO: "Multi-timeframe" com UM grafico so e INFERENCIA
A suspeita do dono estava certa, mas o problema nao esta na landing (ela nao
promete multi-timeframe em lugar nenhum; as 6 features sao outras). Esta DENTRO
do produto:

- Com 2+ imagens, o top-down e REAL: o adapter manda cada HTF com `detail:high`
  e o prompt exige comentar cada grafico ("nao invente, leia a imagem").
- **Com 1 imagem, o prompt manda INFERIR**: `trading-system-prompt.ts` linha 58,
  "Multi-Timeframe Alignment (infer from the single chart visible)".
- E o resultado exibe uma secao rotulada **`MULTI-TIMEFRAME`**
  (`AnalysisResult.tsx:174` → chave i18n `deepMtf`), com o MESMO rotulo nos dois
  casos.

Ou seja: quem sobe um grafico so le "Multi-timeframe" numa secao que e
extrapolacao a partir daquele unico grafico. Nao e mentira deliberada, e o mesmo
rotulo para duas coisas diferentes.

**Atenuante ja existente:** o uploader mostra
`singleHint: 'Single-chart analysis · add higher timeframes for top-down'`,
entao o produto ja diz ao usuario que faltou HTF. O buraco e so o rotulo do
RESULTADO.

**RESOLVIDO no mesmo dia, por um caminho mais barato que o proposto.**

A proposta original era rotular conforme a origem ("Multi-timeframe" com HTF,
"inferred" sem), passando a contagem de imagens ate o `AnalysisResult`. **Nao
da**, e o motivo importa: `MULTI-TIMEFRAME` e um rotulo que o **MODELO escreve**
dentro do texto do resumo do deep, e o front so o TRADUZ
(`CANONICAL_DEEP_LABELS` em `AnalysisResult.tsx:174`). O front nao tem a
contagem de imagens, e obte-la exigiria coluna nova no banco ou mudanca no
prompt — e mexer no prompt esbarra na regra do repo ("motor so muda com
medicao").

A saida foi um rotulo **preciso nos dois casos**. A secao responde sempre a
mesma pergunta ("os timeframes concordam?"), com HTF lido OU inferido, entao
`deepMtf` virou **"Timeframe alignment"** (e equivalente nos 6 idiomas). Diz o
que a secao entrega sem prometer que varios graficos foram analisados.

Uma chave de i18n, zero risco, zero toque no motor. A analise de custo mudou
quando ficou claro que o rotulo vinha do modelo e nao do front.

### Verificacao
`tsc -b --force` do frontend: 0 erros. Varredura de travessao nos 6 arquivos de
i18n: 0 (de quebra saiu o `20–30s` do rotulo de estimativa, que usava en-dash).

## 15/09 — Google Ads: diagnostico da campanha e acoes de conversao

### O diagnostico: a campanha nao esta ruim, ela quase nao existe
Lido no painel (8 a 15/09): **16 impressoes, 2 cliques, R$ 5,38, CPC medio
R$ 2,69** (teto R$ 3). 16 palavras-chave, **todas com status "Qualificada"**,
nenhuma barrada por baixo volume.

Duas leituras que invertem a conclusao obvia:
1. **CTR de 12,5%** (2/16). Em rede de pesquisa, 2-5% ja e bom. Se o anuncio ou
   a oferta fossem o problema, o CTR estaria em 1%. **Quem ve, clica.**
2. **Gastou R$ 5,38 de R$ 40 em 1,5 dia**, com ritmo previsto de R$ 8/dia. Esta
   gastando menos da metade, logo **NAO e limitacao de orcamento**: a campanha
   nao consegue entrar em leilao.

Causa: termos em ingles ("ai chart analysis", "chart analysis tool") em
Filipinas/Malasia/Africa do Sul, com teto de R$ 3 (~US$ 0,55). Volume desses
termos nessas geos e pequeno e o lance e baixo para leilao de software
financeiro. Nesse ritmo o teste termina em ~50 impressoes: **nao responde a
pergunta que motivou o gasto**, e isso e falha de desenho do teste, nao do
produto. Aumentar lance ou verba agora so gastaria mais rapido.

### 🔴 O achado que explica "Conversoes: 0"
O `analytics.ts` ja mandava `sign_up`, `purchase`, `begin_checkout` e
`view_item` com `send_to` incluindo o AW desde 14/09. **Isso nao conta como
conversao.** O Google Ads so registra conversao num evento chamado literalmente
`conversion`, cujo `send_to` traz o ROTULO da acao (`AW-<id>/<label>`). Evento
generico alimenta relatorio e remarketing, e some da coluna Conversoes.

Ou seja: nao faltava so configurar o painel, **faltava codigo**.

### Criado em 15/09 (conta 489-869-2148, tickrify@gmail.com)
Duas acoes, ambas Principal, contagem/janelas no padrao (90 dias de clique,
atribuicao data-driven):

| Meta | Nome | Rotulo |
|---|---|---|
| Inscricao | Cadastro completo (sign_up) | `AW-18439434622/C582CKGYlvgcEP7izdhE` |
| Assinatura | Assinatura paga (purchase) | `AW-18439434622/Bgg3CKSYlvgcEP7izdhE` |

"Conversoes de chamadas telefonicas" vinha MARCADO por padrao e foi
desmarcado: o produto nao tem telefone e so poluiria o painel.

Os rotulos foram extraidos do DOM do modal (varredura incluindo shadow root),
**nao lidos da tela**: `C582CKGYlvgc...` tem um `l` minusculo que num screenshot
se confunde com `1`, e um caractere errado faz a conversao nunca disparar, em
silencio.

No codigo: `ADS_CONVERSION_LABELS` + `trackAdsConversion()` em `analytics.ts`,
disparados JUNTO com os eventos GA4 existentes (os dois, nao um ou outro). O
purchase leva `value`, `currency` e `transaction_id` reais.

**Rotulos ficam no codigo, nao em env var, de proposito:** env var ausente no
Vite nao e erro, e ausencia silenciosa. Ha um guard: o disparo so acontece se o
rotulo pertencer a mesma conta de `VITE_GOOGLE_ADS_ID`, entao trocar de conta e
esquecer os rotulos nao manda conversao para a conta errada.

### ⚠️ PENDENTE: a tag aparece como "Ainda nao instalada"
O proprio fluxo de conversao mostra `por uma tag do Google — Ainda nao
instalada`, mesmo com o `AW-18439434622` confirmado no `dataLayer` de producao.

Hipotese principal, nao confirmada: **o gtag so sobe apos consentimento de
cookies** (`main.tsx` chama `initAnalytics()` somente com
`getConsent() === 'granted'`). O verificador do Google nao aceita banner, entao
nunca ve a tag. Isso esta CORRETO do ponto de vista de privacidade, mas tem uma
consequencia que precisa estar clara: **as conversoes so contam para quem
aceita cookies**, e o numero do painel sera estruturalmente menor que o real.
Reavaliar se o painel continuar dizendo "nao instalada" depois de 48h.

## 15/09 — 🔴 O cupom nao era aplicado na /pricing (receita perdida, com recibo)

### O achado
O Stripe mostra os pagamentos de setembro:

| e-mail | valor | status | data |
|---|---|---|---|
| pezhman.arwa@gmail.com | **US$ 18,85** | sucesso | 08/09 06:44 |
| sandyvaishnav@gmail.com | **US$ 18,85** | sucesso | 08/09 21:02 |
| buyamwahla@gmail.com | **US$ 18,85** | sucesso | 10/09 18:28 |
| benniequltured@gmail.com | US$ 18,85 | cancelado | 08/09 01:19 |
| leaf-caretaker.h@i.softbank.jp | **US$ 29,00** | cancelado | 12/09 02:16 |

`18,85 = 29 x 0,65`, ou seja EARLY35 aplicado. **O japones foi o unico cobrado
o valor CHEIO, e foi o unico que veio por outro caminho.**

A causa nao era moeda nem pais (a nota antiga "checkout no Japao cobrando US$29"
apontava para o lugar errado). Existiam DOIS caminhos de compra:

- `DashboardPage.tsx:418` (paywall "Unlock analysis") passava `'EARLY35'` →
  desconto pre-aplicado → US$ 18,85.
- `PricingCards.tsx:224` (pagina de precos) **NAO passava cupom** → caia em
  `allow_promotion_codes: true` → a pessoa tinha que **DIGITAR** "EARLY35" no
  checkout da Stripe. Quem nao digitava pagava **54% a mais** pelo mesmo plano
  que a propria pagina anunciava com desconto.

### 🔑 O que isso revela sobre a JORNADA dos tres assinantes
Os tres pagaram 18,85, o valor do caminho do paywall. Ou seja: **eles nao
compraram pela pagina de precos. Eles usaram o produto, esgotaram as 3 analises
gratis e converteram no paywall.** Isso e o dado de jornada mais solido que
existe hoje sobre eles, e sai de aritmetica, nao de atribuicao.

Consequencia estrategica: o que converte aqui e USO, nao vitrine. O funil que
importa e `/try` → analise → limite → paywall.

### Correcao
- `PricingCards` passa `'EARLY35'`, igual ao paywall.
- Copy da /pricing parou de pedir o codigo (EN e PT): "applied automatically".
- **Fallback no `stripe.service`**, e ele importa mais que o resto: `discounts`
  com cupom que a Stripe recusa (esgotou os 50 usos, expirou, foi apagado)
  **faz o `sessions.create` LANCAR**. Sem o fallback, o dia em que o EARLY35
  acabasse seria o dia em que 100% dos checkouts parariam de abrir, e ninguem
  ligaria uma coisa na outra. Agora cupom morto so deixa de descontar.

## 15/09 — pergunta de atribuicao no painel (`AcquisitionSurvey`)

**Por que existe:** os tres primeiros assinantes chegaram e nao deu para dizer
de onde. Nao por falta de ferramenta, mas porque as tres furam no mesmo ponto:
o PostHog so inicializa apos aceite de cookies (quem recusa e invisivel do
primeiro clique ao pagamento); `$initial_utm_source` e
`$initial_referring_domain` vem VAZIOS neste projeto, entao nao ha primeiro
toque; e UTM morre no primeiro retorno direto, que sempre acontece com quem
pesquisa antes de comprar.

Uma pergunta de um clique nao tem nenhum desses furos.

- Colunas `acquisitionSource` / `acquisitionDetail` / `acquisitionAnsweredAt`
  no `User`. Migracao Prisma **e** `ADD COLUMN IF NOT EXISTS` no
  `onModuleInit` do `AuthController` (em producao `RUN_MIGRATIONS_ON_START=false`,
  entao migracao sozinha nao basta).
- `POST /api/auth/acquisition-source`, atras do `AuthGuard`. **Nao sobrescreve
  resposta anterior**: a primeira vale, e reenvio nao corrompe o dado.
- DTO com decorator em TODO campo. O `ValidationPipe` global roda com
  `forbidNonWhitelisted`, e campo sem decorator faz a requisicao inteira ser
  rejeitada. Foi assim que o salvar do perfil de estrategia quebrou 100% das
  vezes em producao com typecheck e jest verdes.
- `syncUserProfile` passou a DEVOLVER o perfil (antes era `Promise<void>`),
  entao saber se a pergunta ja foi respondida custa ZERO requisicao a mais.
- Card no fluxo, nao modal: bloquear o painel trocaria dado de atribuicao por
  atrito no produto. Dispensar **nao grava nada** — resposta falsa e pior que
  ausencia, porque entra na contagem.

### ⚠️ `prisma generate` NAO roda no VM do Claude
`Failed to fetch the engine file ... 403 Forbidden`: o VM nao tem rede para
baixar o engine. Entao o `tsc --noEmit` do backend acusa **3 erros de
`acquisitionSource` que sao do Prisma Client desatualizado, nao do codigo**.
Conferido a mao que os nomes batem nos tres lugares (schema, migracao,
controller) e que nao ha nenhum outro erro. O dono resolve com
`npx prisma generate` na maquina dele, e o build do Render ja roda
`prisma generate` antes do `nest build`.

Verificacao: frontend `tsc -b` 0 erros, `eslint` sem erro novo, backend
**jest 190/190**.

## 15/09 — ⚠️ CORRECAO: os dois checkouts perdidos foram FUNDOS INSUFICIENTES

Abri os dois pagamentos cancelados no Stripe. **Os dois tem exatamente a mesma
causa**, lida na ficha, nao inferida:

| cliente | valor | erro | rejeicao da rede | risco |
|---|---|---|---|---|
| benniequltured@gmail.com | US$ 18,85 | `card_declined` | **51 (fundos insuficientes)** | Normal |
| leaf-caretaker.h@i.softbank.jp | US$ 29,00 | `card_declined` | **51 (fundos insuficientes)** | Normal |

### O que isso DERRUBA (analise minha que estava errada)
Eu tinha lido "Cancelado" como abandono de checkout e concluido que havia
**problema de UX ou friccao na tela de pagamento**, com perda de ~50% do funil.
**Falso.** Nao houve abandono, nao houve bug de checkout, nao houve fraude
(risco Normal nos dois). O cartao das duas pessoas nao tinha saldo.

O `benniequltured` tentou **DUAS vezes em um minuto** (01:18 e 01:19), mesmo
cartao. Isso e o oposto de desistencia: e alguem que queria pagar e nao
conseguiu.

### O que isso MANTEM, com ressalva
A correcao do cupom na /pricing continua certa e necessaria, mas o japones
**nao foi perdido pelo preco cheio em si**: ele foi recusado por saldo. O que
se pode dizer com honestidade e que US$ 29,00 exige 54% mais saldo disponivel
que US$ 18,85, e numa recusa por fundos insuficientes o valor entra na conta.
Contribuiu, provavelmente; causou, nao da para afirmar.

### 🔴 O achado ESTRATEGICO, que e maior que o bug
**2 de 5 tentativas de assinatura (40%) foram recusadas por falta de saldo.**
O normal em SaaS e 5 a 15% de `card_declined`, e boa parte por outros motivos.

Isso nao e problema de produto nem de funil: e **capacidade de pagamento do
publico que o produto esta atraindo**. E conversa direto com a decisao de
mirar Filipinas, Malasia e Africa do Sul no Google Ads (geos escolhidas por
serem baratas): para um produto de US$ 29/mes, clique barato e cliente que nao
consegue pagar sao o mesmo fenomeno visto de dois lados.

Tres saidas possiveis, nenhuma testada ainda:
1. **Recuperacao de receita no Stripe** (a propria ficha sugere: "Otimize a
   recuperacao de receitas"). Retentativa automatica em dia diferente pega
   parte das recusas por saldo. E o de menor esforco e deveria ser o primeiro.
2. **Preco regional / PPP.** Aumenta a base pagante nessas geos e reduz ARPU.
3. **Mirar conteudo e anuncio em geo de maior poder aquisitivo.** Menos
   trafego pelo mesmo dinheiro, mais conversao efetiva.

**A pergunta que decide entre elas so tem resposta com o dado de origem** que
passou a ser coletado hoje: se o publico de US/UK/EU converte em taxa normal e
so as geos baratas recusam, a resposta e (3). Se recusa em todo lugar, e (2).

## 15/09 — Stripe: cobranca e comunicacao de falha de pagamento

### O que ESTAVA errado (lido no painel, nao suposto)
**Todos os e-mails de cliente do Stripe estavam DESLIGADOS**, inclusive
"enviar e-mails quando ocorrer falha nos pagamentos com cartao". Somado ao
`RESEND_API_KEY` que nao existe no Render, o resultado e que **as duas pessoas
recusadas por saldo nunca receberam contato nenhum**, de nenhum dos dois lados.
O `benniequltured` tentou duas vezes em um minuto, falhou, e o silencio foi
total.

### ✅ Ligado em 15/09
"Enviar e-mails quando ocorrer falha nos pagamentos com cartao". Confirmado
apos recarregar a pagina. Os outros toggles seguem desligados de proposito
(nao foram autorizados e nao resolvem nada hoje).

Isso **nao recupera os dois casos passados** (falha na PRIMEIRA cobranca do
Checkout nao gera fatura de assinatura), mas cobre toda renovacao daqui pra
frente. A primeira renovacao dos tres assinantes cai em outubro; sem este
e-mail, uma recusa por saldo derrubaria um terco da base em silencio.

### ⚠️ CORRECAO de uma recomendacao minha
Eu sugeri "ativar a recuperacao de receita". **Ela JA ESTAVA ativa**: Smart
Retries, ate 8 tentativas em 2 semanas. E, mais importante, **ela nao cobre os
dois casos**: Smart Retries age em renovacao que falha, e o que falhou ali foi
a primeira cobranca dentro do Checkout, onde nao existe assinatura para
retentar. Ativar aquilo teria dado sensacao de problema resolvido sem resolver
nada.

### 🚧 DECISAO PENDENTE DO DONO: para onde o e-mail de falha aponta
Ao ligar o e-mail, aparece "Atualizacoes de formas de pagamento". Hoje esta em
**"Use uma combinacao de ambos (herdado)"**, e os quatro links apontam para
`https://tickrify.com`, a home. Ou seja: o cliente recebe "seu pagamento
falhou", clica e cai na landing, nao numa tela onde atualize o cartao. Funciona
de forma indireta (ele loga e usa "Manage subscription"), mas perde gente no
caminho.

A alternativa e **"Link para uma pagina hospedada da Stripe"**, que leva direto
ao portal de atualizacao de cartao.

**NAO FOI FEITO, e o motivo importa:** o Stripe avisa que a mudanca
**"sera aplicada a todas as comunicacoes com o cliente e NAO PODE SER ANULADA"**.
Confirmado na pratica: depois de selecionar a opcao nova, o radio "herdado"
fica inacessivel. Eu havia dito ao dono que era reversivel, o que estava
errado, entao cancelei e deixei a conta exatamente como estava. Sair do
"herdado" e uma escolha de mao unica e e dele.

---

## 15/09/2026 - Metricas dos anuncios e passo 4 do GEO

### Numeros dos dois canais pagos, lidos no painel
**Google Ads** "Tickrify | Search | Teste120 | SET26" (7 dias): 43 impressoes,
4 cliques, CTR 9,30%, CPC medio R$ 2,27, gasto R$ 9,10, saldo R$ 30,90,
**0 conversoes**. 100% dos cliques em celular.

**Meta** "Tickrify | IG | Teste120 | SET26" (30 dias): R$ 31,67 gastos,
9.843 impressoes, 8.697 de alcance, **205 landing page views a R$ 0,15**,
termina 18/09, **0 assinantes**. A outra campanha esta OFF, R$ 0,00.

Leitura: ~R$ 41 gastos, ~209 visitas, zero assinante. O Meta entrega clique 15x
mais barato que o Google e mesmo assim **205 visitas nao produziram um cadastro**.
Isso e amostra suficiente para dizer que trafego barato de Instagram nao e o
gargalo. Os 4 cliques do Google ainda nao dizem nada, mas os termos que
dispararam sao de intencao real ("ai chart scanner", "chart analyzer ai"); o
problema la e volume de leilao, nao qualidade.

### Tag de conversao do Google: pendente por falta de evento, nao por bug
O painel mostra "acao de conversao criada, mas a tag ainda nao foi verificada".
O codigo subiu em 14/09 e esta no ar. O Google so marca como verificada depois
que a tag **dispara pelo menos uma vez**, e nao houve assinatura desde o deploy.
Nao mexer nisso ate existir uma compra.

### Passo 4 do GEO: /accuracy reescrita no formato que LLM cita
Mudou a ORDEM, nao o conteudo nem as tres regras da pagina (nada sem n, nada
sem intervalo, nada inventado se a API cair):

- **H1 virou pergunta**: "How accurate is Tickrify's AI chart analysis?"
- **Resposta direta no primeiro paragrafo**, com numero, data, n e intervalo,
  montada de `data.overall`. Sem API, o paragrafo vira a frase de metodo. **Nao
  existe numero de reserva escrito a mao em lugar nenhum**, que e como se
  publica numero velho sem perceber.
- **Tabela "at a glance"** logo abaixo dos KPIs (taxa, wins/losses, abstencao,
  janela, custos, data), e **tabela comparativa** "How should you read an AI
  accuracy claim?" com seis criterios.
- **Bloco de FAQ** com 6 perguntas, e **FAQPage no schema** junto do Dataset,
  num unico `@graph` com o id `accuracy`.

O `@graph` com um id so e deliberado: o `useJsonLd` substitui o elemento **por
id**, entao dois blocos separados virariam um substituido e um duplicado.

O mesmo tratamento foi aplicado ao HTML cru em `scripts/geo-body.mjs`
(`accuracyAnswer`, `accuracyFaqItems`, `accuracyFaqBlock`). As perguntas estao
escritas **duas vezes**, no .tsx e no .mjs, porque um script de build em Node
nao importa componente React. A regra dos dois lados e a mesma: nenhuma
resposta traz numero que a API nao devolveu naquele build.

Escopo, porque ha usuario pagante dentro da plataforma: mexeu **so em pagina
publica** (`AccuracyPage.tsx`, `seo-routes.json`, `geo-body.mjs`). Nada de
painel, motor de analise, auth ou pagamento. Nenhum CSS novo, so classes
`site-*` que ja existiam.

### ⚠️ Limite desta VM: nao da para rodar `vite build` aqui
`node_modules` foi instalado no Mac; o binario nativo do **rollup** (e o do
esbuild, ja visto em 14/09) nao existe para o Linux da VM, entao `vite build` e
`vitest` quebram com MODULE_NOT_FOUND em `rollup/dist/native.js`. Alem disso a
pasta montada **nao permite unlink**, entao o build nem consegue limpar `dist/`.

Os portoes que FUNCIONAM aqui e que devem ser usados antes de todo commit:
`./node_modules/.bin/tsc -b` e `./node_modules/.bin/eslint <arquivos>`. Para o
pre-render, importar as funcoes do `geo-body.mjs` direto no node com um payload
de acuracia de mentira e conferir o HTML de saida, inclusive o caminho "API
caiu". Foi assim que esta mudanca foi verificada.

### /pricing: o FAQ existia so depois do JavaScript
A /pricing ja montava FAQPage com 6 perguntas, mas **via `useJsonLd`**, ou seja,
so depois do JS. No HTML cru a rota servia **uma unica pergunta** (`faq.q6` da
landing) e **nenhum FAQPage**. Para crawler de IA, que nao executa JS, o FAQ
simplesmente nao existia.

Corrigido com `readPricingFaq()`, que le as perguntas do **mesmo** lugar que a
tela usa (`PRICING_COPY.en.faq`, dentro do `PricingPage.tsx`), pela mesma
tecnica do `readOffer`. Nao e copia: se ele editar uma resposta la, o HTML cru
acompanha; se a extracao falhar, o pre-render emite **nada** em vez de emitir
resposta velha. O schema da rota virou `@graph` com SoftwareApplication +
FAQPage, mesmo formato e mesmo id ('pricing') que o React publica, entao o
React substitui em vez de duplicar.

Isto **nao inventa conteudo**: iguala o HTML cru ao que o visitante ja le. Era
o contrario disso que seria arriscado.

---

## 15/09/2026 - GA4 ligado e uma correcao sobre o Resend

### ⚠️ CORRECAO: o Resend JA ESTA FUNCIONANDO
Eu vinha repetindo que "nenhum e-mail saiu desde julho porque falta
RESEND_API_KEY no Render". **Errado, e verificado no painel do Resend:**

- Dominio `tickrify.com`: **Verified** (ha 3 meses).
- Chave de API "tickrify": criada ha 1 dia, **usada pela ultima vez ha 1 hora**.
- **5 e-mails "Your 3 free analyses are ready" entregues nas ultimas 11 horas**,
  todos com status Delivered.
- Remetente: `Tickrify <noreply@tickrify.com>`, ou seja, `MAIL_FROM` tambem
  esta configurado no dominio proprio, nao no `onboarding@resend.dev` do
  fallback.

Ou seja: `RESEND_API_KEY` e `MAIL_FROM` existem no Render e o fluxo de
boas-vindas esta vivo. A licao: **conferir o painel do servico antes de
repetir uma pendencia herdada**; esta ficou meia sessao no ar como "parada
esperando o dono" quando ja estava resolvida.

De quebra, o dado que aparece nesses envios: **5 cadastros novos em ~11 horas**.

### GA4: a propriedade existia, o fluxo de dados NAO
`VITE_GA_TRACKING_ID` nao estava na Vercel, mas o motivo de fundo era outro: a
propriedade `tickrify-15e36` (a361552826 / p496881305) **nao tinha nenhum fluxo
de dados**, entao nao existia Measurement ID nenhum para colocar na variavel.

Feito:
1. Criado o fluxo Web "Tickrify Web" (id 15784212373) para `https://tickrify.com`.
2. **Measurement ID: `G-SME6X097T6`**.
3. `VITE_GA_TRACKING_ID=G-SME6X097T6` na Vercel, tipo **Config** (nao Secret:
   measurement ID viaja no bundle publico), ambiente **Production** apenas,
   para nao sujar o GA com trafego de preview.
4. Redeploy **sem build cache**.

Verificado no ar: `gtag/js?id=G-SME6X097T6` carrega, e o dataLayer traz
`config G-SME6X097T6`, `config AW-18439434622` e o `page_view` com
`send_to: [G-..., AW-...]`. E exatamente o que o `GOOGLE_TARGETS` do
`analytics.ts` foi escrito para fazer: **uma unica gtag.js servindo GA4 e Ads**.

### 🚧 O que NAO foi feito de proposito
O GA ofereceu "Usar a tag do Google do seu site", que ligaria o fluxo novo a
tag AW ja instalada **sem mexer em codigo**. Recusado: o aviso em vermelho diz
que "as definicoes de 'tickrify' vao substituir as atuais", ou seja, mexeria na
tag do Google Ads que esta funcionando e cujas conversoes acabaram de ser
ligadas. Trocar risco em sistema que funciona por conveniencia nao vale.
Escolhido "Instalar manualmente" e a via da env var.

### Estado real da medicao (conferido no ar, nao presumido)
- **PostHog: funcionando** (eventos saindo para us.i.posthog.com). Eu quase
  reportei que estava quebrado porque `window.posthog` e `undefined`; ele e
  importado como modulo npm, nao expoe global. **Testar pelo trafego de rede
  ou pela chave `ph_*` no localStorage, nunca pelo global.**
- **Meta Pixel: funcionando** (`fbevents.js` carregado).
- **Google Ads (AW): funcionando** desde 14/09.
- **GA4: configurado hoje, ainda NAO confirmado no painel.** O lado do
  navegador esta verificado: `gtag/js?id=G-SME6X097T6` carrega, o container
  `G-SME6X097T6` aparece em `window.google_tag_manager`, e um POST manual para
  `google-analytics.com/g/collect` com esse `tid` sai sem ser bloqueado
  (resposta opaca, ou seja, chegou na rede). Mesmo assim o **Tempo real seguiu
  em 0 depois de ~20 minutos**, inclusive para o evento de teste manual.
  Propriedade e fluxo recem-criados costumam demorar para acender, entao a
  leitura honesta e "configurado, propagacao pendente".

  ⚠️ Nao da para verificar isso pelo inspetor de rede: o GA4 manda os hits por
  `navigator.sendBeacon`, que **nao aparece** em PerformanceResourceTiming nem
  na lista de requisicoes. Os unicos sinais confiaveis do lado do cliente sao o
  container em `google_tag_manager` e o DebugView do proprio GA.

  **Se em 24h o Tempo real continuar zerado**, investigar nesta ordem: filtros
  de dados da propriedade (trafego interno), se o fluxo 15784212373 e mesmo o
  dono do `G-SME6X097T6`, e o DebugView com `?_dbg=1`.

---

## 15/09/2026 - O e-mail de recuperacao existia mas nao podia disparar

### O buraco
`sendRecovery` ("Your analyses ran out") estava implementado, ligado e com
dedup permanente por AdminAudit. Mas o **unico gatilho** era o
`ForbiddenException` do `enforceAccessAndCreate`, ou seja, o e-mail so saia se a
pessoa **voltasse e tentasse a QUARTA analise**.

Quem usa as 3 analises e fecha a aba nunca tenta a quarta. Nunca recebia nada.

O painel do Resend confirma: nos ultimos 15 dias, **5 e-mails de boas-vindas
entregues e ZERO e-mails de recuperacao**. O caminho existia e nunca foi
percorrido.

Isso importa porque os 3 assinantes pagaram pelo caminho do **paywall**, usando
o produto ate o limite. O momento em que a cota acaba e o unico momento provado
de conversao deste produto, e era exatamente o momento em que nao saia nada.

### O que foi feito
Novo `notifyIfFreeQuotaExhausted(userId, isDemo)` no `AiService`, chamado nos
**dois** pontos onde uma analise fica `completed` (o caminho SSE e o caminho da
fila). Quando a contagem de demos nao falhadas atinge o limite, dispara o mesmo
`triggerRecoveryEmail`.

Decisoes que importam:
- **Dispara na CONCLUSAO, nao na criacao da linha.** A contagem ignora
  `failed`, entao uma analise que falha devolve a vaga. Disparar na criacao
  mandaria "suas analises acabaram" para quem ainda tem uma.
- **Dedup compartilhada.** Os dois gatilhos passam pelo mesmo
  `triggerRecoveryEmail`, que so envia se nao houver AdminAudit
  `recovery_email_sent` para aquele usuario. Nao existe caminho para dois
  e-mails.
- **Guarda de assinante nova, dentro do `triggerRecoveryEmail`:** se
  `hasPaidAccess(userId)` for true, nao envia. O gatilho e fire-and-forget e a
  pessoa pode assinar entre o disparo e o envio; sem isso, um assinante novo
  receberia um e-mail pedindo que ele assine.
- **Fire-and-forget nos dois pontos de chamada**, depois do resultado ja ter
  sido entregue. E-mail nunca segura resposta de analise.

### ⚠️ Esta mudanca NAO manda e-mail para a base existente
So dispara quando uma **terceira analise nova e concluida agora**. Quem ja
esgotou a cota no passado nao consegue concluir outra analise (fica bloqueado),
entao nao ha disparo retroativo. Assinante tem `isDemo=false` e nem entra no
caminho.

### Testes
5 testes novos em `ai.service.spec.ts` cobrindo: envia ao esgotar, nao envia com
cota sobrando, nao envia para `isDemo=false`, nao envia para assinante, e nao
envia duas vezes. **O mock de `adminAudit` precisou ser adicionado**: sem ele o
caminho inteiro morria no try/catch do `triggerRecoveryEmail` e um teste
passaria sem testar nada. Backend: `tsc --noEmit` limpo, **195/195** no jest.

## 21/09/2026 — "ninguem paga desde 12/09": o fluxo NAO esta quebrado

Auditado lendo o codigo e o Workbench da Stripe (logs de API, eventos e
`stripe checkout sessions list`), nao deduzido.

- 18 `POST /v1/checkout/sessions` entre 13 e 20/09, **todas 200**, chave
  `sk_live`, `livemode: true`, USD, US$ 29 -> US$ 18,85 com EARLY35,
  `success_url`/`cancel_url` corretas.
- A metadata de atribuicao das sessoes mostra `lt_ref_domain:
  checkout.stripe.com` + `lt_landing: /pricing?canceled=true`: a pessoa CHEGA
  na pagina da Stripe e volta pelo cancel_url. Um cliente fez isso 4x em 5 min.
- Sessoes de 12/09 em diante: todas `expired`/`open`, `unpaid`. De 7 a 12/09,
  5 de 7 clientes que abriram checkout tentaram pagar (3 pagos, 2 recusados por
  saldo). De 13 a 20/09, ~11 abriram e **0** submeteram cartao.
- **Customer novo na Stripe NAO e sinal de tentativa de compra:**
  `resolveOrCreateCustomerId` cria o customer ANTES da sessao, no clique.
- Hipotese (nao comprovada): mudou o publico, nao o codigo. Parte dos e-mails
  novos tem nome persa e o Ira nao existe na lista de paises do checkout.

**Instrumentacao corrigida no mesmo dia:** `checkout_started` passou a disparar
DEPOIS de a API devolver a URL (antes saia no clique e contava falha como
checkout); eventos novos `checkout_failed` (o catch do paywall era silencioso) e
`checkout_canceled` (volta pelo cancel_url, disparado na `PricingPage`). Com isso
o funil separa "nao chegou na Stripe" de "chegou e desistiu".

Pendente, sem codigo: ligar `after_expiration.recovery` (e-mail de checkout
abandonado) e cruzar os clientes perdidos com pais no PostHog. Menor: sessoes
duplicadas no mesmo segundo indicam `handleUpgrade` rodando 2x apos o login.

**Como subiu (21/09):** o `main` local estava 10 commits de 16/09 a frente do
remoto, NUNCA enviados (pnpm no Dockerfile e no entrypoint, remocao de configs
de deploy, patches de dependencia). Para nao arrastar isso junto, a
instrumentacao foi reaplicada SOZINHA sobre `origin/main` numa worktree e
enviada como `ccf0b33` (4 arquivos do frontend). O commit local `a2bf40b` tem o
mesmo codigo MAIS 13 arquivos de doc de outra sessao.
**PENDENTE:** os 10 commits de 16/09 continuam so no local. Antes de subir,
conferir no Render que o entrypoint com `pnpm --dir` sobe o worker
(`[entrypoint] Starting embedded worker...` e `[Outcome] Outcome tracking
ligado`). No rebase, o trecho do `a2bf40b` que ja esta em `ccf0b33` some sozinho.

## 21/09/2026 — checkout robusto, login preserva a compra, webhooks auditados

Tudo feito sobre `origin/main` numa worktree (o `main` local segue com os 10
commits de 16/09 nao enviados). Commits: `4eefa00` (checkout) no ar; login +
webhooks aguardando push.

### 🔴 O endpoint de webhook esta na API `2025-07-30.basil` (o SDK em `2023-10-16`)
O payload chega na versao do ENDPOINT (`we_1S8uPUB1hl0IoocUR9wVdLKP`). Na basil
a fatura NAO tem `subscription` no topo: mora em `parent.subscription_details`
(conferido no evento real `in_1UEFUv...`, 10/09). O handler lia
`invoice.subscription` -> undefined -> saia sem creditar. **O credito de ticks
por fatura NUNCA funcionou em producao.** Os assinantes receberam ticks so pelo
`ensureTicksForActiveSubscriber`, que por sua vez dava +200 TODA vez que o
saldo zerava (tick infinito sem pagamento). `invoiceSubscriptionRef` le os dois
formatos. **Qualquer campo novo lido do payload: conferir no formato basil.**

### Webhooks (regras que nao podem ser desfeitas)
- `StripeWebhookEvent` (tabela nova, criada no `onModuleInit` do StripeService):
  cada `event.id` processa UMA vez; `failed` e `processing` parado >5min sao
  retomados. Tabela fora do ar => processa sem ela (handlers sao idempotentes).
- Estado da assinatura sempre RELIDO na Stripe, nunca do payload (ordem de
  entrega nao e garantida).
- Credito de ticks de assinatura: chave `subscription_invoice:<invoiceId>` na
  coluna unica `stripePaymentIntentId`. Webhook, lazy sync e ensureTicks usam a
  mesma chave. Acesso manual (`manual_*`): 1 pacote por mes-calendario.
- Erro em handler = nao-2xx (Stripe reenvia). Nada mais responde 200 calado.
- Falha de pagamento: AdminAudit `action='stripe_payment_failed'` + PostHog
  `payment_failed`.
- **NAO reenviar pelo painel eventos `invoice.payment_succeeded` antigos:** como
  o credito antigo nunca rodou, reenviar credita 200 ticks de verdade.

### Login antes do checkout
`lib/checkoutIntent.ts`: Upgrade deslogado -> `/sign-in?redirect_url=/pricing?checkout=starter&cycle=..&source=..`
+ localStorage 30 min. SignIn/SignUp usam `fallbackRedirectUrl` (so vale sem
`redirect_url`). O Clerk leva a intencao ao cadastro NO HASH e absoluta
(`/sign-up#/?redirect_url=https://...`), conferido em producao, desktop e mobile.
One Tap le query e hash. Painel redireciona intencao recente para o checkout.

**Transicao dos 3 assinantes pagantes (commit `9df9e2b`, no ar 21/09):** as
assinaturas criadas antes de 22/09/2026 (`LEGACY_REFILL_CUTOFF_MS` no
stripe.service) mantem a recarga antiga (+200 quando o saldo zera) ATE A
PRIMEIRA RENOVACAO (8 a 10/10/2026). Depois vale o plano: 200/mes pelo webhook
da fatura. Pedido explicito do dono: "nao pode prejudicar os 3 pagantes".
Para manter a regra antiga para sempre para eles: tirar a condicao de
`current_period_start` em `isGrandfatheredPeriod`.

**ATUALIZACAO (commit `2184091`, mesmo dia): a transicao acima foi SUBSTITUIDA.**
Regra decidida pelo dono: assinante tem NO MAXIMO 200 ticks. No inicio de cada
janela mensal (mensal = periodo de cobranca; anual = 12 janelas; manual =
mes-calendario) o saldo passa a ser EXATAMENTE o pacote do plano: nao soma, nao
acumula. Chave `allowance:<assinatura>:<inicio da janela>` na coluna unica
`stripePaymentIntentId`, a mesma para webhook, lazy sync e checagem de acesso
(`ensureTicksForActiveSubscriber`, chamado em todo /usage e toda analise).
`Subscription.currentPeriodStart/End` guardam o periodo (ADD COLUMN no boot).
Os 3 assinantes de setembro voltam para 200 na proxima abertura do painel.
"Ticks never expire" SAIU da landing (6 idiomas + geo-body). Os pacotes avulsos
nao estao a venda na UI (BuyTicksModal nao e renderizado); se voltarem a ser
vendidos, o reset mensal APAGA ticks comprados — separar os saldos antes.

## 21/09/2026 — tracking do PostHog auditado (mapa de quem emite o que)

Medido no PostHog antes de mexer (30 dias): `signup_completed` do navegador 45
eventos em 41 pessoas vs 45 cadastros reais no backend; `subscription_activated`
23 eventos em 7 pessoas para 3 assinaturas (20 do webhook em 4 ids que NAO eram
o do Clerk + 3 do navegador); 0 eventos com utm_source; 22 de 45 cadastros com
origem no perfil. Ladder gratis 30d: 86 fizeram a 1a, 53 a 2a, 27 a 3a; das 27,
15 nunca voltaram (o paywall so aparecia na 4a tentativa) e as 12 que voltaram
clicaram upgrade e abriram checkout.

**Backend (fonte da verdade, deduplicado por uuid deterministico, nao depende de cookie):**
`signup_completed` (auth.guard, 1 por conta) · `free_analysis_started` /
`free_analysis_completed` {analysisNumber, freeRemaining, isLastFree} /
`free_quota_exhausted` (common/analytics/free-funnel.ts, chamado no worker e no
AiService) · `checkout_completed` · `subscription_created` · `payment_succeeded` ·
`payment_failed` (stripe.service). distinctId = id do Clerk.
**Navegador:** `landing_viewed` (era landing_view) · `pricing_viewed {from}` ·
`pricing_section_viewed` (secao da home; era pricing_viewed) · `signup_started`
(1 por sessao) · `analysis_started/completed {analysisNumber}` · `upgrade_cta_viewed`
/ `upgrade_cta_clicked {source}` · `upgrade_clicked` (botao de compra) ·
`checkout_started/failed/canceled` · `checkout_success_viewed` (era o
subscription_activated do navegador).
**So pixels (Meta/Google Ads), nunca PostHog:** `trackAdConversion('signup'|'purchase')`.
Origem: super propriedades `utm_*` (ultimo toque) + perfil `first_*`/`last_*`.
Nomes antigos (landing_view, subscription_activated, signup_completed_server)
ficam so no historico; montar funis novos com os nomes acima.

⚠️ **ACHADO NAO CORRIGIDO (manda e-mail, precisa do dono):** o e-mail de
recuperacao "cota gratis esgotada" so e disparado em `ai.service`
(fallback sem fila); o worker da fila, caminho de producao, NAO chama
`notifyIfFreeQuotaExhausted`. A nota de 15/09 que diz que ele dispara "nos dois
caminhos" esta errada. Hoje ele so sai na 4a tentativa (ForbiddenException).

## 21/09/2026 — Meta Pixel + Conversions API e observabilidade do funil de compra

**Meta (dedup navegador/servidor pelo event_id):**
| Evento | Navegador (pixel) | Servidor (CAPI) | event_id |
|---|---|---|---|
| CompleteRegistration | AnalyticsIdentify, conta nova | POST /api/auth/ads-signup | `signup_<id Clerk>` |
| InitiateCheckout | `checkout_started` (so com a sessao criada) | createCheckoutSession | `checkout_<cs_...>` |
| Purchase | success_url, SO depois do GET /api/stripe/checkout-status confirmar `paid` | webhook checkout.session.completed pago e ativo | `purchase_<cs_...>` |
Tudo so com aceite de cookies (`adsConsent`). fbp/fbc validados no navegador e
no DTO (formato fora = campo descartado, nunca 400 no checkout). Contexto do
Meta (fbp/fbc/IP/UA) vai na metadata da sessao para o Purchase do webhook.
Env no Render: `META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN` (sem elas = OFF, dito
no boot: `📣 Meta CAPI: ...`), opcional `META_CAPI_TEST_EVENT_CODE`,
`META_GRAPH_API_VERSION` (padrao v25.0). success_url agora leva
`&session_id={CHECKOUT_SESSION_ID}`.

**Funil de compra (`common/observability/funnel-log.ts`):** uma linha
`[funnel] stage=...` por etapa (checkout_requested, checkout_session_created/
reused, checkout_failed, checkout_returned {success|canceled|expired},
webhook_received, webhook_failed, payment_succeeded, payment_failed {code,
declineCode}, subscription_created, subscription_canceled {scheduled|ended}).
So campos de lista fechada; chave e e-mail viram [redacted]. Etapas de usuario
conhecido tambem vao para AdminAudit `funnel:<etapa>`:
`SELECT "createdAt", action, details FROM tickrify."AdminAudit" WHERE "targetUserId"='<id>' AND action LIKE 'funnel:%' ORDER BY 1;`
Recusa DENTRO do checkout e abandono so aparecem se o endpoint da Stripe
tiver `payment_intent.payment_failed` e `checkout.session.expired` marcados.

## 21/09/2026 — auditoria final do funil + auditoria de performance

**Funil (verificado):** deslogado -> Upgrade -> /sign-in com intencao (plano
anual preservado) em PRODUCAO; ja-assinante recusado em producao (conta do
dono); PostHog em producao pos-deploy: free_analysis_* do servidor batem 6/6
com o navegador, signup_completed 3/3 so do servidor. Pagamento real, recusa e
webhook duplicado: so por teste automatizado (Claude nao cria conta nem paga).
Primeira tela do painel apos o reset mensal mostrou o saldo antigo (219) por
corrida entre /ticks/balance e /usage; o saldo real ja era 200. Nao corrigido.

**Performance (medido antes/depois):**
- JS inicial 1.549 kB (484 gzip) -> 816 kB (261 gzip), -46%: rotas lazy
  (painel, admin, /try, /accuracy, legais; landing e /pricing continuam no
  principal), posthog-js baixado so no aceite de cookies, Sentry Replay via
  lazyLoadIntegration depois do `load`. `vite:preloadError` recarrega 1x.
- /assets/* com Cache-Control 1 ano immutable (antes max-age=0: revalidava
  1,5 MB a cada visita). So /assets: tudo la tem hash.
- CORS maxAge 7200: tira o preflight de quase toda chamada (BR -> Oregon).
- /api/ai/analyses (p50 791 ms no servidor): select sem fullResponse,
  vereditos so da pagina, imagens assinadas em lote + cache de 50 min.
- /api/auth/me: 97 kB -> so o perfil (o front le 3 campos).
- /usage duplicado deduplicado; /ticks/packages so no modal de compra; saldo
  30s -> 120s; ticker da Binance nao busca com aba escondida.
**Pendente:** i18n dos 6 idiomas no bundle principal (~155 kB fonte; lazy
exigiria fallback visivel); /api/ai/performance le 1000 linhas cheias mas
nenhuma tela chama; DashboardPage (1200+ linhas) sem memoizacao estudada;
imagem de exemplo da /try (378 kB) e entrada da IA, nao comprimir sem medir.

## 21/09/2026 — auditoria de limpeza (continuacao da sessao Codex de 16/09)

Os 10 commits locais do Codex (nunca enviados) foram reaplicados sobre
producao e validados; a limpeza que faltava foi feita por cima.
**Validacao que vale como receita:** imagem Docker de `git archive HEAD` (sem
node_modules local) + Postgres/Redis descartaveis, `RUN_MIGRATIONS_ON_START=true`,
URL do banco com `sslmode=disable` (so no teste: em producao o datasource
forca SSL). Resultado: 14 migracoes do zero, worker e API no ar, rotas vivas
200/401, removidas 404, webhook sem assinatura 400.

🔴 **Achado que protege producao:** o Dockerfile antigo fazia
`npm install -g pnpm` SEM versao. O pnpm atual recusa o install
(`ERR_PNPM_IGNORED_BUILDS`): o proximo build sem cache no Render falharia e
travaria todos os deploys. O commit do Codex que fixa `pnpm@10.12.4` corrige.

**Removido (sem chamador, conferido):** `/api/ai/analyze/stream` +
`streamAnalysis`; `/api/ai/performance` (back e front); `/stripe/cancel-` e
`/reactivate-subscription` (cancelamento e pelo portal); pacotes avulsos
(`/ticks/packages`, `/history`, `/checkout`, `createTicksCheckout`, ramo
`ticks_purchase` do webhook, `TICK_PACKAGES`, DTO, `useTicks` packages/buyTicks,
i18n `ticksModal`); helpers `detectCurrency`, `useTheme`, `limparMigalhas`,
`LANGUAGE_AI_NAMES`, `isTurnstileEnabled`; deps `ioredis`, `pg`, `@types/pg`,
`source-map-support`, `ts-loader` (backend), `dotenv`/`autoprefixer` (raiz).
**Mantido de proposito:** endpoints de operacao (`/prompts/*/activate`,
`/prompts/latest`, `/admin/flags/recarregar`), webhook, worker/scripts/prerender
(pontos de entrada sem import), `pg`/`ioredis` agora vem pelas proprias libs.
**Env vars no Render sem leitor no codigo (dono decide remover):**
ALLOW_UNAUTHENTICATED, CLERK_PUBLISHABLE_KEY, CLERK_WEBHOOK_SECRET,
FREE_ANALYSIS_LIMIT_PER_MONTH, STRIPE_PRICE_PRO, STRIPE_PRICE_PRO_MONTHLY,
SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET, VITE_GOOGLE_ADS_ID.


**Incidente do deploy da limpeza (21/09):** o `4e2f5bd` nao subiu no Render. O
`@supabase/supabase-js` 2.116 (vindo do commit de vulnerabilidades) exige
Node 22 e a imagem e `node:20-alpine`: `createClient` lanca "native WebSocket
not found" no boot. O Render manteve a instancia anterior, sem queda. O teste de
Docker nao pegou porque rodou sem `SUPABASE_URL`, e sem ela o cliente nunca e
criado. Corrigido fixando `2.100.1` (a versao que ja rodava). **Regra:** o boot
de teste no Docker precisa de TODAS as env que criam cliente no construtor
(`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY`), com valor falso, e
subir dependencia exige conferir `engines.node` contra o `FROM` do Dockerfile.
