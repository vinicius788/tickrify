/**
 * Migalhas: as últimas coisas que aconteceram antes do usuário reclamar.
 *
 * POR QUE ISTO EXISTE
 * O relato típico é "não funcionou" ou "deu erro". Sozinho, isso não é
 * reproduzível e o bug morre em "não consegui reproduzir". As migalhas viram o
 * relato em algo acionável: qual rota, qual chamada falhou, com que código, e
 * quanto tempo antes do clique no botão.
 *
 * DECISÕES DELIBERADAS
 * - Anel de 30 eventos, só em memória. Não persiste, não vai para lugar nenhum
 *   sozinho: só viaja quando o usuário CLICA em reportar. Telemetria silenciosa
 *   não é o que este arquivo é.
 * - Nunca registra corpo de requisição, token, e-mail ou qualquer valor de
 *   formulário. Só rota, ação, código de status e duração — o suficiente para
 *   reproduzir, sem transformar o relato num vazamento de dado do usuário.
 * - Zero dependências novas.
 */

export interface Migalha {
  em: number;
  tipo: 'rota' | 'api' | 'erro' | 'acao';
  texto: string;
}

const LIMITE = 30;
const anel: Migalha[] = [];

export function registrarMigalha(tipo: Migalha['tipo'], texto: string): void {
  anel.push({ em: Date.now(), tipo, texto: String(texto).slice(0, 200) });
  if (anel.length > LIMITE) anel.shift();
}

/** Formata as migalhas como linhas legíveis, com o tempo relativo ao clique. */
export function lerMigalhas(): string[] {
  const agora = Date.now();
  return anel.map((m) => {
    const segundos = Math.round((agora - m.em) / 1000);
    return `-${segundos}s [${m.tipo}] ${m.texto}`;
  });
}

export function limparMigalhas(): void {
  anel.length = 0;
}

/**
 * Contexto técnico do navegador no momento do relato.
 *
 * Tudo aqui é informação de AMBIENTE, nunca de conteúdo: nada do que o usuário
 * digitou entra, exceto a mensagem que ele escreveu de propósito no formulário.
 */
export function coletarContexto(): Record<string, unknown> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;

  return {
    urlCompleta: win?.location?.href?.slice(0, 300) ?? null,
    navegador: nav?.userAgent ?? null,
    idioma: nav?.language ?? null,
    online: nav?.onLine ?? null,
    tela: win ? `${win.innerWidth}x${win.innerHeight}` : null,
    fuso: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    quando: new Date().toISOString(),
    migalhas: lerMigalhas(),
  };
}

// ── Análise aberta na tela ──────────────────────────────────────────────────
//
// O botão de reportar é montado uma vez, globalmente, e não tem como saber qual
// análise está aberta — o id não está na URL. Este registro em memória é a
// ponte: a tela de resultado avisa qual análise está mostrando, e o relato sai
// com `analysisId` preenchido (coluna própria no banco, filtrável, em vez de
// texto solto no meio das migalhas).

let analiseAtual: string | null = null;

export function definirAnaliseAtual(id: string | null): void {
  analiseAtual = id;
  if (id) registrarMigalha('acao', `abriu a análise ${id}`);
}

export function lerAnaliseAtual(): string | undefined {
  return analiseAtual ?? undefined;
}
