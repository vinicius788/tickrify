/**
 * Meta Conversions API (eventos do SERVIDOR para o Meta).
 *
 * Usado para os eventos criticos: CompleteRegistration, InitiateCheckout e
 * Purchase. O pixel do navegador manda os mesmos eventos com o MESMO
 * `event_id`, e o Meta descarta o repetido (deduplicacao navegador/servidor):
 *   signup_<id do Clerk> · checkout_<id da Checkout Session> · purchase_<id da Checkout Session>
 *
 * Consentimento: so envia quando o navegador informou aceite de cookies de
 * marketing (`consent: true`). O backend nao manda evento de anuncio de quem
 * recusou, do mesmo jeito que o pixel nao carrega para essa pessoa.
 *
 * Variaveis (Render):
 *   META_PIXEL_ID            obrigatoria para ligar (mesmo id do VITE_META_PIXEL_ID)
 *   META_CAPI_ACCESS_TOKEN   obrigatoria para ligar (Events Manager > Configuracoes)
 *   META_CAPI_TEST_EVENT_CODE opcional: manda para "Eventos de teste" do Events Manager
 *   META_GRAPH_API_VERSION   opcional, padrao v25.0 (valida ate jul/2028)
 * Sem as duas obrigatorias, tudo aqui vira no-op e o boot diz isso no log.
 *
 * SEGURANCA: o token vai no CORPO da requisicao, nunca na URL, e nunca e
 * logado. E-mail e id do usuario vao com hash SHA-256, como o Meta exige.
 */
import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';

const logger = new Logger('MetaCAPI');

export type MetaEventName = 'CompleteRegistration' | 'InitiateCheckout' | 'Purchase';

export type MetaAdsContext = {
  /** Aceite de cookies de marketing informado pelo navegador. */
  consent: boolean;
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type MetaEvent = {
  eventName: MetaEventName;
  eventId: string;
  eventTime?: Date;
  eventSourceUrl?: string;
  user: { externalId: string; email?: string | null };
  ads: MetaAdsContext;
  customData?: { value?: number; currency?: string; contentName?: string };
};

// Formatos do Meta: fb.<subdominio>.<timestamp ms>.<valor>. Validar evita
// repassar lixo ou texto arbitrario do cliente para um terceiro.
const FBP_RE = /^fb\.\d\.\d{10,13}\.\d{3,20}$/;
const FBC_RE = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/;

export function isValidFbp(value: unknown): value is string {
  return typeof value === 'string' && FBP_RE.test(value);
}

export function isValidFbc(value: unknown): value is string {
  return typeof value === 'string' && FBC_RE.test(value);
}

function config() {
  return {
    pixelId: String(process.env.META_PIXEL_ID || '').trim(),
    token: String(process.env.META_CAPI_ACCESS_TOKEN || '').trim(),
    testCode: String(process.env.META_CAPI_TEST_EVENT_CODE || '').trim(),
    version: String(process.env.META_GRAPH_API_VERSION || 'v25.0').trim(),
  };
}

/** Linha de boot: diz se esta ligado, sem revelar nada da chave. */
export function describeMetaCapi(): string {
  const c = config();
  if (!c.pixelId || !c.token) return 'Meta CAPI: OFF (META_PIXEL_ID/META_CAPI_ACCESS_TOKEN ausentes)';
  return `Meta CAPI: ON (pixel ${c.pixelId}, ${c.version}${c.testCode ? ', MODO TESTE' : ''})`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/** Monta o corpo de UM evento no formato da API. Exportado para teste. */
export function buildMetaPayload(event: MetaEvent): Record<string, unknown> {
  const userData: Record<string, unknown> = {
    external_id: [sha256(event.user.externalId)],
  };
  if (event.user.email) userData.em = [sha256(event.user.email)];
  if (isValidFbp(event.ads.fbp)) userData.fbp = event.ads.fbp;
  if (isValidFbc(event.ads.fbc)) userData.fbc = event.ads.fbc;
  if (event.ads.ip) userData.client_ip_address = event.ads.ip;
  if (event.ads.userAgent) userData.client_user_agent = event.ads.userAgent.slice(0, 500);

  const customData: Record<string, unknown> = {};
  if (typeof event.customData?.value === 'number') customData.value = Number(event.customData.value.toFixed(2));
  if (event.customData?.currency) customData.currency = event.customData.currency.toUpperCase();
  if (event.customData?.contentName) customData.content_name = event.customData.contentName;

  return {
    event_name: event.eventName,
    event_time: Math.floor((event.eventTime ?? new Date()).getTime() / 1000),
    event_id: event.eventId,
    action_source: 'website',
    ...(event.eventSourceUrl ? { event_source_url: event.eventSourceUrl } : {}),
    user_data: userData,
    ...(Object.keys(customData).length ? { custom_data: customData } : {}),
  };
}

/**
 * Envia um evento. Nunca lanca: falha de anuncio nao pode derrubar cadastro,
 * checkout nem webhook. Devolve se foi aceito, para log e teste.
 */
export async function sendMetaEvent(event: MetaEvent): Promise<boolean> {
  if (!event.ads.consent) return false;
  const c = config();
  if (!c.pixelId || !c.token) return false;

  try {
    const response = await fetch(`https://graph.facebook.com/${c.version}/${c.pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [buildMetaPayload(event)],
        access_token: c.token,
        ...(c.testCode ? { test_event_code: c.testCode } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // Corpo de erro do Meta nao contem o token; mesmo assim, so o essencial.
      const body = (await response.json().catch(() => null)) as { error?: { message?: string; code?: number } } | null;
      logger.warn(
        `[meta-capi] ${event.eventName} event_id=${event.eventId} recusado: HTTP ${response.status} ` +
          `code=${body?.error?.code ?? '-'} ${String(body?.error?.message ?? '').slice(0, 200)}`,
      );
      return false;
    }
    logger.log(`[meta-capi] ${event.eventName} enviado event_id=${event.eventId}`);
    return true;
  } catch (error) {
    logger.warn(`[meta-capi] ${event.eventName} event_id=${event.eventId} falhou: ${(error as Error)?.message ?? error}`);
    return false;
  }
}
