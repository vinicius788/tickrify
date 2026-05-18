# 1. Resumo Executivo
- Tipo do produto: SaaS web de análise de gráficos com IA (frontend React + backend NestJS + worker BullMQ/Redis + PostgreSQL/Prisma + Stripe + Clerk).
- Estado geral atual: núcleo técnico endurecido (auth, quota, upload, readiness, observabilidade mínima), com build/lint/testes passando localmente.
- Principais riscos (top 5):
  1. Falta de validação operacional em ambiente real (staging/prod) para fluxos críticos ponta a ponta.
  2. Endpoints legados e canônicos coexistindo (`/api/analyze-chart` + `/api/ai/analyze`), risco de regressão/contrato quebrado.
  3. Cobertura E2E de runtime crítico ainda insuficiente (sessão expirada, webhook real, filas/worker sob falha).
  4. Bundle frontend elevado (~684 kB pós-build), risco de latência de primeira carga.
  5. Código legado de pagamentos ainda presente (não exposto no módulo atual), podendo gerar confusão operacional.
- Veredito: GO COM RESSALVAS.
- Evidência de validação operacional nesta auditoria:
  - `./scripts/check-deploy.sh http://localhost:3001 http://localhost:5173` executado com sucesso (sem falhas críticas).
  - `scripts/smoke-api.mjs` passando com `x-request-id` e `health/ready` crítico OK.

# 2. Jornada do Usuário (Plataforma -> Usuário)
Mapeamento do fluxo principal:
1. Usuário abre app e autentica via Clerk.
2. Vai para dashboard, faz upload de imagem (PNG/JPG/WEBP, limite 10MB).
3. Backend valida imagem, valida quota/plano, persiste análise e envia para queue (produção) ou fallback controlado (não produção).
4. Frontend faz polling de status até `completed` ou `failed`.
5. Usuário visualiza resultado e histórico.

Fricções/quebras observadas:
- Possível confusão de integração por rotas legadas coexistentes (risco técnico, não necessariamente visível ao usuário final imediato).
- Em ambiente sem validação de deploy real, risco de fricção em auth/storage/ai não detectada antes do lançamento.

# 3. Bloqueadores de Lançamento (P0)
1. ID: BLK-001
- Problema: Não há evidência de execução completa dos fluxos críticos em staging/prod.
- Tipo: NÃO VALIDADO
- Severidade: CRÍTICO
- Impacto: risco de falha pós-lançamento em login, criação de análise, worker, webhook, billing e suporte.
- Evidência: ausência de evidência runtime externa nesta auditoria; validação executada apenas em código/testes locais.
- Correção recomendada: executar checklist operacional com `scripts/check-deploy.sh` + `scripts/smoke-api.mjs` contra URLs reais e registrar evidências.

# 4. Bugs Detectados
1. BUG-001
- Tipo: BUG-REGRESSÃO
- Passos para reproduzir:
  1. Integrar cliente/SDK antigo usando `/api/analyze-chart`.
  2. Integrar cliente novo usando `/api/ai/analyze`.
  3. Evoluir backend alterando só um contrato.
- Resultado esperado x atual:
  - Esperado: contrato único de criação/consulta de análise.
  - Atual: coexistência de rotas legadas/canônicas.
- Impacto usuário/negócio: risco de regressão silenciosa e aumento de custo de manutenção/suporte.
- Evidência: `apps/backend/src/modules/ai/ai.controller.ts`, `apps/backend/src/modules/ai/analyze-chart.controller.ts`.
- Prioridade: P1

2. BUG-002
- Tipo: BUG-PERFORMANCE
- Passos para reproduzir:
  1. Rodar `npm run build -w apps/frontend`.
  2. Observar aviso de chunk maior que 500 kB.
- Resultado esperado x atual:
  - Esperado: chunks críticos menores e inicialização mais rápida.
  - Atual: bundle principal ~684 kB.
- Impacto usuário/negócio: piora de TTI/tempo inicial em rede móvel, risco de churn em onboarding.
- Evidência: saída de build frontend (`dist/assets/index-*.js` ~684 kB).
- Prioridade: P2

3. BUG-003
- Tipo: BUG-CONFIANÇA
- Passos para reproduzir:
  1. Ler estado de prontidão apenas por health superficial sem readiness completo.
  2. Implantar com dependências críticas incompletas.
- Resultado esperado x atual:
  - Esperado: critério objetivo de “pronto para produção”.
  - Atual: mitigado por correção recente, mas depende de execução real do check.
- Impacto usuário/negócio: percepção de estabilidade falsa e incidentes no dia 1.
- Evidência: necessidade de execução de `scripts/check-deploy.sh` e `scripts/smoke-api.mjs` em ambiente real.
- Prioridade: P0 (até validar em staging/prod).

