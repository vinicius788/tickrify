# 🤖 Sistema de Prompts de IA - TICRIF

Este documento explica como funciona o sistema de versionamento de prompts e como gerenciá-lo.

## 📋 Visão Geral

O TICRIF usa um sistema sofisticado de prompts versionados para a análise de IA. O prompt principal é um **sistema multi-agente** com 7 agentes especializados que analisam diferentes aspectos dos gráficos de trading.

### Arquitetura Multi-Agente

O sistema é composto por:

1. **CHART_INSPECTOR** - Validação de qualidade da imagem
2. **STRUCTURE_ANALYST** - Análise de estrutura de mercado
3. **PATTERN_RECOGNITION** - Reconhecimento de padrões
4. **PRICE_ACTION_ANALYST** - Análise de price action puro
5. **RISK_MANAGER** - Gestão de risco técnico
6. **CONFLUENCE_ENGINE** - Motor de confluência
7. **DECISION_SYNTHESIZER** - Sintetizador de decisão final

## 🗂️ Versões de Prompt

### Versão 1 (Production) - ATIVO por padrão

**Arquivo:** `src/common/prompts/trading-system-prompt.ts`

**Descrição:** Sistema multi-agente completo de análise técnica avançada

**Características:**
- ✅ 7 agentes especializados trabalhando em conjunto
- ✅ Análise adaptativa (com/sem indicadores)
- ✅ Sistema de scoring de confluência (0-100 pontos)
- ✅ Threshold de 60 pontos para operação
- ✅ Gestão de risco integrada
- ✅ Suporte para naked charts (price action puro)
- ✅ Detecção automática de elementos visuais
- ✅ Output JSON estruturado

**Tamanho:** ~50KB de texto

**Complexidade:** Alta - Análise profunda e completa

**Tempo de resposta:** 5-15 segundos (dependendo da OpenAI)

**Ideal para:** 
- Produção
- Análises de alta qualidade
- Traders profissionais

---

### Versão 2 (Simplified) - INATIVO

**Descrição:** Versão simplificada para testes rápidos

**Características:**
- ✅ Análise direta e objetiva
- ✅ Output JSON simples
- ✅ Foco em padrões básicos
- ✅ Rápido de processar

**Tamanho:** ~1KB de texto

**Complexidade:** Baixa - Análise básica

**Tempo de resposta:** 3-7 segundos

**Ideal para:**
- Desenvolvimento e testes
- Prototipagem
- Análises rápidas

---

## 🔧 Gerenciamento de Prompts

### Listar todos os prompts

```bash
GET /api/prompts/list
Authorization: Bearer TOKEN
```

