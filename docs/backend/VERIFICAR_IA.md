# 🤖 Como Verificar se a IA está Analisando Corretamente

## ✅ Correções Aplicadas

### 1. Sistema de Prompt Atualizado

**No `ai.adapter.ts`:**
- ✅ Message de sistema reforçada: "SEMPRE analise a imagem de forma REAL e DETALHADA"
- ✅ `detail: 'high'` na image_url (força análise detalhada)
- ✅ `max_tokens: 2000` (espaço para análise completa)
- ✅ `temperature: 0.3` (respostas mais precisas, menos criativas)

**No `ai.worker.ts`:**
- ✅ Busca prompt do banco de dados (v1 = multi-agente completo)
- ✅ Fallback para prompt simplificado se DB falhar
- ✅ Logs detalhados para debug

**No `seed.ts`:**
- ✅ Prompt v1 (ATIVO): Sistema multi-agente completo de 540 linhas
- ✅ Prompt v2 (INATIVO): Simplificado para testes rápidos

---

## 🔍 Como Testar se a IA Analisa Corretamente

### 1. Preparação

**a) Configurar OpenAI:**
```bash
# Edite: apps/backend/.env
OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE  # Sua chave da OpenAI
OPENAI_MODEL=gpt-4o      # ou gpt-4-vision-preview
```

**b) Rodar Migrations:**
```bash
cd /Users/vini.mqs/Documents/tickrify_novo/apps/backend
npm run migrate
```

**c) Rodar Seed (carregar prompts):**
```bash
npm run seed
```

Você deve ver:
```
✅ Prompt v1 (Production Multi-Agent) criado
✅ Prompt v2 (Simplified) criado
```

---

### 2. Iniciar Backend + Worker

**Terminal 1 - Backend:**
```bash
cd /Users/vini.mqs/Documents/tickrify_novo/apps/backend
npm run dev
```

**Terminal 2 - Worker (processa análises):**
```bash
cd /Users/vini.mqs/Documents/tickrify_novo/apps/backend
npm run worker
```

Deve aparecer:
```
🚀 AI Worker started and listening for jobs...
```

---

### 3. Teste Real com Imagem

**Opção A: Via API (recomendado)**

Use um cliente HTTP como Postman, Insomnia ou curl:

```bash
# 1. Fazer upload de imagem
curl -X POST http://localhost:3001/api/ai/analyze \
  -H "Authorization: Bearer SEU_TOKEN_CLERK" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@/caminho/para/grafico.png"

# 2. Verificar resultado
curl http://localhost:3001/api/ai/ANALYSIS_ID \
  -H "Authorization: Bearer SEU_TOKEN_CLERK"
```

**Opção B: Via Frontend**

1. Acesse http://localhost:5173
2. Faça login
3. Vá para "Nova Análise"
4. Faça upload de um gráfico de trading
5. Aguarde a análise

---

### 4. O que Esperar (Análise REAL vs FAKE)

#### ✅ ANÁLISE REAL (Correta):

```json
{
  "recommendation": "BUY",
  "confidence": 78,
  "reasoning": "Análise baseada em estrutura observada no gráfico:

ESTRUTURA:
- Preço em downtrend de curto prazo testando suporte em 42.150
- Formação de Higher Low visível nos últimos 15 candles
- Possível reversão em curso

PADRÕES:
- Hammer bullish formado no último candle (sombra inferior 2.5x o corpo)
- Candle anterior foi doji indicando indecisão
- Padrão Morning Star parcialmente formado

NÍVEIS TÉCNICOS:
- Suporte: 42.000 (testado 3x nas últimas 48h)
- Resistência: 43.500 (topo anterior)
- Preço atual: 42.180

CONFLUÊNCIA: 65/100
- Estrutura: 11/12 pontos (tendência se invertendo)
- Padrões: 12/15 pontos (hammer forte em suporte)
- Níveis: 10/12 pontos (em suporte major)
- Contexto: 7/10 pontos (timeframe 1H adequado)

RECOMENDAÇÃO: BUY
Entry: 42.200
Stop Loss: 41.850 (abaixo do swing low)
Take Profit 1: 42.900 (1:2 R:R)
Take Profit 2: 43.500 (resistência)

Risk/Reward: 1:2.5"
}
```

**Características de análise REAL:**
- ✅ Menciona preços específicos visíveis no gráfico
- ✅ Descreve padrões de candlestick REAIS (ex: "hammer com sombra 2.5x o corpo")
- ✅ Calcula confluência (score de 0-100)
- ✅ Define entry, stop e TP baseados em níveis técnicos
- ✅ Risk/Reward calculado
- ✅ Justificativa detalhada e estruturada

#### ❌ ANÁLISE FAKE (Genérica/Padrão):

```json
{
  "recommendation": "HOLD",
  "confidence": 50,
  "reasoning": "O gráfico mostra um movimento lateral. Recomendo aguardar uma confirmação de tendência antes de operar."
}
```

**Características de análise FAKE:**
- ❌ Resposta genérica sem detalhes
- ❌ Não menciona preços ou níveis específicos
- ❌ Não identifica padrões de candlestick
- ❌ Confidence sempre 50 (meio termo)
- ❌ Não define entry, stop, TP
- ❌ Reasoning vago e superficial

---

### 5. Logs para Verificar

**No Worker (Terminal 2), você deve ver:**

```bash
[Worker] Processing analysis abc123...
[Worker] Using prompt version: 1
[Worker] Raw AI response: {
  "recommendation": "BUY",
  "confidence": 78,
  "reasoning": "Análise baseada em estrutura..."
}
[Worker] AI Response: { recommendation: 'BUY', confidence: 78, ... }
✅ [Worker] Job abc123 completed successfully
```

