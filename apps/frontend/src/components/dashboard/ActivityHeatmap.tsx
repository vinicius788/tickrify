import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Flame } from 'lucide-react';
import { buildApiUrl } from '@/lib/api';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Heatmap de consistência (estilo GitHub) — últimos ~119 dias de análises.
 * Mecânica de hábito: o usuário volta pra não quebrar a sequência, e o card
 * é "printável" (as pessoas postam a própria disciplina → marketing grátis).
 * Auto-contido: busca o próprio dado; falha silenciosa nunca quebra o dashboard.
 */

interface DayCount {
  day: string; // 'YYYY-MM-DD'
  count: number;
}

const WEEKS = 17;

function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function levelFor(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  return 3;
}

const LEVEL_BG = [
  'rgba(154,163,174,0.12)', // 0 — vazio
  'rgba(94,234,138,0.30)', // 1
  'rgba(94,234,138,0.60)', // 2–3
  'rgba(94,234,138,1)', // 4+
];

export default function ActivityHeatmap() {
  const { getToken, isSignedIn } = useAuth();
  const { t } = useLanguage();
  const [days, setDays] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(buildApiUrl('/api/ai/activity'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { days?: DayCount[] };
        if (cancelled) return;
        const map = new Map<string, number>();
        (data.days ?? []).forEach((d) => map.set(d.day, d.count));
        setDays(map);
      } catch {
        // silencioso — o card simplesmente não aparece
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isSignedIn]);

  if (!days) return null;

  // Grade: WEEKS colunas (semanas, domingo em cima), terminando hoje.
  const today = new Date();
  const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (WEEKS * 7 - 1));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // alinha ao domingo

  const columns: Array<Array<{ key: string; count: number; inRange: boolean }>> = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const col: Array<{ key: string; count: number; inRange: boolean }> = [];
    for (let i = 0; i < 7; i++) {
      const key = toKey(cursor);
      col.push({ key, count: days.get(key) ?? 0, inRange: cursor <= end });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    columns.push(col);
  }

  // Sequência atual (termina hoje ou ontem — um dia de carência) e recorde.
  let currentStreak = 0;
  const probe = new Date(end);
  if ((days.get(toKey(probe)) ?? 0) === 0) probe.setUTCDate(probe.getUTCDate() - 1);
  while ((days.get(toKey(probe)) ?? 0) > 0) {
    currentStreak++;
    probe.setUTCDate(probe.getUTCDate() - 1);
  }
  let bestStreak = 0;
  let run = 0;
  const walker = new Date(start);
  while (walker <= end) {
    run = (days.get(toKey(walker)) ?? 0) > 0 ? run + 1 : 0;
    if (run > bestStreak) bestStreak = run;
    walker.setUTCDate(walker.getUTCDate() + 1);
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="tk-stat-label">{t.nav.heatTitle}</div>
        <div className="flex items-center gap-4 font-terminal text-[12px] text-[var(--text-secondary)]">
          <span className="flex items-center gap-1">
            <Flame className={`h-3.5 w-3.5 ${currentStreak > 0 ? 'text-[var(--accent-green)]' : 'opacity-40'}`} />
            <span className={currentStreak > 0 ? 'font-semibold text-[var(--text-primary)]' : ''}>
              {currentStreak}
            </span>
            {t.nav.heatStreak}
          </span>
          <span>
            {t.nav.heatBest}: <span className="font-semibold text-[var(--text-primary)]">{bestStreak}</span>
          </span>
        </div>
      </div>
      <div className="flex gap-[3px] overflow-x-auto pb-1" aria-label={t.nav.heatTitle}>
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[3px]">
            {col.map((cell) =>
              cell.inRange ? (
                <div
                  key={cell.key}
                  title={`${cell.key} · ${cell.count} ${t.nav.analysesWord}`}
                  className="h-[11px] w-[11px] rounded-[2px]"
                  style={{ background: LEVEL_BG[levelFor(cell.count)] }}
                />
              ) : (
                <div key={cell.key} className="h-[11px] w-[11px]" />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
