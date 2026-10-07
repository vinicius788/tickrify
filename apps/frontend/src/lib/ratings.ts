import { useEffect, useState } from 'react';
import { buildApiUrl } from './api';

/**
 * Notas por analise e depoimentos (07/10/2026). Arquivo proprio: as chamadas
 * sao pequenas e nao precisam da maquinaria de retentativa do apiClient.
 */
export const RATING_REASONS = ['levels_off', 'too_many_waits', 'hard_to_understand', 'too_slow', 'wrong_symbol', 'other'] as const;
export type RatingReason = (typeof RATING_REASONS)[number];

export type Testimonial = { comment: string; displayName: string | null; country: string | null };

async function send<T>(path: string, init: RequestInit, token?: string | null): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`ratings_${response.status}`);
  return (await response.json()) as T;
}

export function rateAnalysis(analysisId: string, rating: number, token: string) {
  return send<{ id: string }>('/api/ratings', { method: 'POST', body: JSON.stringify({ analysisId, rating }) }, token);
}

export function addRatingDetails(
  ratingId: string,
  details: { reasons?: RatingReason[]; comment?: string; quoteConsent?: boolean; displayName?: string },
  token: string,
) {
  return send<{ id: string }>(`/api/ratings/${ratingId}`, { method: 'PATCH', body: JSON.stringify(details) }, token);
}

export async function getTestimonials(): Promise<Testimonial[]> {
  try {
    const data = await send<{ items?: Testimonial[] }>('/api/ratings/testimonials', { method: 'GET' });
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

export type AdminRating = {
  id: string;
  rating: number;
  reasons: string[] | null;
  comment: string | null;
  quoteConsent: boolean;
  displayName: string | null;
  country: string | null;
  recommendation: string | null;
  published: boolean;
  createdAt: string;
  userEmail: string | null;
};

export function adminListRatings(token: string) {
  return send<{ items: AdminRating[]; averages: Array<{ recommendation: string | null; average: number | null; count: number }> }>(
    '/api/admin/ratings',
    { method: 'GET' },
    token,
  );
}

export function adminPublishRating(id: string, input: { published: boolean; displayName?: string; country?: string }, token: string) {
  return send<{ id: string; published: boolean }>(`/api/admin/ratings/${id}`, { method: 'PATCH', body: JSON.stringify(input) }, token);
}

/** Frequencia do pedido no painel: no maximo 1 vez por semana; respondeu, 30 dias. */
const ASKED_KEY = 'tickrify-rating-asked-at';
const ANSWERED_KEY = 'tickrify-rating-answered-at';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function readTime(key: string): number {
  try {
    return Number(window.localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeNow(key: string) {
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    /* sem storage: so pergunta de novo */
  }
}

export function shouldAskRating(now = Date.now()): boolean {
  return now - readTime(ASKED_KEY) > WEEK_MS && now - readTime(ANSWERED_KEY) > MONTH_MS;
}

export const markRatingAsked = () => writeNow(ASKED_KEY);
export const markRatingAnswered = () => writeNow(ANSWERED_KEY);

/** Minimo de depoimentos reais para a secao existir. Sem dado real, nao aparece. */
export const MIN_TESTIMONIALS = 2;

let testimonialsPromise: Promise<Testimonial[]> | null = null;

/** Depoimentos publicados (uma busca por carregamento de pagina, dividida entre as telas). */
export function useTestimonials(): Testimonial[] {
  const [items, setItems] = useState<Testimonial[]>([]);
  useEffect(() => {
    let alive = true;
    testimonialsPromise ??= getTestimonials();
    void testimonialsPromise.then((list) => {
      if (alive) setItems(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  return items.length >= MIN_TESTIMONIALS ? items : [];
}
