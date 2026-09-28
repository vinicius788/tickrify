# Integridade dos níveis de operação — 28/09/2026

## Problema e correção preparada

`computeRiskReward` usava `abs(entry - stop)` e `abs(target - entry)`. Isso podia produzir R:R positivo para BUY com alvo abaixo da entrada, SELL com alvo acima, ou stop/alvo do mesmo lado. O frontend repetia a fórmula e ainda podia exibir o R:R escrito pelo modelo quando os números não sustentavam o cálculo. Um R:R assim parece validar um plano que não é executável na direção recomendada.

Neste branch isolado, backend e interface só calculam R:R para preços positivos e finitos, stop e alvo em lados opostos da entrada e direção coerente com BUY/SELL. Se qualquer alvo **fornecido** contradisser um plano direcional, o adapter recusa a resposta com `invalid_trade_plan`, sem tentar inverter a operação ou corrigir o preço. O fluxo existente trata esse código como falha definitiva, devolve o tick pago, preserva o código estável para investigação e mostra uma mensagem de nova tentativa. A demo não consome a cota em falha. Campos de R:R/probabilidade não são fabricados a partir de texto do modelo quando faltam níveis verificáveis.

Registros antigos continuam legíveis. Se um deles tiver níveis contraditórios, a interface mostra um alerta perto do veredito, esconde R:R e probabilidades, não oferece cálculo de tamanho de posição nem card compartilhável e não repete a instrução de entrada. O alerta não reescreve o sinal histórico armazenado; essa distinção evita alterar silenciosamente métricas antigas.

## Validação e limites

- Teste do adapter com resposta simulada: BUY com TP1 abaixo da entrada e TP2 acima é recusado; BUY coerente é preservado. Testes puros cobrem BUY, SELL, stop/alvo invertidos, zero/negativos e alvo secundário incoerente.
- Auditor local dos oito gráficos BTCUSDT 30m: **0** planos BUY/SELL com níveis do lado errado no baseline e **0** na candidata MTF v1. Essa amostra não estima a frequência do problema entre usuários reais, outros ativos ou modos.
- O teste de renderização abre o painel técnico: num registro antigo com BUY contraditório, o aviso aparece e a calculadora fica ausente; num BUY coerente, a calculadora permanece.
- O teste do worker executa o processador real com dependências simuladas: `invalid_trade_plan` e `validation_failed` preservam o código e geram reembolso; uma fonte alternativa com níveis contraditórios também é recusada. No deep, o reembolso é de três ticks e uma segunda entrega do mesmo job não duplica o crédito. O worker não publica R:R/probabilidades de trade em WAIT nem usa o texto de R:R do modelo como fallback.
- TypeScript do backend/frontend, build do backend (incluindo o worker) e build Vite passaram. Suítes completas, após usar o comando com `jsdom` do frontend e permitir porta local do teste de health: backend **36 suítes / 320 testes**, frontend **13 suítes / 83 testes**. Nenhum teste faz chamada paga ao modelo.
- A guarda só captura contradição geométrica de níveis **presentes**. Não valida se o preço foi lido corretamente da imagem, se a zona de entrada é alcançável, spread/slippage, nem se o trade é lucrativo. Um sinal com níveis ausentes continua sujeito ao contrato e às demais guardas existentes; não foi convertido automaticamente em WAIT para evitar aumentar falhas/abstenção sem medir a prevalência.

Esta correção melhora a integridade de um plano, **não comprova melhora da taxa de acerto nem resolve o excesso de WAIT**. A variante de prompt MTF v2 continua offline e sem promoção. `OPENAI_API_KEY` não está disponível neste worktree, então a comparação paga de 48 pares descrita em [protocolo de avaliação](AI_ANALYSIS_NEXT_EVAL_GATE_2026-09-23.md) ainda não aconteceu. Antes de ativar mudanças de análise para os três usuários pagantes, avaliar os casos históricos e staging, confirmar reembolso/código em staging e medir falhas, WAIT e outcomes com os marcos de 23/09. Não houve push, migração aplicada nem implantação.
