# Playbook Tickrify — Instagram → Ativação (PT + EN)

**Objetivo:** transformar comentário no Instagram em usuário que **entra, usa e volta** — e só então pensa em pagar.

**A virada de chave (o que os dados mostraram):** dos teus ~20 cadastros, quase todos entraram **uma vez** e nunca voltaram (no Clerk, "último login" = data de cadastro em todos). O furo **não é no pagamento** — é no "voltar". Logo, o trabalho é em dois pontos: **trazer com intenção** (Instagram) e **fazer a primeira experiência grudar** (onboarding). Vender vem como consequência.

```
  INSTAGRAM                    APP (login/onboarding)              VOLTA
  Reel mostra a mágica   →     1ª análise em segundos        →    e-mail / motivo
  "comenta X"            →     "uau, isso é útil"            →    pra voltar amanhã
  DM com o link          →     2 análises grátis restantes   →    vira pagante
```

---

# PARTE 1 — INSTAGRAM (trazer com intenção)

## 1.1 O gancho (a oferta)
A oferta NÃO é "conheça a Tickrify". É **resultado grátis e imediato**:

> "Me manda teu gráfico que a IA te devolve a análise profissional — entrada, stop e alvo — em segundos. De graça."

O lead magnet são as **3 análises grátis**. O Reel tem que MOSTRAR uma análise real acontecendo (a tela da Tickrify cuspindo BUY/SELL com os níveis). Gente compra o que vê funcionando.

## 1.2 A mecânica: comentário → DM com o link
**Por que comentário→DM e não link na bio:** quem comenta tem intenção alta, o algoritmo do Instagram entrega mais o post que recebe comentário, e a DM chega individual (conversão muito maior que bio).

**Comece manual (hoje):** você mesmo responde cada comentário com a DM. Funciona perfeito até ~30-50 comentários/dia e valida tudo sem instalar nada.

**Automatize depois (quando crescer):** o **ManyChat** (plano grátis) faz: "comentou a palavra X → DM automática com o link". Conecta numa conta Instagram Profissional/Business. Só vale a pena depois que o volume justificar — não trava nada agora.

**Regra de ouro:** sempre peça a palavra-chave no comentário ("comenta ANÁLISE"). Isso (a) dispara a automação depois, (b) infla o engajamento do post, (c) filtra quem tem real interesse.

## 1.3 Legendas de Reel/Post (copie e cole)

### 🇧🇷 Português

**Variação A (resultado):**
> A IA analisou esse gráfico em 4 segundos e apontou a entrada, o stop e o alvo. 📈
> Eu levava 20 minutos pra fazer isso na mão.
> Quer testar no TEU gráfico? Comenta **ANÁLISE** que eu te mando o link — as 3 primeiras são de graça. 👇

**Variação B (dor):**
> Você já entrou numa compra e tomou stop "do nada"? Quase sempre é liquidez que você não viu.
> Essa IA marca a liquidez, a estrutura e te diz se vale ou não entrar.
> Comenta **ANÁLISE** que eu te mando o link pra testar no teu gráfico. 👇

**Variação C (prova/curiosidade):**
> Joguei o mesmo gráfico de BTC pra IA e pro meu amigo trader. A IA achou o que ele não viu.
> Quer ver o que ela acha do teu? Comenta **ANÁLISE**. Mando o link na DM. 🔗

### 🇺🇸 English

**Variant A (result):**
> This AI read the chart in 4 seconds and gave the entry, stop and target. 📈
> It used to take me 20 minutes by hand.
> Want it on YOUR chart? Comment **ANALYZE** and I'll DM you the link — first 3 are free. 👇

**Variant B (pain):**
> Ever bought and got stopped out "out of nowhere"? It's usually liquidity you didn't see.
> This AI maps the liquidity and structure and tells you if the trade is worth it.
> Comment **ANALYZE** and I'll DM you the link to try it on your chart. 👇

**Variant C (proof/curiosity):**
> I gave the same BTC chart to the AI and to my trader friend. The AI caught what he missed.
> Want to see what it says about yours? Comment **ANALYZE** — link in your DMs. 🔗

## 1.4 A mensagem de DM (a parte que converte)
Curta, sem rodeio, com o link e o que fazer. Nada de parágrafo gigante.

### 🇧🇷 Português
> Opa! Aqui é o link 👉 https://tickrify.com/?ref=ig
>
> É só entrar, jogar um print do teu gráfico e a IA te devolve a análise completa (entrada, stop, alvo). As 3 primeiras são de graça, sem cartão.
>
> Faz uma agora e me conta o que achou! 🚀

### 🇺🇸 English
> Hey! Here's the link 👉 https://tickrify.com/?ref=ig
>
> Just sign in, drop a screenshot of your chart, and the AI gives you the full read (entry, stop, target). First 3 are free, no card needed.
>
> Run one now and tell me what you think! 🚀

## 1.5 Link rastreável (pra você medir depois)
Use sempre **https://tickrify.com/?ref=ig** nas DMs. Esse `?ref=ig` deixa a gente medir, lá na frente, quanto do tráfego veio do Instagram. (Mais tarde dá pra ter `?ref=ig_reelX` por campanha.)

## 1.6 Ritmo que funciona
- **1 Reel a cada 1–2 dias** mostrando uma análise real (a tela em ação).
- Responda TODO comentário com a DM em até 1h (intenção esfria rápido).
- Fixe (pin) o melhor Reel no topo do perfil.
- Na bio: 1 linha de promessa + o link (pra quem não comenta).

