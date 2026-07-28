/**
 * Veredito do trader — fonte ÚNICA de verdade.
 *
 * Extraído do MyTrades em 27/07/2026 porque o Dashboard passou a precisar da
 * mesma lógica (loop de cobrança do fechamento). Se cada tela tiver a sua
 * cópia, elas divergem na primeira mudança e o win rate exibido fica errado.
 *
 * IMPORTANTE — dois conceitos com nomes parecidos que NÃO podem se misturar:
 *   • `userVerdict` no banco = o que o TRADER diz que fez (isto aqui).
 *   • `outcome` no banco     = o que o MERCADO fez, medido pelo sweeper 48h
 *     depois (WIN/LOSS/ABSTAIN/...). Nunca é escrito por esta UI.
 * A API expõe o userVerdict no campo `outcome` da resposta, por retrocompat.
 */

export type Verdict = 'TP1' | 'TP2' | 'SL' | 'OPEN' | null;

/** Mesma chave de sempre — trocar aqui apagaria o histórico local de todo mundo. */
export const VERDICT_STORAGE_KEY = 'tickrify_verdicts';

/** Converte o valor do backend para o rótulo da UI. */
export function verdictFromOutcome(o: unknown): Verdict {
  switch (String(o || '')) {
    case 'tp1': return 'TP1';
    case 'tp2': return 'TP2';
    case 'stop': return 'SL';
    case 'open': return 'OPEN';
    default: return null;
  }
}

/** Converte o rótulo da UI para o valor aceito pelo backend. */
export function outcomeFromVerdict(v: Verdict): string | null {
  switch (v) {
    case 'TP1': return 'tp1';
    case 'TP2': return 'tp2';
    case 'SL': return 'stop';
    case 'OPEN': return 'open';
    default: return null;
  }
}

export function loadVerdicts(): Record<string, Verdict> {
  try { return JSON.parse(localStorage.getItem(VERDICT_STORAGE_KEY) || '{}'); } catch { return {}; }
}

export function saveVerdict(id: string, verdict: Verdict) {
  const all = loadVerdicts();
  if (verdict === null) { delete all[id]; } else { all[id] = verdict; }
  localStorage.setItem(VERDICT_STORAGE_KEY, JSON.stringify(all));
}

/**
 * Veredito efetivo de uma análise: o estado local (alteração recente, ainda
 * não confirmada pelo backend) tem prioridade sobre o que veio do banco.
 * É o que faz a escrita otimista parecer instantânea mesmo com o Render
 * hibernando e levando 30-50s para responder.
 */
export function resolveVerdict(
  analysis: { id: string; outcome?: unknown },
  local: Record<string, Verdict>,
): Verdict {
  if (Object.prototype.hasOwnProperty.call(local, analysis.id)) {
    return local[analysis.id] ?? null;
  }
  return verdictFromOutcome((analysis as unknown as Record<string, unknown>).outcome);
}

export const VERDICT_CFG = {
  TP1:  { bg: 'rgba(0,255,127,0.12)',   border: 'rgba(0,255,127,0.4)',  text: '#00FF7F' },
  TP2:  { bg: 'rgba(0,200,80,0.12)',    border: 'rgba(0,200,80,0.4)',   text: '#00C850' },
  SL:   { bg: 'rgba(255,68,68,0.12)',   border: 'rgba(255,68,68,0.4)',  text: '#FF4444' },
  OPEN: { bg: 'rgba(120,120,180,0.10)', border: 'rgba(120,120,180,0.3)', text: '#9999CC' },
} as const;

// ── Cobrança do fechamento (bloco do dashboard) ────────────────────────────

/**
 * Idade mínima antes de cobrar o fechamento de um trade em aberto.
 *
 * 12h é deliberado: cobrar o resultado de uma análise feita há 5 minutos é
 * irritante, não tem resposta possível, e ensina o usuário a ignorar o bloco —
 * que é exatamente o comportamento que mata este loop.
 */
export const VERDICT_MIN_AGE_MS = 12 * 60 * 60 * 1000;

/** Quantas linhas o bloco mostra por vez. O resto vai para o "ver todas". */
export const VERDICT_MAX_ROWS = 3;

const SNOOZE_KEY = 'tickrify_verdict_snooze';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** "Agora não" — esconde o bloco de cobrança por 24h. */
export function snoozeVerdictPrompt() {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch { /* storage indisponível */ }
}

export function isVerdictPromptSnoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    return Number.isFinite(at) && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}