# 5. Achados por Categoria
## 5.1 Funcionalidade
- Problema: consumo de quota podia ocorrer antes de validar pré-requisitos de infraestrutura.
- Impacto: cobrança indevida de quota para tentativa que falha.
- Evidência: correção em `apps/backend/src/modules/ai/ai.service.ts`.
- Correção: já aplicada (ordem de validações ajustada).

## 5.2 UX / Jornada
- Problema: validação de arquivo só no backend gerava roundtrip desnecessário.
- Impacto: atrito e erro tardio no fluxo de upload.
- Evidência: correções em `apps/frontend/src/components/pages/DashboardPage.tsx` e `apps/frontend/src/components/dashboard/NewAnalysis.tsx`.
- Correção: já aplicada (tipo/tamanho no cliente + backend).

## 5.3 Performance / Estabilidade
- Problema: bundle frontend principal grande.
- Impacto: carregamento inicial mais lento.
- Evidência: warning de build (`~684 kB`).
- Correção: pendente (code splitting/manual chunks, lazy load em áreas secundárias).

## 5.4 Segurança
- Problema: risco de fallback legado de auth em produção e variáveis de runtime inconsistentes.
- Impacto: potencial bypass/ambiente ambíguo.
- Evidência: hardening aplicado em `runtime-env`, `auth.guard`, `ai.queue`, `ai.worker`.
- Correção: aplicada (fail-closed + bloqueio fallback em produção).

## 5.5 Dados / Integridade
- Problema: fonte de verdade de quota no frontend era heurística baseada em listagem.
- Impacto: divergência de contagem/plano.
- Evidência: `apps/frontend/src/hooks/useAnalysisLimit.ts` migrado para `GET /api/ai/usage`.
- Correção: aplicada.

## 5.6 Infra / Deploy
- Problema: scripts de setup/check com sinais fracos.
- Impacto: maior chance de deploy “aparentemente ok” mas não pronto.
- Evidência: melhorias em `scripts/setup-env.sh`, `scripts/check-deploy.sh`, `scripts/smoke-api.mjs`.
- Correção: aplicada parcialmente; falta execução em ambiente real.

## 5.7 Observabilidade
- Problema: ausência de request id padronizado e log HTTP estruturado.
- Impacto: diagnóstico lento em incidente.
- Evidência: `request-context.middleware`, `http-logging.interceptor`.
- Correção: aplicada.

# 6. Scorecard
- Funcionalidade: 8.3/10
- Jornada/UX: 7.8/10
- Bugs e regressão: 7.4/10
- Estabilidade/Performance: 7.2/10
- Segurança: 8.4/10
- Dados/Confiabilidade: 8.1/10
- Infra/Operação: 7.6/10
- Observabilidade: 8.0/10
- Lançabilidade (nota final): 7.8/10

# 7. Plano de Correção Priorizado
- 24h (urgente, pré-lançamento):
  1. Executar `scripts/check-deploy.sh` e `scripts/smoke-api.mjs` em staging/prod.
  motivo: remover ponto crítico “NÃO VALIDADO”.
  impacto esperado: confiança real de lançamento.
  prioridade: P0
  2. Congelar contrato único para análises e planejar depreciação de rotas legadas.
  motivo: reduzir risco de regressão.
  impacto esperado: menor custo de manutenção e integração.
  prioridade: P1

- 7 dias (lançamento seguro):
  1. Adicionar E2E de fluxos críticos (auth, análise, quota, webhook, sessão expirada).
  motivo: detectar regressão de ponta a ponta.
  impacto esperado: queda de incidentes pós-release.
  prioridade: P1
  2. Criar alertas operacionais mínimos (erros 5xx, `health/ready`, latência p95).
  motivo: operação reativa insuficiente sem alertas.
  impacto esperado: MTTR menor.
  prioridade: P1

- 30 dias (hardening e evolução):
  1. Reduzir bundle frontend com code-splitting.
  motivo: performance inicial.
  impacto esperado: melhor ativação e retenção.
  prioridade: P2
  2. Remover código legado de pagamentos não utilizado no módulo ativo.
  motivo: reduzir dívida técnica e ambiguidade.
  impacto esperado: menor superfície de manutenção.
  prioridade: P2

# 8. Itens Não Validados
1. Fluxo completo real em staging/prod: login -> upload -> processamento async -> resultado.
2. Sessão expirada/refresh token em ambiente real com Clerk.
3. Webhook Stripe real com assinatura válida e reconciliação.
4. Resiliência com indisponibilidade real de Redis/Supabase/OpenAI.
5. Performance real em rede móvel/dispositivo de baixa capacidade.
6. Alertas e monitoramento externos (Sentry/Datadog/etc.) em produção.
7. DNS/ambiente público ativo para `tickrify.com` (nameservers atuais em parking), impedindo comprovação operacional pública nesta sessão.
