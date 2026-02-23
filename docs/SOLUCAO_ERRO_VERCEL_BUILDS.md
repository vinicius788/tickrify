# 🔧 Solução: Erro "functions property cannot be used with builds"

## ❌ Problema

Erro ao fazer deploy do backend na Vercel:

```
The 'functions property cannot be used in conjunction with the 'builds' property.
Please remove one of them.
```

---

## ✅ Solução Aplicada

O arquivo `apps/backend/vercel.json` tinha **ambos** `builds` e `functions`, o que não é permitido na Vercel.

**Correção:** Removido `builds` e mantido apenas `functions` (formato moderno).

### Antes (ERRADO):
```json
{
  "version": 2,
  "builds": [...],  // ❌ Conflito
  "functions": {...} // ❌ Conflito
}
```

### Depois (CORRETO):
```json
{
  "version": 2,
  "functions": {
    "dist/src/vercel.js": {
      "maxDuration": 300,
      "memory": 1024,
      "runtime": "nodejs20.x"
    }
  },
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "dist/src/vercel.js"
    }
  ]
}
```

---

## 🚀 Como Fazer Deploy Agora

### Opção 1: Deploy do Monorepo Completo (Recomendado)

Use o `vercel.json` da **raiz** do projeto:

```bash
# Na raiz do projeto
npx vercel --prod
```

O `vercel.json` da raiz já está correto e gerencia frontend + backend juntos.

### Opção 2: Deploy Separado do Backend

Se quiser fazer deploy apenas do backend:

```bash
# No diretório do backend
cd apps/backend
npx vercel --prod
```

Agora o `apps/backend/vercel.json` está correto (sem conflito).

---

## 📝 Estrutura dos Arquivos

### `vercel.json` (Raiz) - Para Monorepo
```json
{
  "version": 2,
  "builds": [...],  // ✅ OK para monorepo
  "routes": [...]
}
```

### `apps/backend/vercel.json` - Para Deploy Separado
```json
{
  "version": 2,
  "functions": {...},  // ✅ Apenas functions (sem builds)
  "routes": [...]
}
```

---

## ✅ Status

- ✅ Conflito resolvido
- ✅ `apps/backend/vercel.json` corrigido
- ✅ Pronto para deploy

---

## 🎯 Próximo Passo

Tente fazer deploy novamente:

```bash
# Se for deploy do monorepo (raiz):
npx vercel --prod

# Se for deploy apenas do backend:
cd apps/backend
npx vercel --prod
```

**Deve funcionar agora!** 🚀

---

## 💡 Dica

Para monorepos, é mais fácil fazer deploy pela **raiz** usando o `vercel.json` principal. Ele gerencia frontend e backend automaticamente.

