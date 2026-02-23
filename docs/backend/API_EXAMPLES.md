# 📡 Exemplos de Uso da API - TICRIF Backend

Este documento contém exemplos práticos de como usar todos os endpoints da API.

## 🔐 Autenticação

Todas as requisições protegidas precisam do header:

```bash
Authorization: Bearer SEU_TOKEN_CLERK
```

---

## 1️⃣ Auth - Autenticação

### GET /api/auth/me

Retorna o perfil do usuário autenticado.

**Request:**
```bash
curl -X GET http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer eyJhbGc..."
```

**Response 200:**
```json
{
  "id": "clxxx123",
  "clerkUserId": "user_2abc123",
  "email": "user@example.com",
  "name": "John Doe",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "subscriptions": [
    {
      "id": "sub_123",
      "stripeId": "sub_1ABC123",
      "status": "active",
      "priceId": "price_1ABC123"
    }
  ],
  "analyses": [
    {
      "id": "analysis_123",
      "imageUrl": "https://s3...",
      "status": "done",
      "recommendation": "BUY",
      "confidence": 85
    }
  ]
}
```

**Response 401:**
```json
{
  "statusCode": 401,
  "message": "Invalid token"
}
```

---

## 2️⃣ Payments - Pagamentos

### POST /api/payments/create-checkout

Cria uma sessão de checkout do Stripe.

**Request:**
```bash
curl -X POST http://localhost:3001/api/payments/create-checkout \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "priceId": "price_1ABC123",
    "mode": "subscription"
  }'
```

**Body:**
```json
{
  "priceId": "price_1ABC123",  // ID do preço no Stripe
  "mode": "subscription"        // ou "payment" para pagamento único
}
```

**Response 200:**
```json
{
  "sessionId": "cs_test_abc123",
  "url": "https://checkout.stripe.com/pay/cs_test_abc123"
}
```

**Uso:**
- Redirecionar usuário para `url` retornada
- Stripe processa o pagamento
- Webhook atualiza o DB automaticamente

---

### POST /api/payments/webhooks/stripe

Webhook do Stripe (chamado automaticamente pelo Stripe).

**Request (Stripe CLI local):**
```bash
stripe trigger checkout.session.completed
```

**Response 200:**
```json
{
  "received": true
}
```

**Eventos tratados:**
- `checkout.session.completed` - Pagamento concluído
- `customer.subscription.updated` - Assinatura atualizada
- `customer.subscription.deleted` - Assinatura cancelada

---

## 3️⃣ AI - Análise de IA

### POST /api/ai/analyze

Envia uma imagem para análise.

#### Opção 1: Upload de arquivo

**Request:**
```bash
curl -X POST http://localhost:3001/api/ai/analyze \
  -H "Authorization: Bearer eyJhbGc..." \
  -F "image=@grafico.png"
```

#### Opção 2: Base64

**Request:**
```bash
curl -X POST http://localhost:3001/api/ai/analyze \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "base64Image": "data:image/png;base64,iVBORw0KGgoAAAANS..."
  }'
```

#### Opção 3: Com prompt customizado

**Request:**
```bash
curl -X POST http://localhost:3001/api/ai/analyze \
  -H "Authorization: Bearer eyJhbGc..." \
  -F "image=@grafico.png" \
  -F "promptOverride=Analise este gráfico de Bitcoin e me diga se devo comprar"
```

**Response 200:**
```json
{
  "analysisId": "clxxx789",
  "status": "queued",
  "imageUrl": "https://ticrif-images.s3.us-east-1.amazonaws.com/analyses/..."
}
```

**Fluxo:**
1. API retorna `analysisId` imediatamente
2. Worker processa em background (3-10 segundos)
3. Use GET `/api/ai/analysis/:id` para buscar resultado

---

### GET /api/ai/analysis/:id

Busca o resultado de uma análise específica.

**Request:**
```bash
curl -X GET http://localhost:3001/api/ai/analysis/clxxx789 \
  -H "Authorization: Bearer eyJhbGc..."
```

**Response 200 (em processamento):**
```json
{
  "id": "clxxx789",
  "imageUrl": "https://s3...",
  "status": "processing",
  "recommendation": null,
  "confidence": null,
  "reasoning": null,
  "createdAt": "2024-01-01T10:00:00.000Z",
  "updatedAt": "2024-01-01T10:00:05.000Z"
}
```

**Response 200 (concluída):**
```json
{
  "id": "clxxx789",
  "imageUrl": "https://s3...",
  "status": "done",
  "recommendation": "BUY",
  "confidence": 85.5,
  "reasoning": "O gráfico apresenta padrão de hammer bullish em suporte chave...",
  "createdAt": "2024-01-01T10:00:00.000Z",
  "updatedAt": "2024-01-01T10:00:08.000Z"
}
```

**Response 200 (falhou):**
```json
{
  "id": "clxxx789",
  "imageUrl": "https://s3...",
  "status": "failed",
  "recommendation": null,
  "confidence": null,
  "reasoning": "Erro ao processar análise: OpenAI API timeout",
  "createdAt": "2024-01-01T10:00:00.000Z",
  "updatedAt": "2024-01-01T10:00:30.000Z"
}
```

**Status possíveis:**
- `queued` - Na fila, aguardando processamento
- `processing` - Sendo processado pelo worker
- `done` - Concluído com sucesso
- `failed` - Falhou (veja `reasoning` para detalhes)

---

### GET /api/ai/analyses

Lista todas as análises do usuário.

