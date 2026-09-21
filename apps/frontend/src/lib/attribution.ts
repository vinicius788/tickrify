import { getConsent } from './consent';

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
