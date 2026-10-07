import type { Analysis, Usage } from './api';
import type { Rect } from './crop';
import type { PageMeta, Platform } from './platform';

export type ErrorReason = 'permission' | 'auth' | 'timeout' | 'network' | 'server' | 'failed';

/** O que o painel mostra quando quem manda e o service worker. */
export type PanelView =
  | { kind: 'signin' }
  // Logo depois do clique, enquanto confere login e cota.
  | { kind: 'starting' }
  | { kind: 'paywall'; usage: Usage | null }
  | { kind: 'analyzing'; meta: PageMeta }
  // `restored`: reaberto pelo menu "Show my last Tickrify analysis" (sem linhas:
  // o grafico ja pode ter mudado desde o print).
  | { kind: 'result'; analysis: Analysis; usage: Usage | null; rect: Rect; meta: PageMeta; restored?: boolean }
  | { kind: 'empty' }
  // `detail`: mensagem tecnica curta do erro (ex.: codigo do Clerk) para o suporte.
  | { kind: 'error'; reason: ErrorReason; detail?: string };

/** Service worker -> content script. */
export type ToContent =
  | { type: 'tk:ping' }
  // Chega 2 a 4 s depois do resultado: so acrescenta as linhas, nao reabre o painel.
  | { type: 'tk:axis'; analysisId: string; axis: { top: number; bottom: number } }
  | { type: 'tk:start'; platform: Platform; usage: Usage }
  | { type: 'tk:view'; view: PanelView };

/** O que chega ao painel (o ping so responde que o painel existe). */
export type PanelMessage = Extract<ToContent, { type: 'tk:start' | 'tk:view' | 'tk:axis' }>;

/** Content script -> service worker. */
export type ToBackground =
  | { type: 'tk:capture'; rect: Rect; viewport: { width: number; height: number }; platform: Platform; meta: PageMeta }
  | { type: 'tk:again' }
  | { type: 'tk:remind'; minutes: number; label: string };

export type CaptureReply = { ok: true } | { ok: false; reason: ErrorReason };
