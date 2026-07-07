# Guia de Execução — Vídeos Tickrify, passo a passo
**Leia junto com:** `Estrategia_Video_30_Dias.md` (o quê e por quê) e `Tickrify_Video_Tracker.xlsx` (onde registrar). Este arquivo é o COMO, clique por clique.

---

## PARTE 0 — Setup (faz UMA vez, hoje, ~40 min)

### 0.1 Criar os 3 links com UTM (5 min)
Copie exatamente estes links — cada canal tem o seu, NUNCA misture:

- Instagram: `https://tickrify.com/?utm_source=ig&utm_medium=bio`
- TikTok: `https://tickrify.com/?utm_source=tt&utm_medium=bio`
- YouTube: `https://tickrify.com/?utm_source=yt&utm_medium=bio`

### 0.2 Colocar os links nas bios (10 min)
- **Instagram:** app → seu perfil → Editar perfil → Links → Adicionar link externo → colar o link `utm_source=ig` → Salvar.
- **TikTok:** perfil → Editar perfil → Site → colar o link `utm_source=tt`. (Se o campo Site não aparecer, mude a conta para Business: Configurações → Conta → Mudar para conta Business — é grátis.)
- **YouTube:** YouTube Studio (studio.youtube.com) → Personalização → Informações básicas → Links → adicionar "Free AI chart analysis" com o link `utm_source=yt` → Publicar. Além disso, em CADA Short, cole o link no primeiro comentário e fixe (os Shorts não mostram bio facilmente).

### 0.3 Instalar as ferramentas (15 min)
1. **Cursorful** (grátis): chrome.google.com/webstore → busque "Cursorful" → Adicionar ao Chrome. Ele grava a tela com zoom automático no cursor.
2. **CapCut** (grátis, desktop): capcut.com → download para Mac → instalar → criar conta.
3. No CapCut: aba **Templates** → busque "trading" ou "crypto alert" → salve 2–3 templates com texto grande e cortes rápidos nos favoritos. Você vai reutilizar o MESMO template todos os dias.

### 0.4 Preparar a pasta de trabalho (5 min)
Crie no Mac: `~/Videos/Tickrify/` com subpastas `gravacoes/`, `prontos/`, `graficos/`. Salve em `graficos/` 10 prints de gráficos famosos (TradingView: BTC mar/2020, ouro 2024, NVDA earnings, EURUSD, SP500 — tire print da tela cheia, sem seu nome de usuário visível).

### 0.5 Conferir a conta Tickrify (2 min)
Você está com PRO ativo e 149 ticks até 6/ago — cada vídeo gasta 1 tick na análise real. Dá para gravar ~140 vídeos de graça. Use a conta logada no Chrome.

---

## PARTE 1 — Rotina diária de produção (~20 min por vídeo)

### Passo 1 — Gravar a análise (5 min)
1. Abra o Chrome em tela cheia → tickrify.com/dashboard → New Analysis.
2. Clique no ícone do **Cursorful** (canto do Chrome) → Start recording → escolha "Tab".
3. Arraste o print do gráfico do dia (da pasta `graficos/`) para o upload.
4. Clique **Analyze chart** e NÃO mexa no mouse enquanto processa (o loading "Classifying chart type…" é cinematográfico, deixa gravar).
5. Quando o resultado aparecer, role devagar: BUY/SELL → confidence → entry → stop → TP1/TP2. Passe o mouse em cima de cada número (o Cursorful dá zoom onde o cursor está).
6. Pare a gravação → o Cursorful baixa o .mp4 → mova para `gravacoes/`.