**Request:**
```bash
curl -X GET "http://localhost:3001/api/ai/analyses?limit=10" \
  -H "Authorization: Bearer eyJhbGc..."
```

**Query Params:**
- `limit` (opcional): Número máximo de resultados (padrão: 20)

**Response 200:**
```json
[
  {
    "id": "clxxx789",
    "imageUrl": "https://s3...",
    "status": "done",
    "recommendation": "BUY",
    "confidence": 85.5,
    "createdAt": "2024-01-01T10:00:00.000Z"
  },
  {
    "id": "clxxx456",
    "imageUrl": "https://s3...",
    "status": "done",
    "recommendation": "HOLD",
    "confidence": 60.0,
    "createdAt": "2024-01-01T09:30:00.000Z"
  }
]
```

---

## 4️⃣ Prompts - Versionamento de Prompts

### POST /api/prompts/config

Cria uma nova versão de prompt (admin).

**Request:**
```bash
curl -X POST http://localhost:3001/api/prompts/config \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analise este gráfico...",
    "setActive": true
  }'
```

**Body:**
```json
{
  "prompt": "Seu prompt customizado aqui...",
  "setActive": true  // Define como ativo? (padrão: true)
}
```

**Response 200:**
```json
{
  "id": "clxxx999",
  "version": 3,
  "prompt": "Analise este gráfico...",
  "isActive": true,
  "createdAt": "2024-01-01T11:00:00.000Z"
}
```

---

### GET /api/prompts/latest

Retorna o prompt atualmente ativo.

**Request:**
```bash
curl -X GET http://localhost:3001/api/prompts/latest
```

**Response 200:**
```json
{
  "id": "clxxx999",
  "version": 3,
  "prompt": "Analise este gráfico...",
  "isActive": true,
  "createdAt": "2024-01-01T11:00:00.000Z"
}
```

---

### GET /api/prompts/list

Lista todos os prompts (requer autenticação).

**Request:**
```bash
curl -X GET http://localhost:3001/api/prompts/list \
  -H "Authorization: Bearer eyJhbGc..."
```

**Response 200:**
```json
[
  {
    "id": "clxxx999",
    "version": 3,
    "prompt": "Prompt versão 3...",
    "isActive": true,
    "createdAt": "2024-01-01T11:00:00.000Z"
  },
  {
    "id": "clxxx888",
    "version": 2,
    "prompt": "Prompt versão 2...",
    "isActive": false,
    "createdAt": "2024-01-01T10:00:00.000Z"
  }
]
```

---

### GET /api/prompts/:version

Busca um prompt por versão específica.

**Request:**
```bash
curl -X GET http://localhost:3001/api/prompts/2
```

**Response 200:**
```json
{
  "id": "clxxx888",
  "version": 2,
  "prompt": "Prompt versão 2...",
  "isActive": false,
  "createdAt": "2024-01-01T10:00:00.000Z"
}
```

---

### POST /api/prompts/:version/activate

Ativa uma versão específica de prompt.

**Request:**
```bash
curl -X POST http://localhost:3001/api/prompts/2/activate \
  -H "Authorization: Bearer eyJhbGc..."
```

**Response 200:**
```json
{
  "id": "clxxx888",
  "version": 2,
  "prompt": "Prompt versão 2...",
  "isActive": true,
  "createdAt": "2024-01-01T10:00:00.000Z"
}
```

---

## 🧪 Testando o Fluxo Completo

### 1. Login e pegar token Clerk

```bash
# No seu frontend/app
# Após login, o Clerk fornece o token JWT
```

### 2. Verificar autenticação

```bash
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer SEU_TOKEN"
```

### 3. Enviar imagem para análise

```bash
curl -X POST http://localhost:3001/api/ai/analyze \
  -H "Authorization: Bearer SEU_TOKEN" \
  -F "image=@btc_chart.png"

# Resposta:
# {"analysisId":"clxxx123","status":"queued","imageUrl":"https://..."}
```

### 4. Aguardar processamento (3-10s)

```bash
# Aguarde alguns segundos...
sleep 5
```

### 5. Buscar resultado

```bash
curl http://localhost:3001/api/ai/analysis/clxxx123 \
  -H "Authorization: Bearer SEU_TOKEN"

# Resposta:
# {"id":"clxxx123","status":"done","recommendation":"BUY","confidence":85.5,...}
```

### 6. Listar histórico

```bash
curl http://localhost:3001/api/ai/analyses?limit=5 \
  -H "Authorization: Bearer SEU_TOKEN"
```

---

## 🐛 Códigos de Erro Comuns

### 401 Unauthorized
```json
{
  "statusCode": 401,
  "message": "Invalid token"
}
```
**Solução**: Verifique se o token Clerk está válido e não expirou.

### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "No image provided"
}
```
**Solução**: Envie `image` ou `base64Image` no body.

### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Analysis not found"
}
```
**Solução**: Verifique se o `analysisId` está correto e pertence ao seu usuário.

### 500 Internal Server Error
```json
{
  "statusCode": 500,
  "message": "Internal server error"
}
```
**Solução**: Veja logs do servidor. Pode ser erro de conexão com DB, Redis, S3 ou OpenAI.

---

## 📚 Recursos Adicionais

- **Postman Collection**: Importe uma collection com todos os endpoints
- **Swagger/OpenAPI**: Acesse `/api/docs` (se configurado)
- **Logs**: Veja `console.log` no terminal do backend/worker

---

**Happy coding! 🚀**

