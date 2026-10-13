import { getConsent } from './consent';
import { buildApiUrl } from './api';

const STORAGE_KEY = 'tickrify_attribution_v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface TechnicalAttributionPayload {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  clickId?: string;
  landingPath?: string;
  landingUrl?: string;
  referrer?: string;
  referrerDomain?: string;
  capturedAt?: string;
}

interface StoredAttribution {
  first?: TechnicalAttributionPayload;
  last?: TechnicalAttributionPayload;
  syncedAt?: string;
}

const PARAM_MAP: Array<[keyof TechnicalAttributionPayload, string[]]> = [
  ['utmSource', ['utm_source']],
  ['utmMedium', ['utm_medium']],
  ['utmCampaign', ['utm_campaign']],
  ['utmContent', ['utm_content']],
  ['utmTerm', ['utm_term']],
  ['campaignId', ['utm_id', 'campaign_id', 'campaignid']],
  ['adsetId', ['adset_id', 'adsetid']],
  ['adId', ['ad_id', 'adid']],
  ['clickId', ['fbclid', 'gclid', 'ttclid']],
];

// Onde a origem mora: sempre na aba (sessionStorage) e, SO com aceite de
// cookies, tambem no localStorage. Antes era so a aba: quem verificava o
// e-mail em outra aba, ou voltava no dia seguinte, chegava sem origem. Sem
// aceite continua so na aba, porque guardar fbclid/gclid de forma duravel e
// exatamente o que o consentimento existe para autorizar.
function durableAllowed(): boolean {
  return getConsent() === 'granted';
}

