# 🔍 Análise de Problemas - Tickrify

**Data:** 17 de Novembro de 2025
**Status:** Em análise

---

## 🎯 Problema Principal Reportado

### Erro no Deploy do Backend na Vercel

```
Error: No Output Directory named "public" found after the Build completed. 
Configure the Output Directory in your Project Settings. 
Alternatively, configure vercel.json#outputDirectory.
```

---

## 📊 Problemas Identificados

### 1. ❌ Configuração Incorreta do vercel.json (CRÍTICO)

**Problema:**
- O `vercel.json` está configurado para usar `@vercel/static-build` para o frontend
- Este builder espera um diretório `public` ou `dist` como output
- A configuração atual não especifica o `outputDirectory` correto

**Localização:** `/tickrify.com/vercel.json`

**Configuração Atual:**
```json
{
  "builds": [
    {
      "src": "apps/frontend/package.json",
      "use": "@vercel/static-build@1.0.1",
      "config": {
        "distDir": "dist"
      }
    }
  ]
}
```

**Impacto:** Deploy do frontend falha porque a Vercel não encontra o diretório de output correto.

---

### 2. ⚠️ Versão Desatualizada do Prisma

**Problema:**
- Prisma Client está na versão 5.22.0
- Versão mais recente é 6.19.0
- Pode causar incompatibilidades e problemas de performance

**Localização:** `apps/backend/package.json`

**Versão Atual:**
```json
"@prisma/client": "^5.7.0",
"prisma": "^5.7.0"
```

**Impacto:** Avisos durante build, possíveis incompatibilidades futuras.

---

### 3. ⚠️ Estrutura de Monorepo Não Otimizada para Vercel

**Problema:**
- Projeto usa estrutura de monorepo (apps/backend, apps/frontend)
- Vercel precisa de configuração específica para monorepos
- Build commands podem não estar executando no contexto correto

**Impacto:** Builds podem falhar ou não encontrar dependências.

---

### 4. ⚠️ Falta de Script de Build Unificado

**Problema:**
- Não há script de build na raiz do projeto
- Frontend e backend têm builds separados
- Vercel pode não saber qual comando executar

**Localização:** `/tickrify.com/package.json`

**Package.json Atual:**
```json
{
  "name": "tickrify-monorepo",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "apps/*"
  ]
}
```

**Falta:** Scripts de build, start, e deploy.

---

### 5. ⚠️ Configuração de Output Directory

**Problema:**
- Frontend compila para `apps/frontend/dist`
- Backend compila para `apps/backend/dist`
- Vercel precisa saber onde encontrar os arquivos estáticos

**Impacto:** Erro "No Output Directory named 'public' found"

---

## 🔧 Soluções Propostas

### Solução 1: Corrigir vercel.json (PRIORITÁRIO)

**Ação:**
1. Atualizar configuração do frontend no vercel.json
2. Especificar outputDirectory corretamente
3. Ajustar rotas para servir arquivos estáticos

**Novo vercel.json:**
```json
{
  "version": 2,
  "buildCommand": "cd apps/backend && npm install && npm run build && cd ../frontend && npm install && npm run build",
  "outputDirectory": "apps/frontend/dist",
  "builds": [
    {
      "src": "apps/backend/src/vercel.ts",
      "use": "@vercel/node"
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

---

### Solução 2: Adicionar Scripts de Build na Raiz

**Ação:**
Atualizar `/tickrify.com/package.json` com scripts de build:

```json
{
  "name": "tickrify-monorepo",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "apps/*"
  ],
  "scripts": {
    "build": "npm run build:backend && npm run build:frontend",
    "build:backend": "cd apps/backend && npm install && npm run build",
    "build:frontend": "cd apps/frontend && npm install && npm run build",
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
    "dev:backend": "cd apps/backend && npm run dev",
    "dev:frontend": "cd apps/frontend && npm run dev"
  }
}
```

---

### Solução 3: Atualizar Prisma (RECOMENDADO)

**Ação:**
```bash
cd apps/backend
npm install @prisma/client@latest prisma@latest
npx prisma generate
```

---

### Solução 4: Criar Arquivo .vercelignore

**Ação:**
Criar `.vercelignore` na raiz para otimizar deploy:

```
node_modules
.git
.DS_Store
*.log
.env.local
.env.*.local
apps/backend/uploads
apps/backend/dist
apps/frontend/dist
```

---

## 📋 Checklist de Correções

- [ ] Corrigir vercel.json com outputDirectory
- [ ] Adicionar scripts de build no package.json raiz
- [ ] Atualizar Prisma para versão mais recente
- [ ] Criar .vercelignore otimizado
- [ ] Testar build local do frontend
- [ ] Testar build local do backend
- [ ] Validar estrutura de diretórios
- [ ] Fazer deploy de teste na Vercel

---

## 🎯 Próximos Passos

1. Implementar Solução 1 (vercel.json)
2. Implementar Solução 2 (package.json)
3. Testar builds localmente
4. Fazer deploy de teste
5. Validar funcionamento completo

---

**Status:** Análise completa, pronto para implementar correções.
