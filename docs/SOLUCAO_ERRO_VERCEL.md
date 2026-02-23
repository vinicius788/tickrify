# 🔧 Solução: Erro ao Instalar Vercel CLI

## Problema

Erro ao executar `npm install -g vercel`:

```
npm error code EACCES
npm error syscall mkdir
npm error path /Users/vini.mqs/.npm-global/lib/node_modules/vercel
npm error errno -13
```

---

## ✅ Solução Rápida (Recomendada)

**Use `npx` ao invés de instalar globalmente!**

```bash
# Não precisa instalar nada!
# Apenas use npx:

npx vercel
```

### Vantagens:
- ✅ Não precisa de sudo
- ✅ Não precisa corrigir permissões
- ✅ Sempre usa a versão mais recente
- ✅ Funciona imediatamente

---

## 🚀 Como Fazer Deploy com npx

### Primeiro Deploy (Configuração Inicial)
```bash
# No diretório raiz do projeto
npx vercel
```

Siga os prompts:
1. Setup and deploy? **Y**
2. Which scope? **Sua conta**
3. Link to existing project? **N**
4. What's your project's name? **tickrify** (ou o que quiser)
5. In which directory is your code located? **./** 
6. Want to override the settings? **N**

### Deploy para Produção
```bash
npx vercel --prod
```

---

## 🛠️ Alternativa: Corrigir Permissões (Se Preferir Instalar Globalmente)

Se você realmente quer instalar o Vercel CLI globalmente, execute **no seu terminal** (precisa digitar senha):

### Opção 1: Corrigir permissões da pasta npm
```bash
# Execute no terminal (vai pedir sua senha)
sudo chown -R $(whoami) "/Users/vini.mqs/.npm"

# Depois instale
npm install -g vercel
```

### Opção 2: Instalar sem sudo
```bash
npm install -g vercel --unsafe-perm=true
```

### Opção 3: Mudar diretório global do npm
```bash
# Criar diretório para pacotes globais
mkdir ~/.npm-global

# Configurar npm para usar esse diretório
npm config set prefix '~/.npm-global'

# Adicionar ao PATH (adicione isso ao seu ~/.zshrc)
export PATH=~/.npm-global/bin:$PATH

# Recarregar configuração
source ~/.zshrc

# Agora instale
npm install -g vercel
```

---

## 📝 Atualização nos Comandos de Deploy

### Todos os comandos que usam `vercel` podem usar `npx vercel`:

**Antes:**
```bash
vercel login
vercel
vercel --prod
vercel logs
```

**Agora:**
```bash
npx vercel login
npx vercel
npx vercel --prod
npx vercel logs
```

---

## 🎯 Recomendação Final

**Use `npx vercel` para tudo!**

É mais simples, mais seguro, e você não precisa se preocupar com permissões ou instalações globais.

---

## ✅ Próximos Passos

Agora que você sabe como usar o Vercel, continue com o guia:

1. Volte para `COMECE_AQUI.md`
2. Na seção de "Deploy na Vercel", use `npx vercel` ao invés de `vercel`
3. Continue seguindo os passos normalmente!

**Boa sorte! 🚀**

