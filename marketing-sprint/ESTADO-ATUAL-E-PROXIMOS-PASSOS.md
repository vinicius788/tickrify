# Estado atual & próximos passos (resumo da noite)

> Bom dia, Vini. Aqui está tudo que ficou pronto, o que está em pé e o que ficou intencionalmente na fila pra você revisar. Resumo honesto: o **P1 (enxergar o funil) está 100% no ar e funcionando**. O resto é código no produto vivo e ficou **preparado mas não disparado**, de propósito, pra não arriscar quebrar nada enquanto você dormia.

---

## ✅ O que está LIVE agora (P1 — instrumentação)

1. **Código de instrumentação no ar.** PostHog + Sentry integrados no frontend. Deploy verde na Vercel (commit `c5c3b9d`).
2. **Chaves configuradas** em dois lugares: `.env` local e Vercel (Production + Preview) — PostHog e Sentry.
3. **Verificado ao vivo:** eventos chegando no PostHog (testei abrindo o site → `landing_view` + `pageview` registraram).
4. **Funil salvo no PostHog:** "Funil Tickrify — Aquisição → Receita" (em Product analytics → Insights).

### Bug corrigido no caminho
O primeiro deploy falhou porque o `@sentry/react` não tinha entrado no `package.json` (o `pnpm add` instalou mas não registrou no manifesto). Corrigi, commitei (`c5c3b9d`) e o build passou. Está tudo são.

---

## 📊 Como ler o funil (e por que ele está "incompleto" por enquanto)

O funil hoje tem 3 degraus: **landing_view → signup_started → pricing_viewed**.

Ele só tem esses 3 porque o PostHog **só deixa adicionar ao funil eventos que já dispararam pelo menos uma vez**. Os degraus mais importantes — `signup_completed`, `analysis_completed` (= **ativação**) e `subscription_activated` (= **receita**) — ainda não dispararam porque **nenhum usuário real passou por eles desde o deploy** (foi há poucas horas). Não dava pra forçar isso sem criar conta de teste e gastar suas análises de IA — e eu não ia fazer isso com seus recursos.

**O que acontece sozinho:** assim que o primeiro usuário real se cadastrar, fizer uma análise e/ou assinar, esses eventos aparecem no PostHog. Aí é só abrir o funil → "Add step" → digitar o nome do evento → selecionar. 1 clique por degrau. A ordem completa que você vai querer é:

```
landing_view → signup_completed → analysis_completed → pricing_viewed → subscription_activated
```

> Obs: pra "semear" o funil eu naveguei manualmente em `/pricing` e `/sign-up` do site no ar. Isso gerou 1–2 eventos meus (anônimos) nos dados. Se quiser limpar, ative o toggle "Filter out internal and test users" no PostHog.

---

## ⏸️ O que ficou na fila (de propósito) — precisa de você acordado

Tudo abaixo é **mudança de código no seu produto no ar**. Cada uma precisa de deploy (push) + sua revisão. Não dá pra disparar no automático sem risco — e você tem o bug da análise pra resolver cedo, então não quis mexer no repo a ponto de atrapalhar.

| Item | O que é | Risco | Pré-requisito |
|---|---|---|---|
| **Webhook Stripe** | Backend dispara `subscription_activated` (fonte 100% confiável de receita) | Médio (mexe no backend NestJS) | Plano rápido + deploy |
| **P2 — Share loop** | Página pública da análise + OG image + CTA "analise grátis" | Médio-alto (rota pública nova, banco) | **Recomendo plano antes** |
| **P4 — Conversão** | Valor trancado borrado, timing do upgrade, clareza dos ticks, CTAs | Baixo-médio (frontend) | Revisão + deploy |
| **P6 — E-mail** | Boas-vindas / win-back de limite / reativação (Brevo ou Resend) | Médio (precisa criar conta de e-mail) | Conta + backend |

---

## 🎯 Ordem sugerida pros próximos passos

1. **Hoje cedo: seu bug da análise.** É a prioridade — é o "aha moment" do produto. Sem ele, todo o funil de cima não adianta.
2. **Deixar o funil rodando 2–3 dias** acumulando dados reais. Aí a gente vê de fato onde vaza.
3. **P4 (conversão)** — ajustes pequenos e de baixo risco, guiados pelo que o funil mostrar.
4. **P2 (share loop)** — com plano detalhado antes, por mexer no backend.
5. **Webhook Stripe + P6 (e-mail)** — quando estivermos no backend de qualquer forma.

---

## 🔑 Links rápidos

- **Funil:** PostHog → Product analytics → Insights → "Funil Tickrify — Aquisição → Receita"
- **Eventos ao vivo:** PostHog → Activity (Live)
- **Erros:** Sentry → projeto `javascript-react`
- **Deploys:** Vercel → tickrify-frontend → Deployments

Quando você voltar, me diz por onde quer ir (o bug da análise, P4, P2…) que eu sigo. Nada está quebrado e nada ficou pela metade no código — o que está no ar está sólido, e o que falta está documentado e pronto pra começar.
