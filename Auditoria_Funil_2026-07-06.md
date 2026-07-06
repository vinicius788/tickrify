# Auditoria do Funil de Conversão — Tickrify
**Data:** 06/07/2026 · Teste real de ponta a ponta (landing → pricing → paywall → checkout Stripe live)

## O que foi testado

Naveguei como um usuário real: landing (deslogado e logado), pricing, dashboard, upload de gráfico real (BTCUSDT 1H gerado para o teste), paywall da 4ª análise, clique em "Unlock analysis", checkout Stripe live com tentativa de aplicar o cupom EARLY50 (sem pagar), tela de cadastro do Clerk, e-mails recebidos no Gmail, eventos PostHog na rede e performance de carregamento. A conta usada (tickrify@gmail.com) já tinha consumido as 3 análises grátis — exatamente o estado que o paywall precisa converter.

## O que está funcionando

O paywall de valor trancado funciona como projetado (preview borrado + cadeado + CTA). O PostHog está disparando eventos. O console está limpo, sem erros JS. O Clerk está em produção (clerk.tickrify.com, sem banner de desenvolvimento) com Google one-tap. Os preços estão em USD ($12/$29/$59) com toggle anual "2 months free". O checkout Stripe abre com Apple Pay e cartão. A copy do site está afiada e consistente com a marca.

---

## FALHAS ENCONTRADAS — por severidade

### P0 — Está custando clientes AGORA (corrigir antes de qualquer growth)

**1. Cupom EARLY50 é INVÁLIDO no Stripe live.**
O paywall promete "Early user: code EARLY50 — 50% off your first month". Digitei EARLY50 no checkout: **"Código inválido"**. O usuário mais quente do funil inteiro — que viu o cupom, abriu o checkout e digitou o código — recebe um erro e abandona com a confiança destruída.
*Fix (15 min, sem código):* criar o coupon 50% off (duration: once) + promotion code `EARLY50` ativo no Stripe Dashboard, aplicável aos prices de assinatura. Melhor ainda: passar `discounts` na checkout session para já vir aplicado.

**2. O checkout aparece como "WayPay", não Tickrify.**
O topo do Stripe Checkout mostra "WayPay" (nome público da conta Stripe). O usuário clica em "Get Pro" na Tickrify e cai numa página de outra "empresa". Em um produto financeiro isso cheira a golpe — e a fatura no cartão provavelmente também virá como WAYPAY, o que vai gerar chargebacks.
*Fix (10 min, sem código):* Stripe Dashboard → Settings → Business/Public details → mudar public business name e **statement descriptor** para TICKRIFY.

**3. Landing leva ~4,7s para mostrar qualquer conteúdo (FCP 4704ms).**
O hero fica invisível por quase 5 segundos (fade-in + hydration + fonte display). Confirmei em 3 carregamentos: tela preta, depois o texto aparece devagar. Para tráfego frio de Reels/Shorts/TikTok em 4G, isso é bounce em massa antes do primeiro frame. Sua estratégia inteira depende de view → clique → cadastro; esse é o vazamento na porta de entrada.
*Fix (código):* renderizar o hero sem depender de JS/animação (conteúdo visível já no primeiro paint, animação só como enhancement), `font-display: swap`, reduzir duração/delay dos fade-ins para ≤300ms, lazy-load do painel XAUUSD.

### P1 — Vazamentos graves no meio do funil

**4. "Unlock analysis" joga o usuário para a página de pricing pública.**
No pico de intenção ("sua análise está pronta, destrave"), o usuário sai do app e cai numa página de marketing genérica — sem urgência, sem lembrete da análise, sem o EARLY50 aplicado, tendo que escolher plano e clicar de novo. Cada passo extra aqui queima os usuários mais quentes.
*Fix:* modal de upgrade dentro do dashboard com Pro pré-selecionado e 1 clique → Stripe Checkout com EARLY50 pré-aplicado. Após pagar, voltar direto para a análise destravada (success_url com o id da análise).

**5. Banner "Founding Trader — first 50 users lock this price forever" aponta para /pricing, que não menciona a oferta.**
Nenhum contador de vagas, nenhum preço travado, nenhuma menção a founding trader. Promessa quebrada na primeira interação. Ou a oferta existe de verdade (contador real + preço founding visível no pricing), ou o banner sai.

**6. O preview borrado mostra "XAUUSD · M30" para qualquer gráfico.**
Subi um gráfico BTCUSDT 1H e o preview travado mostra XAUUSD M30 — dados fake, e o símbolo errado fica legível através do blur. Trader percebe em 1 segundo e conclui que a "análise pronta" é mentira.
*Fix:* borrar também o header do símbolo, ou (melhor) ecoar o símbolo/timeframe detectados do upload no preview.

**7. E-mail não vem pré-preenchido no Stripe.**
O usuário está logado, mas o checkout pede e-mail em branco. Fricção extra e risco real: se ele digitar outro e-mail, o webhook pode não vincular a assinatura à conta certa.
*Fix:* passar `customer_email` (ou customer) na criação da checkout session + `client_reference_id` com o userId do Clerk.

**8. O produto no Stripe chama-se só "Tickrify".**
"Assinar Tickrify — US$29,00" sem dizer "Pro" nem "150 Ticks/mês". O usuário não tem confirmação de que está comprando o plano certo.
*Fix:* renomear os products no Stripe para "Tickrify Pro — 150 Ticks/mo" etc.

### P2 — Atritos de confiança e oportunidades

