/**
 * LOJA DE APPS INTERNA — o registro de funções que dá para ligar e desligar.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * Até aqui, ligar ou desligar qualquer função exigia abrir o painel do Render,
 * editar a variável de ambiente e esperar o redeploy. Pior: não ficava registro
 * de quem mexeu nem de quando. Um `ENABLE_QUICK_GROUNDING` desligado por engano
 * fazia a vitrine vender uma feature que a produção não entregava — e ninguém
 * sabia desde quando.
 *
 * COMO FUNCIONA
 * Ordem de resolução, do mais forte para o mais fraco:
 *
 *     1. banco     (tabela FeatureFlag — o que o painel /admin escreve)
 *     2. ambiente  (process.env — o que já estava no Render)
 *     3. padrão    (defaultValue aqui embaixo — o comportamento histórico do código)
 *
 * Isto é deliberadamente ADITIVO: com a tabela vazia — que é como ela nasce —
 * absolutamente nada muda de comportamento. E se o banco cair, tudo volta a
 * resolver por env, exatamente como antes. Flag nunca é um ponto de falha novo.
 *
 * POR QUE LEITURA SÍNCRONA, E NÃO UM SERVIÇO INJETÁVEL DO NEST
 * As flags são lidas dentro de funções puras (analysis-normalizer, signal-decision,
 * ai-runtime) e dentro do worker, que é um processo separado sem o container de
 * DI do Nest. Um serviço injetável exigiria transformar essas funções em classes
 * e propagar `await` por meia base de código. Aqui o cache mora no módulo e um
 * refresher em background o mantém fresco, então `flagBool('X')` continua sendo
 * uma leitura de memória — as assinaturas das funções não mudam nenhuma linha.
 *
 * ⚠️ CADA PROCESSO TEM O PRÓPRIO CACHE. API e worker recarregam
 * independentemente, então uma mudança no painel leva até REFRESH_INTERVAL_MS
 * para valer no worker. É o custo de não ter Redis pub/sub, e é aceitável:
 * nenhuma destas flags precisa de propagação instantânea.
 */

export type FlagType = 'boolean' | 'number' | 'string';

export interface FlagDefinition {
  key: string;
  type: FlagType;
  /** Nome curto para o painel. */
  label: string;
  /** O que acontece de fato ao mudar. Aparece no painel — escreva para o seu eu de daqui a 6 meses. */
  description: string;
  /** Comportamento histórico do código quando não há env nem override. */
  defaultValue: string;
  /** Quanto dói errar aqui. Ordena o painel e decide se pede confirmação. */
  risk: 'alto' | 'medio' | 'baixo';
  /** true = a vitrine VENDE isto. Desligar torna uma afirmação pública falsa. */
  soldOnSite?: boolean;
}

/**
 * O catálogo. Só chave listada aqui pode ser gravada pelo painel — o que impede
 * que um typo (`ENABLE_QUIK_GROUNDING`) crie uma flag fantasma que parece ligada
 * e não controla nada.
 */
