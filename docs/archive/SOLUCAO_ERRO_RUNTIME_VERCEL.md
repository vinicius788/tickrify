# 🔧 Solução: Erro "Function Runtimes must have a valid version"

## ❌ Problema

Erro ao fazer deploy na Vercel:

```
Error: Function Runtimes must have a valid version, for example `now-php@1.0.0`.
```

---

## ✅ Solução Aplicada

O problema era causado por **conflito entre múltiplos `vercel.json`**:

1. `vercel.json` (raiz) - usando `builds`
2. `apps/backend/vercel.json` - usando `functions`

Quando a Vercel faz deploy do monorepo pela raiz, ela lê ambos os arquivos e isso causa conflito.

### Correções:

1. **Mantido `vercel.json` da raiz** com formato `builds` (correto para monorepos)
2. **Renomeado `apps/backend/vercel.json`** para `vercel.json.backup` (evita conflito)
3. **Removido configurações conflitantes** do `vercel.json` da raiz

---

## 📝 Configuração Final

### `vercel.json` (Raiz) - ✅ CORRETO

```json
{
  "version": 2,
  "builds": [
    {
      "src": "apps/frontend/package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "dist"
      }
    },
    {
      "src": "apps/backend/src/vercel.ts",
      "use": "@vercel/node",
      "config": {
        "maxDuration": 300,
        "memory": 1024
      }
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "apps/backend/src/vercel.ts"
    },
    {
      "handle": "filesystem"
    },
    {
      "src": "/(.*)",
      "dest": "apps/frontend/dist/$1"
    }
  ]
}
```

### `apps/backend/vercel.json` - ❌ REMOVIDO

Renomeado para `vercel.json.backup` para evitar conflito.

---

## 🚀 Como Fazer Deploy Agora

```bash
# Na raiz do projeto
npx vercel --prod
```

**Deve funcionar sem erros agora!** ✅

---

## 💡 Por Que Isso Funciona?

1. **Um único `vercel.json`** na raiz gerencia todo o monorepo
2. **Formato `builds`** é suportado e funciona bem para monorepos
3. **Sem conflitos** entre múltiplos arquivos de configuração
4. **Vercel detecta automaticamente** a versão do Node.js do `package.json`

---

## 📊 Estrutura de Arquivos

```
tickrify_novo/
├── vercel.json              ✅ Usado para deploy
├── apps/
│   ├── backend/
│   │   ├── vercel.json.backup  ⚠️ Backup (não usado)
│   │   └── src/vercel.ts
│   └── frontend/
│       └── vercel.json      ✅ Usado apenas se deploy separado
```

---

## ✅ Status

- ✅ Conflito resolvido
- ✅ `vercel.json` da raiz corrigido
- ✅ `apps/backend/vercel.json` renomeado (backup)
- ✅ Pronto para deploy

---

## 🎯 Próximo Passo

Tente fazer deploy novamente:

```bash
npx vercel --prod
```

**Deve funcionar agora!** 🚀

---

## 🔄 Se Precisar do `vercel.json` do Backend

Se no futuro você quiser fazer deploy **separado** do backend:

1. Renomeie `vercel.json.backup` de volta para `vercel.json`
2. Faça deploy apenas do backend: `cd apps/backend && npx vercel --prod`

Mas para monorepos, é melhor usar apenas o `vercel.json` da raiz.