**Se estiver CORRETO:**
- ✅ "Using prompt version: 1" (usa prompt completo)
- ✅ "Raw AI response" com JSON estruturado
- ✅ Reasoning detalhado (200+ caracteres)

**Se estiver ERRADO:**
- ❌ Timeout ou erro do OpenAI
- ❌ Response vazio ou muito curto
- ❌ "Failed to analyze image with AI"

---

### 6. Verificar Prompt Ativo no Banco

```bash
# Entre no Prisma Studio
cd /Users/vini.mqs/Documents/tickrify_novo/apps/backend
npm run studio
```

1. Abra http://localhost:5555
2. Clique em `PromptConfig`
3. Verifique:
   - ✅ Versão 1 está com `isActive: true`
   - ✅ Campo `prompt` tem ~21.000 caracteres (prompt completo)
   - ✅ Versão 2 está com `isActive: false`

---

### 7. Testar com Gráficos Diferentes

**Teste A: Gráfico em Uptrend**
- Upload: Gráfico com clara alta
- Espera: `BUY` ou `HOLD` (nunca `SELL`)
- Reasoning deve mencionar: "uptrend", "higher highs"

**Teste B: Gráfico em Downtrend**
- Upload: Gráfico com clara baixa
- Espera: `SELL` ou `HOLD` (nunca `BUY`)
- Reasoning deve mencionar: "downtrend", "lower lows"

**Teste C: Gráfico Lateral**
- Upload: Gráfico em range
- Espera: `HOLD` com reasoning sobre "consolidação", "aguardar breakout"

**Teste D: Padrão de Reversão**
- Upload: Hammer em suporte ou Shooting Star em resistência
- Espera: Identificação específica do padrão no reasoning

---

### 8. Alternar Entre Prompts (Teste)

**Ativar prompt simplificado (v2):**
```bash
curl -X POST http://localhost:3001/api/prompts/2/activate \
  -H "Authorization: Bearer SEU_TOKEN_CLERK"
```

**Voltar para prompt completo (v1):**
```bash
curl -X POST http://localhost:3001/api/prompts/1/activate \
  -H "Authorization: Bearer SEU_TOKEN_CLERK"
```

Compare resultados com mesmo gráfico!

---

## 🚨 Problemas Comuns

### IA retorna sempre HOLD com confidence 50

**Causa:** OpenAI não está analisando a imagem corretamente

**Solução:**
1. Verificar se `OPENAI_API_KEY` está correto
2. Verificar se modelo suporta visão (`gpt-4o` ou `gpt-4-vision-preview`)
3. Verificar se imagem está acessível (URL pública se for URL)
4. Tentar com `gpt-4o` em vez de `gpt-4-vision-preview`

### Reasoning sempre muito curto

**Causa:** Prompt não está sendo usado ou `max_tokens` baixo

**Solução:**
1. Verificar logs do worker: "Using prompt version: 1"
2. Verificar no Prisma Studio se prompt v1 existe
3. Rodar seed novamente: `npm run seed`
4. Reiniciar worker

### Worker não processa jobs

**Causa:** Redis não conectado ou fila não configurada

**Solução:**
1. Verificar se Redis está rodando: `redis-cli ping` (deve retornar PONG)
2. Verificar `.env`: `REDIS_HOST` e `REDIS_PORT`
3. Reiniciar worker

---

## ✅ Checklist de Verificação

- [ ] OpenAI API Key configurada
- [ ] Modelo `gpt-4o` ou `gpt-4-vision-preview`
- [ ] Migrations rodadas (`npm run migrate`)
- [ ] Seed executado (`npm run seed`)
- [ ] Prompt v1 ativo no banco (verificar no Prisma Studio)
- [ ] Backend rodando (porta 3001)
- [ ] Worker rodando e "listening for jobs"
- [ ] Redis conectado
- [ ] Testado com gráfico real
- [ ] Reasoning tem 200+ caracteres
- [ ] Confidence varia (não é sempre 50)
- [ ] Entry, Stop, TP definidos
- [ ] Padrões de candlestick identificados

---

## 📊 Exemplo de Teste Completo

```bash
# 1. Configurar tudo
cd apps/backend
npm run migrate
npm run seed

# 2. Terminal 1 - Backend
npm run dev

# 3. Terminal 2 - Worker
npm run worker

# 4. Terminal 3 - Teste
curl -X POST http://localhost:3001/api/ai/analyze \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@grafico.png"

# Copiar o ID retornado

# 5. Aguardar 10-30 segundos

# 6. Consultar resultado
curl http://localhost:3001/api/ai/ANALYSIS_ID \
  -H "Authorization: Bearer TOKEN"

# 7. Verificar:
# - recommendation: BUY/SELL/HOLD baseado no gráfico
# - confidence: número realista (não sempre 50)
# - reasoning: detalhado (200+ caracteres)
```

---

## 🎯 Resultado Esperado

Quando estiver funcionando corretamente:

✅ Cada gráfico terá análise ÚNICA
✅ Reasoning específico para aquele gráfico
✅ Padrões de candlestick identificados corretamente
✅ Níveis de preço mencionados
✅ Confluência calculada (0-100)
✅ Entry, Stop, TP baseados em técnica
✅ Risk/Reward calculado

**A IA DEVE "VER" o gráfico e analisar de verdade!**

---

**Criado em:** 04/11/2025  
**Versão:** 1.0  
**Prompt Ativo:** v1 (Multi-Agente 540 linhas)