---

# PARTE 2 — LOGIN / ONBOARDING (fazer a primeira experiência grudar)

**Problema atual:** a pessoa entra, cai num painel, não sabe o que fazer, e some. A primeira análise precisa acontecer em **segundos** e terminar com um motivo pra voltar.

## 2.1 Spec da primeira experiência (o que mudar no app)
*(isto é o "roteiro" do que eu implemento na próxima — você só aprova)*

1. **Tela de boas-vindas de 1 passo:** logou pela primeira vez → em vez do painel vazio, uma tela única: *"Bem-vindo! Jogue um print do seu gráfico aqui e receba sua primeira análise grátis."* com a área de upload em destaque.
2. **Botão "Ver um exemplo agora":** pra quem não tem um gráfico à mão, um botão que roda uma análise de exemplo (BTC) na hora. Tira o atrito do "não sei o que fazer" — a pessoa vê a mágica em 1 clique.
3. **A primeira análise é a heroína:** rápida, visual, com os níveis claros. No fim dela, dois CTAs: *"Analise outro ativo"* e *"Salvar na watchlist"*.
4. **Mostrar o que ela ganha e o que falta:** *"Você tem 2 análises grátis restantes"* — cria valor + leve urgência, sem empurrar pagamento na cara.
5. **Motivo pra voltar:** ao fim, oferecer *"Quer que eu te avise quando aparecer um setup nesse ativo?"* (captura intenção e dá razão de retorno). Mesmo que simples no começo.

> Quando você aprovar, eu transformo isso em código com o mesmo cuidado de sempre (sem quebrar nada, validado) e a gente sobe.

## 2.2 Princípio
A meta da primeira sessão é UMA frase na cabeça do usuário: **"caramba, isso é bom, vou voltar."** Tudo acima serve a isso.

---

# PARTE 3 — E-MAIL DE REENGAJAMENTO (trazer os 17 de volta)

Você tem o e-mail dos 17 no Clerk. Eles já demonstraram interesse (cadastraram). Um e-mail curto, de fundador, traz parte deles de volta — é o ganho mais rápido que existe.

**Como enviar (simples):** Gmail, com os 17 e-mails em **Cco (BCC)**, assunto + corpo abaixo. Para algo mais bonito/rastreável depois, dá pra usar Resend ou Mailchimp — mas pra 17 pessoas, Gmail resolve hoje.

### 🇧🇷 Português
**Assunto:** Suas 3 análises grátis ainda estão aqui 👀

> Oi! Aqui é o Vini, da Tickrify.
>
> Vi que você criou sua conta mas ainda não usou suas análises grátis — e elas continuam te esperando (3, sem cartão).
>
> É só jogar um print do seu gráfico e a IA te devolve entrada, stop e alvo em segundos. Acabei de melhorar a leitura de **liquidez** e os pontos de entrada — ficou bem mais preciso.
>
> 👉 https://tickrify.com/?ref=email
>
> Faz uma análise e me responde aqui dizendo o que achou. Leio todas.
>
> Abraço,
> Vini

### 🇺🇸 English
**Subject:** Your 3 free analyses are still waiting 👀

> Hi! It's Vini from Tickrify.
>
> I noticed you created your account but haven't used your free analyses yet — and they're still here for you (3, no card needed).
>
> Just drop a screenshot of your chart and the AI gives you entry, stop and target in seconds. I just improved the **liquidity** read and the entry points — it's a lot sharper now.
>
> 👉 https://tickrify.com/?ref=email
>
> Run one and hit reply telling me what you think. I read every message.
>
> Cheers,
> Vini

---

# ORDEM DE EXECUÇÃO (sem se perder)

**Hoje / esta semana — o que dá pra fazer sozinho, sem código:**
1. ✅ Enviar o **e-mail de reengajamento** pros 17 (Gmail, BCC). Ganho mais rápido.
2. ✅ Gravar **1 Reel** mostrando uma análise real + legenda da Parte 1.3 com "comenta ANÁLISE".
3. ✅ Responder cada comentário com a **DM** da Parte 1.4 (link com `?ref=ig`).
4. ✅ Atualizar a **bio** com a promessa + link.

**Comigo (próximo passo, com código):**
5. ⏳ Eu implemento o **onboarding da 1ª análise** (Parte 2) — você aprova o roteiro e eu subo.
6. ⏳ Quando o volume crescer, a gente liga o **ManyChat** (comentário→DM automático).

**Pra medir (amarra com analytics):**
7. ⏳ Segunda, rodamos o script de funil pra ver os números reais (quantos ativaram, quantos pagaram).
8. ⏳ Depois, PostHog pra ver o comportamento dentro do app (onde clicam, onde param).

---

# COMO SABER SE ESTÁ FUNCIONANDO
- **Instagram funcionando:** comentários por Reel subindo + DMs respondidas → cliques no link `?ref=ig`.
- **Onboarding funcionando:** no Clerk, "último login" deixando de ser igual à data de cadastro (gente VOLTANDO). Hoje é ~0; qualquer retenção já é vitória.
- **Vendendo:** no Stripe, checkouts iniciados e pagamentos. Mas isso só vem DEPOIS que a galera começa a voltar.

**Regra mãe:** não otimize o pagamento enquanto a retenção for ~0. Primeiro faça a galera VOLTAR. O resto vem.
