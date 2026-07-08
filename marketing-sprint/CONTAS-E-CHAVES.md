# Contas a criar + onde colar as chaves

> Marque conforme for criando. As duas primeiras (PostHog e Sentry) são as do P1 — as outras são pra mais pra frente (e-mail = P6). Clerk e Stripe você já tem, não precisa mexer.

---

## 1. PostHog — analytics do funil (P1, criar AGORA)

- **Criar conta:** https://app.posthog.com/signup (grátis, sem cartão)
- **Tier grátis:** 1.000.000 de eventos/mês (sobra muito pra começar)
- **Onde pegar a chave:** depois de criar o projeto → menu **Settings** (engrenagem) → **Project** → **Project API Key** (começa com `phc_...`)
- **Host:** ao criar, ele te diz se é **US** (`https://us.i.posthog.com`) ou **EU** (`https://eu.i.posthog.com`). Use o que aparecer.

```
VITE_POSTHOG_KEY=        ← cole aqui o phc_...
VITE_POSTHOG_HOST=       ← cole aqui us.i.posthog.com ou eu.i.posthog.com
```

- [ ] Conta criada
- [ ] Chave colada no `.env`

---

## 2. Sentry — observabilidade de erros (P1, criar AGORA)

- **Criar conta:** https://sentry.io/signup/ (grátis, sem cartão)
- **Tier grátis:** 5.000 erros/mês, 1 usuário, 30 dias de retenção
- **Como pegar a chave (DSN):** ao criar, escolha a plataforma **React**. O Sentry mostra um **DSN** (formato `https://xxxxx@oXXXX.ingest.sentry.io/XXXX`). É essa string.

```
VITE_SENTRY_DSN=         ← cole aqui o DSN (deixe vazio = Sentry desligado)
VITE_APP_ENV=production  ← em produção; em dev pode deixar "development"
```

- [ ] Conta criada (projeto React)
- [ ] DSN colado no `.env`

---

## 3. E-mail transacional (P6 — DEPOIS, não é agora)

Pra boas-vindas / win-back de limite / reativação. Escolha **um** dos dois:

- **Brevo:** https://www.brevo.com — grátis 300 e-mails/dia
- **Resend:** https://resend.com — grátis 3.000/mês (100/dia), bem simples pra dev

```
# (P6 - preencher quando chegarmos nas sequências de e-mail)
EMAIL_API_KEY=
```

- [ ] (depois) Conta criada
- [ ] (depois) Chave guardada

---

## Já existentes (NÃO precisa criar)

- **Clerk** (auth) — já configurado: `VITE_CLERK_PUBLISHABLE_KEY`
- **Stripe** (pagamento) — já configurado: `VITE_STRIPE_PUBLISHABLE_KEY` + chaves no backend

---

## Onde colar tudo

Arquivo: **`apps/frontend/.env`** (o que já existe na sua máquina, com as chaves do Clerk/Stripe).
Só adicione as linhas do PostHog e do Sentry no final. Bloco pronto pra colar:

```env
# PostHog
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://us.i.posthog.com

# Sentry
VITE_SENTRY_DSN=
VITE_APP_ENV=production
```

> Importante: enquanto `VITE_POSTHOG_KEY` estiver vazia, o analytics fica **desligado** e não quebra nada — então pode subir o código sem medo antes de ter a chave. Depois de colar a chave, faça novo deploy (no Vercel, as mesmas variáveis precisam ser cadastradas nas Environment Variables do projeto).