### Passo 2 — Montar no CapCut (10 min)
1. Abra o CapCut → seu template salvo → Substituir mídia.
2. **Estrutura fixa do vídeo (15–30s):**
   - 0–2s: print do gráfico PARADO + texto do hook em fonte grande branca/verde (pegue o hook do dia na aba "Hooks" da planilha). Ex.: *"This candle liquidated $1B"*
   - 2–5s: zoom lento no gráfico + texto: *"Would you BUY or SELL?"*
   - 5–8s: texto: *"I asked the AI."* + corte seco
   - 8–22s: sua gravação do Cursorful (acelere 1.5x se passar de 15s) mostrando o resultado
   - 22–27s: tela final: logo Tickrify + texto *"3 free analyses. No card. Link in bio."*
3. **Formato:** 9:16, 1080×1920. Música: qualquer trending do próprio CapCut (sem copyright).
4. Exportar → 1080p, 30fps → salvar em `prontos/` com nome `V001_btc_hook1.mp4` (numere sempre).

### Passo 3 — Postar nos 3 canais (5 min, sempre no mesmo horário — fixe 20h Brasília = 19h ET)
- **YouTube Shorts:** app YouTube → + → Enviar vídeo → escolher o mp4 → título = o hook em inglês + "#shorts" → descrição: 1 linha + link utm_source=yt → Publicar. Depois: abrir o Short → comentar o link → segurar no comentário → Fixar.
- **Instagram Reels:** app IG → + → Reel → escolher o mp4 → legenda: hook + "Free AI analysis 🔗 in bio" + #trading #forex #daytrading → Compartilhar.
- **TikTok:** app → + → Upload → mesmo esquema, legenda curta + 3 hashtags → Publicar.

### Passo 4 — Registrar na planilha (2 min)
Abra `Tickrify_Video_Tracker.xlsx` → aba **Videos** → 3 linhas novas (uma por plataforma): data, plataforma, conceito, hook usado, ativo, CTA, link do post. Deixe as colunas de métricas vazias por enquanto.

---

## PARTE 2 — Coleta de métricas (48h depois de cada post, 5 min)

Onde encontrar cada número:

- **YouTube:** YouTube Studio app → Conteúdo → o Short → Views, likes, comentários.
- **Instagram:** o Reel → Ver insights → Visualizações, curtidas, comentários.
- **TikTok:** o vídeo → ... → Análises → Views etc.
- **Cliques e cadastros (o número que importa):** app.posthog.com → Activity → filtro: evento `landing_view` → propriedade `utm_source` = ig/yt/tt → contar do período. Cadastros: mesmo filtro no evento `signup_completed`.

Preencha as colunas H–L da linha do vídeo. As taxas (engajamento, CTR, conversão) calculam sozinhas.

---

## PARTE 3 — Ritual de domingo (20 min, toda semana, sem exceção)

1. Abra a aba **Semana** do tracker → preencha a linha da semana: vídeos postados, soma de views, soma de cliques, soma de cadastros (a planilha calcula CTR, conversão, cliques/dia e se bateu a meta).
2. Aplique as regras (estão na aba Protocolo):
   - Vídeo com 2x a mediana de views → **refazer o conceito** com outro gráfico em 48h.
   - Hook com 3 usos e CTR < 0,5% → marcar "aposentado" na aba Hooks.
   - Plataforma com 5+ posts e 0 cliques → vira repost; dobre a produção na líder.
3. Atualize a aba **Hooks**: vezes usado, views médias, CTR médio de cada um.
4. Me mande um print das abas Semana e Videos — eu analiso com você e a gente decide a pauta da semana seguinte.

---

## Checklist do primeiro dia (amanhã)

- [ ] Setup completo (Parte 0 inteira)
- [ ] Gravar V001: gráfico BTC crash + hook "This candle liquidated $1B"
- [ ] Montar no CapCut seguindo a estrutura fixa
- [ ] Postar 20h nos 3 canais (YT primeiro)
- [ ] Registrar as 3 linhas na planilha
- [ ] Depois de amanhã 20h: preencher as métricas de 48h

**Regra de ouro repetida:** mesmo formato, mesmo horário, um hook diferente por dia. A consistência é o que ensina o algoritmo — e a planilha é o que ensina você.