**9. FAQ do pricing sabota a venda.** "Can I cancel anytime?" responde "leia os Termos" em vez de **"Yes"** — e cancelamento fácil é a objeção nº1 de qualquer assinatura. "Purchases are final" é duro demais na mesma tela do checkout. Reescrever: "Yes — cancel in one click from your dashboard. You keep your Ticks until the end of the period."
**10. Header deslogado só tem "Login".** Cadê o "Start free" no header? O CTA primário some acima da dobra em páginas internas.
**11. Welcome e-mail do Resend: sem evidência de entrega.** Não encontrei nenhum e-mail do Resend na caixa. Enquanto o domínio não verificar (MX pendente na Hostinger), o remetente fica limitado. Prioridade: terminar o MX e ligar o `sendRecovery()` — o e-mail de recuperação no momento do limite grátis é a automação com maior ROI do funil.
**12. Deep analysis invisível no free.** O free user nunca vê o que é a análise profunda (3 ticks). Mostrar um exemplo travado de deep analysis criaria desejo pelo upgrade — hoje o upsell é abstrato.
**13. Mobile:** não consegui simular viewport de celular na sessão (janela não reduziu). Teste manual no seu iPhone: hero, upload pela câmera e paywall. Com FCP de 4,7s no desktop, mobile provavelmente está pior.

---

## A matemática dos 300 assinantes em 2 meses

Benchmarks realistas para SaaS freemium com paywall duro: visitante → cadastro 8–12%, cadastro → 3 análises usadas 40–60%, limite atingido → pago 5–10%. Ou seja, visitante → pagante ≈ **0,4–0,7%** (com os P0/P1 corrigidos; hoje, com cupom quebrado e checkout "WayPay", é bem menos).

Para 300 assinantes em 60 dias com conversão de 0,5%: **~60.000 cliques no site** (~1.000/dia). Com CTR de conteúdo → site de 1–3% das views: **30k–100k views/dia**. Hoje os reels fazem 1–2k views. Esse é o tamanho real do gap — e ele não se fecha só com copy: se fecha com **distribuição multiplicada + funil sem vazamento**.

Trajetória com crescimento acelerando (a taxa de crescimento sobe semana a semana, como você pediu):

| Semana | Novos assinantes | Acumulado | Cadastros/dia necessários (7% free→paid) |
|---|---|---|---|
| 1 | 5 | 5 | ~10 |
| 2 | 10 | 15 | ~20 |
| 3 | 20 | 35 | ~40 |
| 4 | 30 | 65 | ~60 |
| 5 | 40 | 105 | ~80 |
| 6 | 50 | 155 | ~100 |
| 7 | 65 | 220 | ~130 |
| 8 | 80 | 300 | ~160 |

Sendo direto com você, como conselheiro: **300 em 60 dias partindo de ~50 seguidores e sem budget de ads é um cenário de 5–10% de probabilidade.** Um resultado forte e ainda ambicioso seria 60–100 assinantes ($1.5–3k MRR) com a máquina rodando e taxa de crescimento semanal comprovada — que é o que investidor quer ver, mais do que o número absoluto. Mantenha 300 como meta-estica, mas gerencie pela taxa de crescimento semanal (>30%/semana).

## Plano de execução (ordem exata)

**Dias 1–2 — Estancar o sangramento (P0):** criar EARLY50 no Stripe, trocar WayPay→Tickrify (nome + statement descriptor), fix do FCP do hero, renomear produtos no Stripe, `customer_email` + `client_reference_id` no checkout. Sem isso, cada visitante enviado ao site é desperdiçado.

**Dias 3–5 — Fechar o meio do funil (P1):** modal de upgrade in-app com EARLY50 pré-aplicado e retorno à análise após pagamento; preview travado com símbolo real; oferta Founding Trader de verdade no pricing (contador "X of 50 spots left" — real); FAQ reescrita ("Yes, cancel anytime").

**Dias 5–7 — Automação de receita:** terminar verificação do domínio no Resend (MX na Hostinger — se o form rápido não tem MX, usar a tela de DNS completa ou suporte) e ligar o `sendRecovery()` no momento do `free_limit_reached` com EARLY50 dentro. É o e-mail com maior taxa de conversão que você vai mandar.

**Semanas 2–8 — Distribuição em volume (o gargalo confirmado é tráfego):**
subir de 1 para 2 shorts/dia (mesmo formato faceless que já funciona; YouTube já te deu 4,5k views em 28 dias — dobre a aposta onde há sinal); CTA fixo no frame final + link UTM por canal; Reddit (r/Daytrading, r/Forex — formato "analisei X com IA, aqui está a leitura", sem link direto, link no perfil); **programa de afiliados com 30–40% recorrente** (Rewardful/Tolt em cima do Stripe) mirando micro-influencers de trading de 5–50k seguidores — é o único canal capaz de fechar o gap de 30k+ views/dia sem ads; e revisar a cada domingo: taxa de crescimento semanal de cadastros e de assinantes, decidindo dobrar ou cortar canal pelos UTMs no PostHog.

**Métricas norte (dashboard semanal):** views → cliques (UTM) → cadastros → ativação (1ª análise) → limite atingido → checkout aberto → pago. O funil agora está instrumentado no PostHog; use `free_limit_reached` vs `subscription_activated` como o par que define o negócio.

---

*Notas do teste: deixei a conta tickrify@gmail.com deslogada no Chrome (entre de novo com 1 clique via Google). Não criei conta nova nem completei pagamento — cadastro e compra são ações que ficam com você. O gráfico de teste está em `btc_test_chart.png` nos outputs da sessão.*
