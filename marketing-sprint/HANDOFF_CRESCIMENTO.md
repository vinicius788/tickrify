# Prompt de Handoff — Crescimento & Funil da Tickrify

> Cole isto no início de um chat novo dedicado a marketing/crescimento.
> (O chat de código fica separado — aqui o foco é funil, e-mail, Instagram, ativação e análise de métricas.)

---

Você vai me ajudar com **crescimento e marketing** da Tickrify (NÃO com código — código é tratado em outro chat). Sou o Vini, fundador solo. Sou pouco técnico e fico ansioso de quebrar coisas, então me explique simples, passo a passo e com baixo risco. Contexto completo abaixo.

## O que é a Tickrify
App web de **análise de gráficos de trading por IA**: o usuário sobe um print do gráfico e a IA devolve COMPRA/VENDA/AGUARDAR com entrada, stop e alvos (metodologia ICT/SMC, liquidez, Wyckoff, Elliott). Grátis: **3 análises sem cartão**. Pago: assinaturas (starter/pro/elite) + pacotes avulsos de "ticks". Domínio: tickrify.com. Stack: NestJS + React, Stripe (pagamento), Clerk (login), Render (backend), Vercel (front).

## Situação atual (os números — junho/2026)
- **~20 cadastros** no total, orgânicos e **internacionais** (Índia, Uzbequistão, países árabes), sem nenhum marketing pago.
- **Retenção ≈ 0**: quase todos entraram UMA vez (último login = data de cadastro) e nunca voltaram. Só 1 retornou.
- **Diagnóstico:** o furo NÃO é no pagamento — é na **ativação/retenção**. As pessoas testam uma vez e somem.
- **Estratégia:** (1) trazer com intenção (Instagram), (2) fazer a 1ª experiência grudar (onboarding), (3) reacender quem sumiu (e-mail). Vender vem depois.

## Já feito na plataforma (código — só pra contexto)
- Motor de IA reforçado: decisão unificada, guard de R/R consertado (avalia o melhor alvo TP1/TP2), **filtro de liquidez direcional**, continuidade Wyckoff (reacumulação/redistribuição), FVOB, flats de Elliott, e coerência de entrada (entrada limitada na zona quando o R/R a mercado é sub-ideal; nunca mais "compre agora" contradizendo "R/R abaixo do ideal").
- **Multi-moeda:** removida a trava de só-cartão + **Adaptive Pricing do Stripe ativado** → cada cliente paga na **moeda local** dele (150+ países). Pix disponível pro Brasil (falta só habilitar na aba de métodos).
- **Métricas:** script somente-leitura `apps/backend/scripts/funnel-metrics.ts` (`npm run metrics`) mostra o funil (cadastro → ativou → paywall → checkout → pagou) a partir do banco.

## Materiais de marketing já criados
- `marketing-sprint/PLAYBOOK_INSTAGRAM_ATIVACAO.md` — funil do Instagram (gancho, comentário→DM, legendas de Reel, mensagem de DM), ativação (onboarding) e e-mail de reengajamento, tudo em PT + EN.

## Em andamento (onde paramos)
**E-mail de reengajamento** (sendo enviado AGORA do **tickrify@gmail.com**, via Gmail Cco, pros 14 prospects internacionais — em inglês, tom de fundador). Versão atual sendo deixada mais pessoal + convite pras redes sociais. Texto em revisão:

> **Subject:** It's Vini — your 3 free analyses are waiting
>
> Hey, it's Vini — I built Tickrify myself, so I wanted to reach out personally.
> I saw you signed up but haven't used your 3 free analyses yet — they're still here for you, no card needed. Just drop a screenshot of your chart and the AI gives you the entry, stop and target in seconds (I just made the liquidity read and entry points much sharper).
> 👉 https://tickrify.com/?ref=email
> And I'm not hiding behind the app — I'm right here and I answer personally. Come hang out and ask me anything:
> 📸 Instagram: @SEU_INSTA
> ✖️ X: @SEU_X
> Or just hit reply — I read every single message myself.
> Cheers,
> Vini — Founder of Tickrify

➡️ **Pendência imediata:** definir os @ do Instagram e do X pra colocar no e-mail.

## Próximos passos (a fazer neste chat)
1. Finalizar o e-mail (tom de fundador + links das redes) e enviar pros 14.
2. **Instagram:** roteiros de Reel, legendas com gatilho "comenta X", e a mensagem de DM com o link (`tickrify.com/?ref=ig`). Começar manual; ManyChat (grátis) pra automatizar comentário→DM depois.
3. **Ativação/onboarding:** ideias pra primeira análise acontecer em segundos + motivo pra voltar (o código disso é implementado no outro chat).
4. **E-mail automático:** MailerLite (conta grátis já criada). Remetente no domínio `@tickrify.com` (precisa de DNS + plano pago) a configurar depois, pra mandar boas-vindas automáticas a cada novo cadastro.
5. **Analytics:** rodar `npm run metrics` pra ver os números reais; depois PostHog (grátis) pra ver comportamento e session replay.

## Lembrete sobre os 14 prospects (e-mails reais, já no Cco)
krushnapatilk71@gmail.com, mehradagemml@gmail.com, clashsafa1@gmail.com, soliev20030414@gmail.com, mtawalbeh9999@gmail.com, official.saahil@gmail.com, mqrlsflw@gmail.com, ankitsinghrathod8@gmail.com, xforgeia@gmail.com, asilbekabdurashidov00@gmail.com, masghatiilia9@gmail.com, manoharkleela@gmail.com, richardsreleif@gmail.com, rn1999418@gmail.com
(Excluídas as 3 contas próprias do Vini: vm3441896@gmail.com, tickrify@gmail.com, digitalgestor1@gmail.com.)

## Como me ajudar
Foque em marketing/crescimento/estratégia e conteúdo. Simples, baixo risco, passo a passo. Nada de código aqui (isso é no outro chat).
