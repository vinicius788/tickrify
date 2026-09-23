# Linha de base do funil de análise — PostHog, 23/09/2026

Números informados pelo responsável pelo produto em 23/09/2026, a partir do
evento `analysis_completed` do PostHog **sem a conta do dono**. Não recebemos
exportação, consulta, totais semanais ou definição de todos os filtros para
recalcular as taxas. Preservar a consulta original e seus filtros antes de
comparar qualquer período posterior. O evento é emitido pelo navegador; como
o PostHog só inicia após consentimento, essa coorte não representa
necessariamente todos os usuários da plataforma.

| Recorte informado | WAIT/HOLD ou observação |
| --- | ---: |
| Julho (modelo informado: `gpt-4o-mini`) | 39% WAIT/HOLD |
| Semana de 30/08 | 94% WAIT/HOLD |
| Semana de 06/09 | 82% WAIT/HOLD |
| Semana de 13/09 | 88% WAIT/HOLD |
| Semana de 20/09 | 78% WAIT/HOLD |
| Primeira análise de cada usuário desde 24/08 | 82/97 WAIT = **84,5%** (aprox. 85%) |
| Plano starter | 77% WAIT |
| Plano grátis | 85% WAIT |
| Retorno para segunda análise após WAIT | 59% |
| Retorno para segunda análise após BUY | 64%; amostra pequena |
| Falhas desde 24/08 | 27 eventos em 9 pessoas; todos `code: unknown` |

Estimativa informada: uma pessoa grátis tem cerca de **60% de chance de gastar
as três análises sem ver BUY ou SELL**. Falta o denominador e a consulta desse
cálculo; tratá-lo como hipótese operacional a confirmar, não taxa precisa.
Também faltam volumes das semanas e distribuição por quick/deep. Os 59% e 64%
de retorno não demonstram efeito causal de WAIT sobre retenção.

O [endpoint público de acurácia](AI_ANALYSIS_BASELINE_2026-09-23.md) mostrou
48,2% de WAIT entre 542 recomendações concluídas em outro conjunto e janela.
Não combinar esses denominadores: o PostHog depende de consentimento e dos
filtros informados; o endpoint público usa regras próprias para as análises
incluídas. A diferença é motivo para auditar cobertura, não para escolher a
taxa mais favorável.

## Hipótese e comparação depois de uma mudança

A troca do quick para `gpt-5.6-luna` em 11/08 **pode** ter contribuído para
abstenção, mas não há evidência causal. O backtest de 29/07 já havia produzido
apenas 2 sinais em 10 casos com luna + v7.3, segundo o relato; 10 casos não
isolam modelo, prompt nem composição dos gráficos. Nenhum prompt ou modelo
será afrouxado só para reduzir WAIT: acompanhar erros críticos, cobertura,
outcomes maduros e custo junto com a experiência inicial.

Comparar antes/depois usando a **mesma consulta e os mesmos filtros**: excluir
a conta do dono, normalizar `HOLD` e `WAIT` como ação de aguardar, contar apenas
`analysis_completed`, manter o mesmo critério de consentimento, separar
quick/deep e plano, registrar a data exata da mudança e exibir numerador,
denominador e intervalo de confiança. As duas métricas de ativação são:

1. **WAIT na primeira análise:** pessoas cuja primeira análise concluída no
   recorte foi WAIT/HOLD ÷ pessoas com primeira análise concluída no recorte.
   Confirmar se a consulta histórica excluiu quem já tinha análise antes de
   24/08; caso contrário chamar de “primeiro evento observado”, não primeira
   análise da vida.
2. **Sinal nas três análises grátis:** pessoas com ao menos um BUY/SELL entre
   suas três primeiras análises grátis concluídas ÷ pessoas que concluíram as
   três. Mostrar separadamente quantas pessoas ainda não chegaram à terceira,
   para não confundir censura com ausência de sinal.

Como guardrails, publicar também falhas por análise iniciada, pessoas afetadas,
retorno para segunda análise por ação inicial, acerto e cobertura dos outcomes
com 48h de maturação, latência, custo e erros críticos na avaliação cega. Não
usar queda de WAIT isolada como critério de promoção.

## Falhas `code: unknown`

O código atual lançava um `Error` comum quando o polling retornava
`status: failed`; o evento `analysis_failed` só extraía código de `APIError`.
Uma correção local passou a marcar **`processing_failed_unclassified`** para
esse caminho e a separar falhas de requisição HTTP de erros inesperados do
cliente, sem enviar texto da falha ao PostHog. Isso melhora a localização da
falha, mas **não descobre sua causa interna**. O worker registra `errorCode` na
linha `[Metrics]`, porém o código não é persistido nem incluído na resposta
final de uma análise falha. As 27 falhas históricas não podem ser
reclassificadas só pelo evento.

Após autorização explícita do responsável, foi preparado na branch isolada um
evento server-side separado, `analysis_execution_failed`, para falhas
**definitivas** do worker e do processamento síncrono de reserva. O wrapper
existente associa o evento ao identificador Clerk do usuário; as propriedades
enviadas são apenas `analysisType` (`quick`/`deep`) e `code` de uma lista fixa
(`validation_failed`, códigos tipados do adaptador de IA ou
`processing_unclassified`). Não entram análise ID, texto do erro, prompt,
imagem ou resposta bruta nas propriedades. A chave de deduplicação deriva do
ID da análise e usa um timestamp estável de criação, portanto o horário do
evento representa o **início** da análise, não o instante exato da falha.
Retentativas intermediárias não geram esse evento. Ele só começará a aparecer
depois de um deploy autorizado; esta branch não foi publicada.

Como alternativa local sem novo envio a terceiros, o
[extrator de logs](../scripts/analysis-baseline.mjs) agora agrupa códigos
conhecidos das falhas terminais `[Metrics]`; códigos ausentes ou inesperados
viram `unclassified`, sem copiar mensagens livres. Isso só cobre logs ainda
disponíveis ou exportados: a retenção atual do Render é de sete dias.

Após eventual implantação, comparar `analysis_failed` do navegador com a linha
de base **usando os mesmos filtros e consentimento**. Medir
`analysis_execution_failed` separadamente: ele vem do servidor e pode cobrir
usuários que não enviam evento pelo navegador. Não somar os dois eventos como
se fossem falhas distintas. **Não** comparar a distribuição de códigos antiga
(`unknown`) com a nova como se fosse melhora de confiabilidade. A mudança de
instrumentação altera a observabilidade, não o resultado da análise nem o
consumo de Ticks.
