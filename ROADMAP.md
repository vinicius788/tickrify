# Tickrify — Roadmap de Lançamentos

> Documento interno. Atualizado em 29/05/2026.
> Objetivo: validar o produto com usuários reais antes de escalar features sociais.

---

## ✅ Versão atual — v1.0 (Produção)

- Análise de gráfico por IA com sinal BUY/SELL/HOLD
- Painel Técnico com ICT/SMC (Order Blocks, FVGs, Liquidez, HTF Bias)
- Sessões de mercado em tempo real no Painel Técnico
- Planos com Ticks mensais (Starter / Pro / Elite)
- Histórico de análises no dashboard (Meus Trades)
- Auto-retry em caso de lentidão da IA (sem perder Tick)
- Detecção de imagem inválida (não-gráfico)
- Landing page com análises reais em tempo real

---

## 🔜 v1.1 — Comprovante de Resultado

**Objetivo:** transformar o histórico de análises num diário de trade real.

### O que implementar:
- Campo de resultado editável em cada análise: TP1 / TP2 / Stop / Em aberto
- Upload de comprovante (print do resultado da operação)
- Campo de P&L manual: quanto ganhou ou perdeu em % e em R$
- Resumo de performance no dashboard: win rate pessoal, média de R:R, total acumulado

### Por que agora:
- Cria hábito de uso → reduz churn
- Gera dados reais para o Placar Mundial (v1.2)
- Dá ao usuário senso de progresso e histórico próprio

---

## 🔜 v1.2 — Placar Mundial

**Objetivo:** ranking público de performance entre usuários da plataforma.

### O que implementar:
- Leaderboard global com: posição, nome/avatar, win rate, P&L acumulado, nº de operações
- Filtros: semanal / mensal / all-time
- Apenas usuários que submeteram comprovante entram no ranking
- Badge de destaque para top 3 (visual de troféu)
- Base para futuros reconhecimentos físicos (placas) para grandes players

### Dependência:
- Requer v1.1 (comprovante + P&L) funcionando

---

## 🔜 v1.3 — Calendário Econômico no Painel Técnico

**Objetivo:** avisar o trader sobre notícias de alto impacto próximas ao momento da análise.

### O que implementar:
- Ao gerar uma análise, o sistema verifica automaticamente eventos de alto impacto
  nas próximas 2 horas para o par/ativo analisado
- Aparece uma seção no Painel Técnico: **"⚠️ Eventos Econômicos"**
- Exemplos de aviso:
  - `⚠️ NFP (USD) em 18 minutos — Alto impacto. Considere aguardar.`
  - `📅 Decisão de juros do Fed hoje às 15:00 NY — Pode reverter o movimento.`
  - `ℹ️ 1ª sexta do mês — Dia de NFP. Evite entradas 30min antes das 08:30 NY.`
- Fonte de dados: API pública do ForexFactory ou Investing.com (gratuita)
- Aviso também detecta automaticamente datas fixas: toda 1ª sexta do mês (NFP),
  reuniões do Fed, BCE, Banco da Inglaterra

### Por que implementar cedo:
- Não precisa de base de usuários para ter valor
- Melhora cada análise desde o primeiro uso
- Diferencial real: evita que o usuário entre numa operação e leve uma notícia
- Aumenta credibilidade e profissionalismo da plataforma

---

## 🔜 v1.4 — Extensão de Browser

**Objetivo:** capturar o gráfico diretamente do TradingView (ou qualquer plataforma)
sem precisar tirar print e fazer upload manualmente.

### O que implementar:
- Extensão Chrome (Manifest V3) com botão flutuante
- Um clique captura o gráfico da aba ativa e envia para a API da Tickrify
- Análise retorna direto no painel da extensão, sem sair do TradingView
- Login via Clerk (mesmo sistema da plataforma)
- Suporte inicial: Chrome e Edge
- Fase 2: Safari (requer conta Apple Developer, processo diferente)

### Por que é o maior diferencial do roadmap:
- Remove o maior atrito do produto atual: tirar print → abrir Tickrify → fazer upload
- Usuário analisa sem sair do gráfico
- Nenhum concorrente direto tem isso ainda

---

## ❌ Fora do roadmap (decisão tomada)

- **Chat entre usuários** — substituído por comunidade no Twitter/X
  (menos complexidade, menos moderação, zero custo de infraestrutura)

---

## Ordem de prioridade recomendada

| # | Feature | Esforço | Impacto | Quando |
|---|---------|---------|---------|--------|
| 1 | Calendário Econômico (v1.3) | Baixo | Alto | Próxima sprint |
| 2 | Comprovante + P&L (v1.1) | Médio | Alto | Após validação |
| 3 | Placar Mundial (v1.2) | Médio | Médio | Após v1.1 |
| 4 | Extensão Chrome (v1.4) | Alto | Muito Alto | Quando tiver base |

---

*Para iniciar qualquer implementação, envie este arquivo e indique qual versão começar.*