export const FLAG_REGISTRY: readonly FlagDefinition[] = [
  {
    key: 'ENABLE_QUICK_GROUNDING',
    type: 'boolean',
    label: 'Grounding com candles reais',
    description:
      'Injeta OHLCV real, RSI, perfil de volume e mapa de eventos no prompt. DESLIGAR faz a IA voltar a "olhar o print e chutar o preço".',
    defaultValue: 'false',
    risk: 'alto',
    soldOnSite: true,
  },
  {
    key: 'ENABLE_OUTCOME_TRACKING',
    type: 'boolean',
    label: 'Medição de acerto (sweeper 48h)',
    description:
      'Varredura horária que mede WIN/LOSS nos candles reais 48h depois da análise. DESLIGAR congela a página /accuracy: ela para de receber dado novo.',
    defaultValue: 'true',
    risk: 'alto',
    soldOnSite: true,
  },
  {
    key: 'ENABLE_MARKET_ENRICHMENT',
    type: 'boolean',
    label: 'Contexto de mercado no prompt',
    description:
      'Funding rate, open interest, long/short e Fear & Greed para cripto. Botão de emergência se a fonte externa começar a travar a análise.',
    defaultValue: 'true',
    risk: 'medio',
  },
  {
    key: 'ENABLE_NEWS_GUARD',
    type: 'boolean',
    label: 'Guarda de evento econômico',
    description:
      'Rebaixa o sinal quando há evento de alto impacto na janela. DESLIGAR faz o motor dar entrada em cima de payroll e CPI.',
    defaultValue: 'true',
    risk: 'medio',
  },
  {
    key: 'ENABLE_RR_GUARD',
    type: 'boolean',
    label: 'Guarda de risco/retorno',
    description:
      'Rebaixa o sinal quando o alvo não compensa o risco (R:R abaixo de 1.2). DESLIGAR deixa passar setup com retorno pior que o risco.',
    defaultValue: 'true',
    risk: 'medio',
  },
  {
    key: 'DEMO_MODE',
    type: 'boolean',
    label: 'Modo demo (resposta sintética)',
    description:
      'Permite fallback sintético quando a IA está indisponível. Ignorado em produção por segurança — existe só para ambiente de desenvolvimento.',
    defaultValue: 'false',
    risk: 'alto',
  },
  {
    key: 'EMAIL_ACTIVATION_NUDGE',
    type: 'boolean',
    label: 'E-mails para quem nao analisou',
    description:
      'Dois e-mails para quem criou conta e nao analisou: 1h depois ("send a screenshot") e no dia seguinte (video do celular). DESLIGADO: o worker so loga quem receberia ([lifecycle] dry-run). Ligar so com o texto aprovado.',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'EMAIL_SECOND_ANALYSIS_NUDGE',
    type: 'boolean',
    label: 'E-mail para quem fez 1 analise e sumiu',
    description:
      'Um e-mail, uma vez por pessoa, 24h a 72h depois da UNICA analise, se a pessoa nao voltou: se foi WAIT, explica que nao gastou e sugere outro grafico; se foi plano de trade, lembra que restam 2. DESLIGADO: so loga quem receberia ([lifecycle] dry-run). Ligar so com o texto aprovado.',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'EMAIL_CHECKOUT_WINBACK',
    type: 'boolean',
    label: 'E-mail de reativação de checkout',
    description:
      'Segundo e ultimo toque para quem abriu o checkout e nao assinou: uma vez por pessoa, 3 a 30 dias depois, com o plano semanal e a dica do banco. Ao ligar, alcanca quem tentou nos ultimos 30 dias. DESLIGADO: so loga quem receberia ([lifecycle] dry-run).',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'EMAIL_CHECKOUT_RECOVERY',
    type: 'boolean',
    label: 'E-mail de checkout abandonado',
    description:
      'Um e-mail, uma vez por pessoa, 1h a 24h depois de abrir o checkout sem assinar: link do semanal e, se o banco recusou, a dica de outro cartao ou de liberar compra internacional. DESLIGADO: so loga quem receberia.',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'EMAIL_ANALYSIS_RESULT',
    type: 'boolean',
    label: 'E-mail "o que aconteceu com a sua analise"',
    description:
      'Depois que o sistema mede o resultado de uma analise BUY/SELL (48h depois), avisa a pessoa por e-mail: alvo, stop, entrada nao atingida ou nada em 48h. Acerto e erro saem igual. No maximo 1 e-mail por pessoa por dia, juntando ate 5 analises, inclusive para assinante, respeitando o descadastro. Usa a mesma cota diaria da Resend. DESLIGADO: so loga quem receberia ([analysis-result] dry-run).',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'CHAT_EMAIL_NOTIFY',
    type: 'boolean',
    label: 'E-mails do chat com o fundador',
    description:
      'Dois avisos do chat do painel: para o suporte quando chega mensagem (no maximo 1 por conversa a cada 15 min, com o texto) e para a pessoa quando voce responde e ela nao leu em 10 min (no maximo 1 por conversa a cada 6 h, sem o texto, respeitando o descadastro). Usa a mesma cota diaria da Resend. DESLIGADO: so loga quem receberia ([chat] dry-run).',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'AB_PROMPT_V9_PERCENT',
    type: 'number',
    label: 'A/B do prompt v9 (% de usuários)',
    description:
      'Fatia de usuários que recebe o prompt v9. O sorteio é estável POR USUÁRIO, nunca por análise. 0 = desligado. Não subir junto com troca de modelo: os dois ao mesmo tempo invalidam o teste.',
    defaultValue: '0',
    risk: 'alto',
  },
] as const;

const REGISTRY_BY_KEY: ReadonlyMap<string, FlagDefinition> = new Map(
  FLAG_REGISTRY.map((definition) => [definition.key, definition]),
);

export function getFlagDefinition(key: string): FlagDefinition | undefined {
  return REGISTRY_BY_KEY.get(key);
}

export function isKnownFlag(key: string): boolean {
  return REGISTRY_BY_KEY.has(key);
}

// ── Cache dos overrides vindos do banco ─────────────────────────────────────

let dbOverrides = new Map<string, string>();
let lastLoadedAt: number | null = null;
let lastLoadError: string | null = null;

export type FlagSource = 'banco' | 'ambiente' | 'padrao';

export interface ResolvedFlag {
  key: string;
  value: string;
  source: FlagSource;
  definition: FlagDefinition;
}

/**
 * Resolve uma flag na ordem banco → ambiente → padrão, dizendo DE ONDE veio.
 * A origem importa tanto quanto o valor: "ligado, mas por env" e "ligado pelo
 * painel" são situações operacionais diferentes.
 */
