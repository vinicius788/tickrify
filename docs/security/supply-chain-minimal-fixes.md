# Correções mínimas de supply chain — 24/10/2026

Base publicada: `6d1ed513bcb357eb6806c71e316d993ec0750713`.
Preparação local; nenhuma publicação ou alteração de conta/provedor autorizada.

## Instalação da Vercel

- Usar `corepack pnpm`, que seleciona `pnpm@10.12.4` pelo `packageManager` da raiz.
- Instalar apenas o frontend e suas dependências com `--frozen-lockfile --ignore-scripts`.
- Manter manifestos, lockfile, outputDirectory, headers e rewrites existentes.
- A instalação offline local com pnpm 10.12.4 reutilizou 426 pacotes e não mudou o lockfile.
- Um manifesto divergente foi recusado com `ERR_PNPM_OUTDATED_LOCKFILE`.
- Build com Vite 6.4.3, typecheck e 408 testes do frontend passaram.

Antes de publicar, validar em preview autorizado a disponibilidade do Corepack
e o acesso ao package.json, pnpm-workspace.yaml e lockfile da raiz. O bootstrap
do Corepack não foi validado localmente: a tentativa precisaria baixar pnpm
para um cache sem permissão de escrita. Os testes de instalação usaram o pnpm
10.12.4 já disponível, com cache e node_modules isolados. Não há fallback para npm.

A produção atual usa um grafo npm diferente; retornar ao grafo pnpm auditado
exige essa validação em preview. Não foi corrigido nenhum advisory existente.
O build local avisou que a consulta de acurácia não respondeu e gerou as páginas
sem a tabela de números, conforme o fallback atual do prerender.

## Token operacional

- Inputs do workflow passam por variáveis de ambiente com expansão entre aspas.
- Com token definido, somente `https://tickrify.onrender.com` é autorizado,
  antes de qualquer acesso à rede; credenciais na URL são recusadas.
- A requisição autenticada também valida a origem e não segue redirects.
- Ambientes alternativos continuam auditáveis sem token.
- 18 testes passaram no Node 20.20.2 e no Node 24.11.0, usando rede/TLS simulados
  e apenas credencial sintética. O job de auditoria do CI passa a executar esses testes.

## Restabelecimento do CI

1. O responsável pela conta deve verificar Billing & licensing e o orçamento
   de Actions: corrigir pagamento recusado e/ou limite de gastos, conforme a
   causa exibida pelo GitHub. Alterar workflow não remove esse bloqueio.
2. Após a regularização e autorização para executar os workflows, repetir os
   checks no commit desejado. Não desativar auditoria ou varredura de segredos.
3. Resolver os bloqueios de código preexistentes em mudanças específicas:
   - `pnpm audit --audit-level=high --prod` retorna 7 alertas: 3 altos,
     1 crítico e 3 baixos (DOMPurify, Zod e Multer).
   - O gate estático sinaliza `${column}` no ALTER TABLE de stripe.service.ts.
     A origem é uma lista literal fechada; o sinalizador não demonstra SQL
     injection. Revisar a precisão do detector em uma mudança separada,
     preservando a lógica de pagamentos e sua capacidade de detectar SQL inseguro.
   - A auditoria completa usada pelo gate estático retorna 3 alertas críticos
     (inclui dependências de desenvolvimento). Os dois bloqueios desse gate
     foram reproduzidos com resultados idênticos na base publicada e na branch.

Não foram alterados faturamento do GitHub, regras de proteção, auto-deploys,
dependências, backend, checkout ou assinaturas. A regularização administrativa
permite executar o CI; os bloqueios acima ainda impedem afirmar que ficará verde.

Referências oficiais:
- https://vercel.com/docs/package-managers
- https://docs.github.com/en/billing/concepts/product-billing/github-actions

## Comandos locais de validação

```sh
node --test scripts/supply-chain-guards.test.mjs
pnpm --filter vite-react-typescript-starter... install --frozen-lockfile --ignore-scripts --offline --store-dir /private/tmp/tickrify-supply-chain-validation-store
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test
pnpm --dir apps/frontend build
pnpm audit --audit-level=high --prod
node scripts/auditoria-seguranca.mjs --json
```

Os dois últimos comandos diagnosticam bloqueios existentes; não são checks verdes.
