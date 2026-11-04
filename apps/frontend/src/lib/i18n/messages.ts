import { formatNumber, interpolate, type Language, type Translations } from './index';

export type DisplayMessage = { code: string; params?: Record<string, string | number>; text?: string };
const aliases: Record<string, keyof Translations['backendMessages']> = {
  price_invalid: 'price_not_found', price_not_configured: 'price_not_found', invalid_checkout_url: 'checkout_url_missing',
  openai_invalid_json: 'analysis_failed', openai_refusal: 'analysis_failed',
  processing_unclassified: 'analysis_failed', processing_failed_unclassified: 'analysis_failed',
};

/** Unknown codes and old records retain their original text. Never translate model prose. */
export function messageText(t: Translations, language: Language, code: unknown, params: unknown, original: string): string {
  if (typeof code !== 'string') return original;
  const key = aliases[code] ?? code;
  if (!Object.prototype.hasOwnProperty.call(t.backendMessages, key)) return original;
  const template = t.backendMessages[key as keyof typeof t.backendMessages];
  const values: Record<string, string | number> = {};
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    for (const [name, value] of Object.entries(params)) {
      if (typeof value === 'number' && Number.isFinite(value)) values[name] = formatNumber(value, language, { maximumFractionDigits: 10 });
      else if (typeof value === 'string') values[name] = value;
    }
  }
  if ([...template.matchAll(/\{(\w+)\}/g)].some(match => values[match[1]] === undefined)) return original;
  return interpolate(template, values);
}

export function errorText(t: Translations, language: Language, error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const e = error as { code?: unknown; params?: unknown; message?: unknown; details?: unknown };
  const original = typeof e.message === 'string' && e.message ? e.message : fallback;
  if (e.code === 'validation_failed' && Array.isArray(e.details)) {
    const details = e.details.map((detail: DisplayMessage) => messageText(t, language, detail?.code, detail?.params, detail?.text ?? '')).filter(Boolean).join('; ');
    return details ? messageText(t, language, e.code, { details }, original) : original;
  }
  // Preserve the existing English error verbatim, including provider details.
  if (language === 'en') return original;
  return messageText(t, language, e.code, e.params, original);
}

/** Replace only the exact server-added span identified by metadata. */
export function translatedAnnotation(t: Translations, language: Language, text: string, value: unknown): string {
  if (!value || typeof value !== 'object') return text;
  const message = value as DisplayMessage;
  if (!message.text || !text.includes(message.text)) return text;
  return text.replace(message.text, () => messageText(t, language, message.code, message.params, message.text!));
}