export function resolveFlag(key: string): ResolvedFlag {
  const definition = REGISTRY_BY_KEY.get(key);
  if (!definition) {
    throw new Error(`[flags] Chave desconhecida: ${key}. Adicione-a ao FLAG_REGISTRY.`);
  }

  const override = dbOverrides.get(key);
  if (override !== undefined && override !== '') {
    return { key, value: override, source: 'banco', definition };
  }

  const fromEnv = String(process.env[key] ?? '').trim();
  if (fromEnv !== '') {
    return { key, value: fromEnv, source: 'ambiente', definition };
  }

  return { key, value: definition.defaultValue, source: 'padrao', definition };
}

/**
 * Booleano tolerante, DE PROPÓSITO.
 *
 * Só 'true'/'1' e 'false'/'0' são aceitos; qualquer outra coisa cai no padrão da
 * definição. Isto preserva exatamente a semântica que já existia no código, onde
 * cada flag tinha a sua própria: `ENABLE_QUICK_GROUNDING === 'true'` (padrão
 * DESLIGADO) convivia com `ENABLE_RR_GUARD !== 'false'` (padrão LIGADO).
 *
 * O ponto sutil: com a segunda semântica, um valor lixo como "sim" mantinha a
 * guarda LIGADA. Um parser ingênuo ("é 'true'? então ligado") desligaria a
 * guarda de risco calada por causa de um typo. Cair no padrão evita isso.
 */
export function flagBool(key: string): boolean {
  const { value, definition } = resolveFlag(key);
  const normalized = value.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;

  return definition.defaultValue.trim().toLowerCase() === 'true';
}

export function flagNumber(key: string): number {
  const { value, definition } = resolveFlag(key);
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return Number(definition.defaultValue) || 0;
}

/** Estado de todas as flags — é o que o painel /admin renderiza. */
export function resolveAllFlags(): ResolvedFlag[] {
  return FLAG_REGISTRY.map((definition) => resolveFlag(definition.key));
}

export function getFlagCacheStatus() {
  return {
    carregado: lastLoadedAt !== null,
    carregadoEm: lastLoadedAt ? new Date(lastLoadedAt).toISOString() : null,
    overridesNoBanco: dbOverrides.size,
    ultimoErro: lastLoadError,
  };
}

// ── Carga a partir do banco ─────────────────────────────────────────────────

/**
 * A única coisa que este módulo precisa do mundo externo: uma função que
 * devolva as linhas. Nem o PrismaService, nem o modelo gerado — só isto.
 *
 * Por que uma função e não `prisma.featureFlag`: o client do Prisma não pode
 * ser regenerado fora do Render (binaries.prisma.sh é inalcançável daqui), então
 * `prisma.featureFlag` não existe em tempo de compilação na máquina de
 * desenvolvimento. O acesso à tabela é feito por SQL cru no
 * FeatureFlagsService — mesmo padrão que a DemoUsage já usa. Depender só de uma
 * função também deixa este arquivo testável sem banco nenhum.
 */
export type FlagLoader = () => Promise<Array<{ key: string; value: string }>>;

/**
 * Recarrega os overrides do banco. NUNCA lança.
 *
 * Se a tabela não existir ainda (migração não rodou) ou o banco estiver fora,
 * o cache anterior é preservado e tudo continua resolvendo por env. Uma flag
 * jamais pode ser motivo novo de queda — ela existe justamente para ser o
 * botão de emergência quando outra coisa quebra.
 */
export async function loadFlagsFromDb(load: FlagLoader): Promise<boolean> {
  try {
    const rows = await load();
    const next = new Map<string, string>();
    for (const row of rows) {
      if (isKnownFlag(row.key)) {
        next.set(row.key, String(row.value ?? ''));
      }
      // Chave fora do registro é ignorada de propósito: sobra de flag removida
      // do código não deve influenciar nada nem poluir o painel.
    }
    dbOverrides = next;
    lastLoadedAt = Date.now();
    lastLoadError = null;
    return true;
  } catch (error) {
    lastLoadError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

export const FLAG_REFRESH_INTERVAL_MS = 60_000;

/**
 * Mantém o cache fresco. Chamado uma vez por processo (API e worker separados).
 * Devolve a função de parada — usada nos testes para não vazar timer.
 */
export function startFlagRefresh(
  load: FlagLoader,
  intervalMs: number = FLAG_REFRESH_INTERVAL_MS,
): () => void {
  void loadFlagsFromDb(load);

  const timer = setInterval(() => {
    void loadFlagsFromDb(load);
  }, intervalMs);

  // unref: o refresher não pode segurar o processo vivo sozinho.
  if (typeof timer.unref === 'function') timer.unref();

  return () => clearInterval(timer);
}

/** Aplica um override em memória na hora (usado logo após o painel gravar). */
export function applyFlagOverrideLocally(key: string, value: string | null): void {
  if (value === null) {
    dbOverrides.delete(key);
    return;
  }
  dbOverrides.set(key, value);
}

/** Só para teste: zera o cache entre casos. */
export function __resetFlagCacheForTests(): void {
  dbOverrides = new Map();
  lastLoadedAt = null;
  lastLoadError = null;
}