function readStored(): StoredAttribution {
  if (typeof window === 'undefined') return {};
  try {
    const raw =
      window.sessionStorage.getItem(STORAGE_KEY) ??
      (durableAllowed() ? window.localStorage.getItem(STORAGE_KEY) : null);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredAttribution;
    const capturedAt = parsed.first?.capturedAt ? new Date(parsed.first.capturedAt).getTime() : 0;
    if (capturedAt && Date.now() - capturedAt > MAX_AGE_MS) return {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStored(value: StoredAttribution): void {
  if (typeof window === 'undefined') return;
  try {
    const serialized = JSON.stringify(value);
    window.sessionStorage.setItem(STORAGE_KEY, serialized);
    if (durableAllowed()) window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    /* storage indisponivel: atribuicao tecnica simplesmente nao persiste */
  }
}

function referrerDomain(referrer: string): string | undefined {
  try {
    const url = new URL(referrer);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function clean(value: string | null): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed || undefined;
}

function buildSnapshot(): TechnicalAttributionPayload | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const snapshot: TechnicalAttributionPayload = {
    landingPath: `${url.pathname}${url.search}`.slice(0, 240),
    landingUrl: url.href.slice(0, 500),
    capturedAt: new Date().toISOString(),
  };

  for (const [target, params] of PARAM_MAP) {
    for (const param of params) {
      const value = clean(url.searchParams.get(param));
      if (value) {
        snapshot[target] = value;
        break;
      }
    }
  }

  const referrer = clean(document.referrer);
  if (referrer && !referrer.startsWith(url.origin)) {
    snapshot.referrer = referrer.slice(0, 500);
    snapshot.referrerDomain = referrerDomain(referrer);
  }

  const hasCampaignSignal =
    Boolean(snapshot.utmSource) ||
    Boolean(snapshot.utmCampaign) ||
    Boolean(snapshot.clickId) ||
    Boolean(snapshot.referrerDomain);

  return hasCampaignSignal ? snapshot : null;
}

export function captureTechnicalAttribution(): void {
  captureFbclid();
  const snapshot = buildSnapshot();
  if (!snapshot) return;
  const stored = readStored();
  writeStored({
    first: stored.first ?? snapshot,
    last: snapshot,
    syncedAt: stored.syncedAt,
  });
}

/** Primeiro e ultimo toque, para o PostHog (ver setAttributionContext). */
export function getAttributionTouches(): {
  first: TechnicalAttributionPayload | null;
  last: TechnicalAttributionPayload | null;
} {
  const stored = readStored();
  return { first: stored.first ?? null, last: stored.last ?? null };
}

export function getTechnicalAttributionPayload(): TechnicalAttributionPayload | null {
  const stored = readStored();
  return stored.last ?? stored.first ?? null;
}

export function markTechnicalAttributionSynced(): void {
  const stored = readStored();
  if (!stored.first && !stored.last) return;
  writeStored({ ...stored, syncedAt: new Date().toISOString() });
}

// ─── Meta: fbclid, fbp e fbc ────────────────────────────────────────────────
// O `fbclid` fica numa chave PROPRIA, fora do payload tecnico: o endpoint de
// atribuicao do backend rejeita campo desconhecido (forbidNonWhitelisted), e
// misturar quebraria a sincronizacao da origem. So com aceite de cookies.
const FBCLID_KEY = 'tickrify_fbclid_v1';

export function captureFbclid(): void {
  if (typeof window === 'undefined' || !durableAllowed()) return;
  try {
    const fbclid = new URL(window.location.href).searchParams.get('fbclid');
    if (!fbclid || !/^[A-Za-z0-9_-]{8,500}$/.test(fbclid)) return;
    window.localStorage.setItem(FBCLID_KEY, JSON.stringify({ fbclid, capturedAt: Date.now() }));
  } catch {
    /* noop */
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Identificadores do Meta para a Conversions API. `_fbp`/`_fbc` sao os cookies
 * do proprio pixel; se o `_fbc` nao existir (o pixel carregou depois que a URL
 * perdeu o fbclid), monta no formato do Meta a partir do fbclid guardado.
 * Sem aceite de cookies: nada.
 */
export function getMetaIds(): { fbp?: string; fbc?: string } {
  if (typeof window === 'undefined' || !durableAllowed()) return {};
  const out: { fbp?: string; fbc?: string } = {};
  try {
    const fbp = readCookie('_fbp');
    if (fbp) out.fbp = fbp;
    const fbc = readCookie('_fbc');
    if (fbc) {
      out.fbc = fbc;
    } else {
      const stored = JSON.parse(window.localStorage.getItem(FBCLID_KEY) || 'null') as { fbclid?: string; capturedAt?: number } | null;
      if (stored?.fbclid && stored.capturedAt) out.fbc = `fb.1.${stored.capturedAt}.${stored.fbclid}`;
    }
  } catch {
    /* noop */
  }
  return out;
}

// MESMAS regras dos DTOs do backend. Mandar valor fora do formato faria o
// ValidationPipe recusar a requisicao inteira: um cookie estranho do pixel
// derrubaria o CHECKOUT. Fora do formato, o campo simplesmente nao vai.
const FBP_RE = /^fb\.\d\.\d{10,13}\.\d{3,20}$/;
const FBC_RE = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/;

/** Corpo que o backend espera para eventos do Meta (ver DTOs do checkout e do ads-signup). */
export function getAdsPayload(): { adsConsent: boolean; fbp?: string; fbc?: string } {
  if (!durableAllowed()) return { adsConsent: false };
  const { fbp, fbc } = getMetaIds();
  return {
    adsConsent: true,
    ...(fbp && FBP_RE.test(fbp) ? { fbp } : {}),
    ...(fbc && FBC_RE.test(fbc) ? { fbc } : {}),
  };
}

// ─── Afiliados: ?ref= e cupom de parceiro ───────────────────────────────────
// Guardado SEM depender do aceite de cookies: e o que entrega ao visitante o
// desconto do link em que ele clicou (servico pedido por ele), e o conteudo e
// so o codigo publico do parceiro e o id aleatorio do clique, nada que
// identifique a pessoa. A janela de 30 dias vale no SERVIDOR (data do clique
// gravada la); o prazo daqui so evita mandar clique velho.
const REFERRAL_KEY = 'tickrify_referral_v1';
const REFERRAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const REFERRAL_RECOUNT_MS = 24 * 60 * 60 * 1000;
const AFFILIATE_CODE_RE = /^[A-Za-z0-9]{4,20}$/;
let referralInFlight: string | null = null;

export type ReferralKind = 'link' | 'coupon';

interface StoredReferral {
  code: string;
  kind: ReferralKind;
  clickId?: string;
  at: number;
  /** Usuarios (id do Clerk) para quem este vinculo ja foi enviado ao backend. */
  claimedBy?: string[];
}

// Copia em cookie de primeira parte (13/10/2026): o localStorage some em aba
// anonima reaberta, em WebView de app e quando o Safari limpa o armazenamento
// do site; o cookie cobre o caminho /try -> cadastro na Clerk -> checkout.
// So o codigo publico, o tipo e o id do clique (nada que identifique a pessoa).
const REFERRAL_COOKIE = 'tickrify_ref';

function parseReferral(raw: string | null): StoredReferral | null {
  try {
    const parsed = JSON.parse(raw || 'null') as StoredReferral | null;
    if (!parsed || !AFFILIATE_CODE_RE.test(parsed.code)) return null;
    if (Date.now() - parsed.at > REFERRAL_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readReferralCookie(): StoredReferral | null {
  try {
    const entry = document.cookie.split('; ').find((c) => c.startsWith(`${REFERRAL_COOKIE}=`));
    return entry ? parseReferral(decodeURIComponent(entry.slice(REFERRAL_COOKIE.length + 1))) : null;
  } catch {
    return null;
  }
}

function readReferral(): StoredReferral | null {
  if (typeof window === 'undefined') return null;
  let stored: StoredReferral | null = null;
  try {
    stored = parseReferral(window.localStorage.getItem(REFERRAL_KEY));
  } catch {
    stored = null;
  }
  return stored ?? readReferralCookie();
}

function writeReferral(value: StoredReferral): void {
  try {
    window.localStorage.setItem(REFERRAL_KEY, JSON.stringify(value));
  } catch {
    /* storage indisponivel: fica o cookie */
  }
  try {
    const { code, kind, clickId, at } = value;
    const maxAge = Math.max(0, Math.floor((at + REFERRAL_MAX_AGE_MS - Date.now()) / 1000));
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${REFERRAL_COOKIE}=${encodeURIComponent(JSON.stringify({ code, kind, clickId, at }))}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
  } catch {
    /* sem cookie: o vinculo fica so para o checkout desta visita */
  }
}

export function isAffiliateCode(value: string): boolean {
  return AFFILIATE_CODE_RE.test(value.trim());
}

/**
 * Visitante chegou com ?ref=CODIGO: o servidor valida o codigo, grava o
 * clique e devolve o id. Um cupom digitado antes vence o link (mesma regra do
 * backend), e o mesmo link reaberto no mesmo dia nao conta outro clique.
 */
export function captureReferral(pathname: string): void {
  if (typeof window === 'undefined') return;
  let ref: string | null = null;
  try {
    ref = new URL(window.location.href).searchParams.get('ref');
  } catch {
    return;
  }
  if (!ref || !isAffiliateCode(ref)) return;
  const code = ref.trim().toUpperCase();
  const current = readReferral();
  if (current?.kind === 'coupon') return;
  if (current?.code === code && Date.now() - current.at < REFERRAL_RECOUNT_MS) return;
  // Trocar de pagina antes da resposta nao conta um segundo clique.
  if (referralInFlight === code) return;
  referralInFlight = code;

  void fetch(buildApiUrl('/api/affiliates/track'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, kind: 'link', landingPath: pathname.slice(0, 240) }),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { valid?: boolean; clickId?: string } | null) => {
      if (data?.valid && data.clickId) writeReferral({ code, kind: 'link', clickId: data.clickId, at: Date.now() });
    })
    .catch(() => undefined)
    .finally(() => {
      referralInFlight = null;
    });
}

/** Cupom de parceiro digitado no site (ja validado). Vence qualquer link. */
export function saveReferralCoupon(code: string): void {
  writeReferral({ code: code.trim().toUpperCase(), kind: 'coupon', at: Date.now() });
}

export function getReferralCoupon(): string | null {
  const stored = readReferral();
  return stored?.kind === 'coupon' ? stored.code : null;
}

/** Corpo que o checkout manda (so identificacao; o desconto e o servidor que decide). */
export function getReferralPayload(): { affiliateCode?: string; affiliateKind?: ReferralKind; affiliateClickId?: string } {
  const stored = readReferral();
  if (!stored) return {};
  return {
    affiliateCode: stored.code,
    affiliateKind: stored.kind,
    ...(stored.kind === 'link' && stored.clickId ? { affiliateClickId: stored.clickId } : {}),
  };
}

/**
 * Depois do login: vincula a conta ao afiliado guardado. Uma vez por conta
 * neste navegador; falha de rede tenta de novo no proximo login.
 */
export async function claimReferral(userId: string, token: string): Promise<void> {
  const stored = readReferral();
  if (!stored || stored.claimedBy?.includes(userId)) return;
  const res = await fetch(buildApiUrl('/api/affiliates/claim'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code: stored.code, kind: stored.kind, ...(stored.clickId ? { clickId: stored.clickId } : {}) }),
  });
  if (!res.ok) return;
  writeReferral({ ...stored, claimedBy: [...(stored.claimedBy ?? []), userId] });
}
