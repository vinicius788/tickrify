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
    key: 'PROMPT_VARIANT_B_PERCENT',
    type: 'number',
    label: 'Teste A/B do prompt: % na variante B',
    description:
      'Porcentagem de contas que recebem o prompt B (nivel de entrada no primeiro pullback com estrutura, nao no mais profundo). 0 (padrao) = todos no atual; 100 = todos na B. Desligada por decisao do dono em 09/11/2026: no replay a B piorou o nivel longe demais. A decisao sai pronta na aba Motor.',
    defaultValue: '0',
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
    key: 'CHAT_FEEDBACK_ASK',
    type: 'boolean',
    label: 'Chat: fundador pede feedback ao entrar',
    description:
      'Quem ja fez pelo menos 1 analise e ainda nao tem conversa recebe, ao abrir o painel, uma mensagem curta do fundador no chat pedindo opiniao sobre a plataforma (a bolha mostra 1 nova). Uma vez por pessoa, sem e-mail. A resposta chega no /admin > Chat como qualquer mensagem. DESLIGADO: nada muda. Ligar so com o texto aprovado.',
    defaultValue: 'false',
    risk: 'baixo',
  },
  {
    key: 'EMAIL_PAYMENT_FAILED',
    type: 'boolean',
    label: 'E-mail de pagamento recusado (Resend)',
    description:
      'Quando a renovacao da assinatura e recusada (past_due/unpaid): um e-mail pela Resend com o botao que leva a Settings para trocar o cartao. Uma vez por fatura, na primeira recusa; as retentativas da Stripe nao repetem. DESLIGADO: so loga quem receberia ([mail] dry-run kind=payment_failed). Ligar so com o texto aprovado; com ele ligado, desligar o e-mail de falha da propria Stripe para nao mandar dois.',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'EMAIL_CANCELLATION_CONFIRM',
    type: 'boolean',
    label: 'E-mail de confirmacao de cancelamento',
    description:
      'Quando a pessoa agenda o cancelamento no portal da Stripe: um e-mail com a data em que o acesso termina e como reativar em Settings. Uma vez por assinatura e data. DESLIGADO: so loga quem receberia ([mail] dry-run kind=cancellation_confirm). Ligar so com o texto aprovado.',
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
    key: 'TELEGRAM_SETUP_ALERTS',
    type: 'boolean',
    label: 'Alerta de nivel pelo Telegram',
    description:
      'Quando o preco toca o nivel vigiado, quem ligou a conta ao bot recebe a mensagem no Telegram na mesma volta, e o e-mail daquele alerta nao sai (poupa a cota da Resend). No maximo 20 mensagens por pessoa em 24h. Exige TELEGRAM_BOT_TOKEN no Render. DESLIGADO: so loga quem receberia ([telegram] dry-run).',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'EMAIL_SETUP_ALERTS',
    type: 'boolean',
    label: 'E-mail de alerta de nivel do setup',
    description:
      'Quando o preco toca o nivel que a pessoa pediu para vigiar (entrada, stop, alvo, invalidacao ou digitado), avisa por e-mail com o link para atualizar o grafico. No maximo 1 e-mail por setup a cada 12h e 3 por pessoa em 24h, respeitando o descadastro. Usa a mesma cota diaria da Resend. DESLIGADO: o alerta dispara na tela e so loga quem receberia ([setup-alert] dry-run).',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'ENABLE_SETUP_CONTINUATION',
    type: 'boolean',
    label: 'Continuacao do setup na analise',
    description:
      'Quando o trader atualiza um setup cujo WATCH ainda vale, no mesmo ativo, a IA recebe o plano anterior, le o grafico de novo e diz se ele foi confirmado, segue esperando, mudou ou foi invalidado. Os checks e o estado seguem as mesmas regras. Muda a entrada do modelo (uma medicao separa essas analises por result.engine.continuation). DESLIGADO: o prompt fica igual ao de sempre.',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'ENABLE_QUICK_CALENDAR',
    type: 'boolean',
    label: 'Calendario economico na analise rapida',
    description:
      'A analise rapida passa a receber o mesmo bloco de calendario que a deep ja recebe: eventos de impacto alto ou medio das proximas 24h para as moedas do ativo. Sem custo de IA a mais (so texto no prompt) e buscado em paralelo com as velas. Muda a ENTRADA do modelo: medir o estado das analises antes e depois (WATCH, NO_TRADE, ENTER_NOW) antes de deixar ligado. Print velho e fonte do calendario fora do ar: nada entra. DESLIGADO: identico ao de sempre.',
    defaultValue: 'false',
    risk: 'alto',
  },
  {
    key: 'ENGINE_MARKET_PLAN_ON_WATCH',
    type: 'boolean',
    label: 'WATCH mostra tambem o plano a mercado',
    description:
      'Em analise com velas reais que termina em WATCH, quando a entrada a mercado tem geometria valida (risco ate 2 ATR, alvo a 1R ou mais) e foi o checklist ou o movimento atrasado que segurou o ENTER_NOW, a tela mostra os dois planos lado a lado: entrar agora e esperar o nivel. O estado continua WATCH, o rastreador e a /accuracy nao mudam. Motivo: em 15.966 momentos medidos (10/11/2026), nem o item C7 nem o atrasado separaram acerto de erro. DESLIGADO: identico ao de sempre.',
    defaultValue: 'false',
    risk: 'alto',
  },
  {
    key: 'ENGINE_ENTER_AT_LEVEL',
    type: 'boolean',
    label: 'Entrada no nivel do WATCH',
    description:
      'So vale com a continuacao do setup ligada: na reanalise em que o preco esta dentro da zona do WATCH anterior, na mesma direcao, e a IA diz CONFIRMED, o movimento nao conta como atrasado. O resto das regras nao muda. DESLIGADO: identico ao motor de sempre.',
    defaultValue: 'false',
    risk: 'alto',
  },
  {
    key: 'ENGINE_SNAP_FALLBACK',
    type: 'number',
    label: 'Plano sem swing encaixada na invalidacao',
    description:
      '0 (padrao) = motor de sempre: sem swing real a ate 0,5 ATR da invalidacao do modelo, o plano vira No trade. 1 = o plano segue com a invalidacao do proprio modelo, no maximo ate Watch. 2 = segue tambem ate Enter now. Risco de 0,5 a 2 ATR, alvo a 1R, checklist e atrasado continuam valendo. Grava result.snapFallback para medir a serie separada. Valor invalido cai no 0.',
    defaultValue: '0',
    risk: 'alto',
  },
  {
    key: 'ENGINE_ENTER_REQUIRED_CHECKS',
    type: 'number',
    label: 'Itens obrigatorios do Enter now',
    description:
      '0 (padrao) = C2, C3, C6 e C7 em PASS. 1 = C2, C3 e C6 (C7 em FAIL deixa de barrar). 2 = C3 e C6 (C2 e C7 deixam de barrar). O minimo de PASS (5, ou 6 com agravante) nao muda; so vale com velas reais. Grava result.entryWarnings com os itens em FAIL. Nao ligar antes de a tela mostrar o aviso. Valor invalido cai no 0.',
    defaultValue: '0',
    risk: 'alto',
  },
  {
    key: 'ENGINE_PERMISSIVE',
    type: 'number',
    label: 'Modo permissivo do Enter now',
    description:
      '0 (padrao) = motor de sempre. 1 = Enter now sai com direcao, C3 e C6 em PASS, geometria valida (risco de 0,5 a 2 ATR, alvo a 1R) e 4 de 7 PASS. C2, C7, movimento atrasado, contra o 4h e forex deixam de barrar e viram avisos na tela; sem swing encaixada vale a invalidacao do modelo. Seguem barrando: plano invalidado, geometria invalida, noticias, print velho e imagem que nao e grafico. Serie propria na aba Motor (result.permissiveEntry). Valor invalido cai no 0.',
    defaultValue: '0',
    risk: 'alto',
  },
  {
    key: 'ENGINE_LATE_AS_WARNING',
    type: 'boolean',
    label: 'Movimento atrasado vira aviso',
    description:
      'DESLIGADO (padrao) = movimento atrasado (3 pernas, vela de 2 ATR ou perna atual maior que a anterior) rebaixa o Enter now para Watch. LIGADO = nao rebaixa: o Enter now sai com o aviso de movimento esticado na tela e grava o item 8 em result.entryWarnings. Geometria, checklist e noticias continuam valendo. Serie propria na aba Motor.',
    defaultValue: 'false',
    risk: 'alto',
  },
  {
    key: 'ENGINE_WATCH_ON_REJECTED_GEOMETRY',
    type: 'boolean',
    label: 'Watch em vez de No trade sem geometria',
    description:
      'DESLIGADO (padrao) = Watch do modelo sem entrada valida a mercado nem no nivel vira No trade. LIGADO = segue Watch com a zona e a invalidacao, sem stop nem alvo (a tela ja trata esse caso). Nunca vira Enter now. C3 e o minimo de 4 PASS continuam valendo.',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'PROMPT_VARIANT_C_PERCENT',
    type: 'number',
    label: 'Prompt C: % das contas',
    description:
      'Porcentagem de contas que recebem o prompt C (invalidacao no preco exato da swing, lado oposto so neutraliza com setup proprio, Enter now quando as condicoes valem, tese fraca mas valida vira Watch). 0 (padrao) = ninguem; 10 = 10% das contas. Quem esta na variante B fica na B. O resultado sai por variante na aba Motor.',
    defaultValue: '0',
    risk: 'alto',
  },
  {
    key: 'SETUP_ALERT_NEAR',
    type: 'boolean',
    label: 'Aviso de preco perto do nivel',
    description:
      'LIGADO = o monitor de alertas marca o alerta como "perto" quando o ultimo preco fica a ate 0,5 ATR do nivel (uma vez por alerta) e o painel mostra "Price is close". Nao e sinal de entrada, nao manda e-mail e nao chama IA. DESLIGADO (padrao): nada muda.',
    defaultValue: 'false',
    risk: 'baixo',
  },
  {
    key: 'ENTER_NOW_AUTO_ALERTS',
    type: 'boolean',
    label: 'Alertas automaticos de alvo e stop no Enter now',
    description:
      'LIGADO = todo Enter now com velas reais cria sozinho dois alertas no setup (TP1 e stop), que expiram em 48h; o disparo usa o painel, o e-mail e o Telegram que ja existem. Respeita os tetos de alertas. DESLIGADO (padrao): nada muda.',
    defaultValue: 'false',
    risk: 'baixo',
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
    key: 'TRIAL_MODE',
    type: 'boolean',
    label: 'Trial de 3 dias (no lugar das 3 analises gratis)',
    description:
      'Conta que ainda nao fez nenhuma analise gratis ganha o trial de 3 dias de uso (3, 2 e 2 analises por dia, ate 7 dias, sem cartao) na primeira visita ao painel. Quem ja usou a regra antiga continua nela. Ao ligar, conferir os textos da vitrine ("3 free trade plans"): passam a ser falsos para conta nova. DESLIGADO: nada muda.',
    defaultValue: 'false',
    risk: 'alto',
  },
  {
    key: 'TRIAL_REACTIVATION',
    type: 'boolean',
    label: 'Reativacao com trial (quem esgotou as gratis antigas)',
    description:
      'Libera, no /admin, conceder o trial de 3 dias a quem esgotou a regra antiga e nunca assinou. Ligar sozinho NAO concede nem envia nada: a concessao exige confirmacao no painel.',
    defaultValue: 'false',
    risk: 'medio',
  },
  {
    key: 'EMAIL_TRIAL_SEQUENCE',
    type: 'boolean',
    label: 'E-mails do trial de 3 dias',
    description:
      'Sequencia do trial: convite a 1a analise (~3h), volta no dia 2 e no dia 3 (de manha no fuso da pessoa), fim do trial (na hora e +2 dias) e semanal 5 e 10 dias depois. No maximo 1 e-mail por pessoa por dia, para ao assinar, respeita o descadastro. DESLIGADO: so loga quem receberia ([lifecycle] dry-run).',
    defaultValue: 'false',
    risk: 'medio',
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
 * DESLIGADO) convivia com `ENABLE_NEWS_GUARD !== 'false'` (padrão LIGADO).
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


/** Numero da flag; valor que nao e numero cai no padrao da definicao. */
export function flagNumber(key: string): number {
  const { value, definition } = resolveFlag(key);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number(definition.defaultValue);
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