**Response:**
```json
[
  {
    "id": "clxxx123",
    "version": 1,
    "prompt": "...",
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00Z"
  },
  {
    "id": "clxxx456",
    "version": 2,
    "prompt": "...",
    "isActive": false,
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

---

### Buscar prompt ativo

```bash
GET /api/prompts/latest
```

**Response:**
```json
{
  "id": "clxxx123",
  "version": 1,
  "prompt": "...",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

---

### Buscar por versão específica

```bash
GET /api/prompts/2
```

**Response:**
```json
{
  "id": "clxxx456",
  "version": 2,
  "prompt": "...",
  "isActive": false,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

---

### Criar nova versão de prompt

```bash
POST /api/prompts/config
Authorization: Bearer TOKEN
Content-Type: application/json

{
  "prompt": "Seu novo prompt customizado aqui...",
  "setActive": false
}
```

**Response:**
```json
{
  "id": "clxxx789",
  "version": 3,
  "prompt": "Seu novo prompt...",
  "isActive": false,
  "createdAt": "2024-01-01T12:00:00Z"
}
```

**Nota:** Se `setActive: true`, todos os outros prompts serão desativados automaticamente.

---

### Ativar uma versão específica

```bash
POST /api/prompts/2/activate
Authorization: Bearer TOKEN
```

**Response:**
```json
{
  "id": "clxxx456",
  "version": 2,
  "prompt": "...",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**Efeito:** Desativa todas as outras versões e ativa a versão 2.

---

## 🧪 Testing de Prompts

### Usar prompt override em análise

Você pode testar um prompt específico sem criar uma versão nova:

```bash
POST /api/ai/analyze
Authorization: Bearer TOKEN
Content-Type: multipart/form-data

image: [arquivo]
promptOverride: "Seu prompt de teste aqui..."
```

**Vantagens:**
- ✅ Não salva no banco
- ✅ Teste rápido de variações
- ✅ Não afeta outras análises
- ✅ Ideal para experimentação

---

## 📊 Comparação de Versões

| Aspecto | v1 (Multi-Agent) | v2 (Simplified) |
|---------|------------------|-----------------|
| **Complexidade** | Alta | Baixa |
| **Tempo Resposta** | 5-15s | 3-7s |
| **Qualidade** | Excelente | Boa |
| **Detalhamento** | Muito alto | Médio |
| **Confluência** | Sistema completo | N/A |
| **Gestão Risco** | Integrada | Básica |
| **Custo OpenAI** | Maior (tokens) | Menor |
| **Uso Recomendado** | Produção | Desenvolvimento |

---

## 🎯 Recomendações

### Quando usar v1 (Multi-Agent)

✅ **USE v1 quando:**
- Análises para clientes pagantes
- Precisão é crítica
- Necessita justificativa detalhada
- Confluência técnica é importante
- Gestão de risco deve ser precisa

### Quando usar v2 (Simplified)

✅ **USE v2 quando:**
- Desenvolvimento local
- Testes rápidos
- Economia de custos OpenAI
- Prototipagem de features
- Demo/MVP

---

## 🔄 Workflow de Atualização de Prompt

### Cenário: Melhorar o prompt de produção

1. **Criar nova versão (v3) INATIVA:**
```bash
POST /api/prompts/config
{
  "prompt": "Versão melhorada do sistema...",
  "setActive": false
}
```

2. **Testar com override:**
```bash
POST /api/ai/analyze
promptOverride: "[conteúdo da v3]"
```

3. **Se aprovado, ativar:**
```bash
POST /api/prompts/3/activate
```

4. **Se problema, voltar para v1:**
```bash
POST /api/prompts/1/activate
```

---

## 🛠️ Estrutura do Prompt v1

### Seções Principais

```
1. ARQUITETURA DO SISTEMA
   ├── Descrição geral
   └── Lista de agentes

2. AGENTES ESPECIALIZADOS
   ├── 1. CHART_INSPECTOR
   ├── 2. STRUCTURE_ANALYST
   ├── 3. PATTERN_RECOGNITION
   ├── 4. PRICE_ACTION_ANALYST
   ├── 5. RISK_MANAGER
   ├── 6. CONFLUENCE_ENGINE
   └── 7. DECISION_SYNTHESIZER

3. PROTOCOLO DE RESPOSTA
   └── Formato JSON obrigatório

4. REGRAS CRÍTICAS
   ├── O que SEMPRE fazer
   └── O que NUNCA fazer

5. PRINCÍPIOS DE TRADING
   └── 10 princípios fundamentais

6. GLOSSÁRIO TÉCNICO
```

### Sistema de Scoring

**Confluência Adaptativa:**

| Cenário | Estrutura | Padrões | Indicadores | Níveis | Contexto |
|---------|-----------|---------|-------------|--------|----------|
| **COM indicadores** | 30% | 25% | 20% | 15% | 10% |
| **SEM indicadores** | 35% | 30% | 0% | 25% | 10% |

**Threshold:**
- ≥ 60 pontos = BUY/SELL
- < 60 pontos = HOLD

---

## 📝 Logs do Worker

O worker loga qual versão de prompt está usando:

```bash
[Worker] Processing analysis clxxx123
[Worker] Using prompt version: 1
[Worker] Using active prompt version 1
[Worker] Raw AI response: {...}
[Worker] Analysis clxxx123 completed successfully
✅ [Worker] Job 123 completed successfully
```

---

## 🚨 Troubleshooting

### Problema: Worker usa prompt errado

**Causa:** Cache ou versão não ativa

**Solução:**
```bash
# Verificar qual está ativo
GET /api/prompts/latest

# Ativar a correta
POST /api/prompts/1/activate

# Reiniciar worker
npm run worker
```

---

### Problema: Análise muito lenta

**Causa:** Prompt v1 é muito grande (50KB)

**Solução:** Ativar v2 temporariamente
```bash
POST /api/prompts/2/activate
```

---

### Problema: Qualidade baixa

**Causa:** Prompt v2 é simplificado demais

**Solução:** Voltar para v1
```bash
POST /api/prompts/1/activate
```

---

## 💡 Dicas Avançadas

### 1. A/B Testing de Prompts

Crie duas versões e alterne para comparar resultados:

```bash
# Criar v3 experimental
POST /api/prompts/config
{"prompt": "Variação experimental...", "setActive": false}

# Testar manualmente
POST /api/ai/analyze
promptOverride: "[conteúdo v3]"

# Se melhor, ativar
POST /api/prompts/3/activate
```

---

### 2. Prompt Especializado por Mercado

Crie versões específicas:
- v1: Geral (ativo)
- v3: Crypto (inativo)
- v4: Forex (inativo)
- v5: Stocks (inativo)

Ative conforme necessidade.

---

### 3. Monitoramento de Performance

Compare versões:
```sql
SELECT 
  promptVer,
  AVG(confidence) as avg_confidence,
  COUNT(*) as total_analyses,
  COUNT(CASE WHEN recommendation != 'HOLD' THEN 1 END) as actionable
FROM Analysis
WHERE status = 'done'
GROUP BY promptVer;
```

---

## 🔐 Segurança

### Controle de Acesso

**Endpoints de leitura:** Públicos ou autenticados básicos
- GET /api/prompts/latest
- GET /api/prompts/:version

**Endpoints de escrita:** Requerem admin (TODO: implementar AdminGuard)
- POST /api/prompts/config
- POST /api/prompts/:version/activate

**Recomendação:** Implementar role-based access control (RBAC).

---

## 📚 Recursos Adicionais

- **Código fonte do prompt:** `apps/backend/src/common/prompts/trading-system-prompt.ts`
- **Seed database:** `apps/backend/prisma/seed.ts`
- **Worker:** `apps/backend/worker/ai.worker.ts`
- **API Examples:** `docs/backend/API_EXAMPLES.md`

---

## 🎓 Referências Técnicas

O sistema multi-agente foi baseado em:
- Análise técnica profissional (price action, estrutura de mercado)
- Pattern recognition clássico (candlesticks, chart patterns)
- Risk management institucional (R:R ratios, position sizing)
- Confluence trading (múltiplos timeframes, confirmações)

---

**Mantido por:** Equipe de Desenvolvimento TICRIF
**Última atualização:** Janeiro 2025

