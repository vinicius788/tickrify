import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sliders } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/dashboard/EmptyState';
import { APIError, useAPIClient, type RiskProfile, type StrategyProfileDto } from '@/lib/api';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Tela do perfil de estratégia (Tarefa 6 do plano de perfil).
 *
 * Arquivo próprio, não dentro do `DashboardPage.tsx`: o painel já passa de
 * mil linhas, e um formulário com seis grupos de campos só pioraria isso.
 * Mesmo padrão de `MyTrades.tsx`/`JournalCalendar.tsx` (componente próprio em
 * `components/dashboard/`, navegação por `activeView`, sem rota nova).
 *
 * REGRA DE SEGURANÇA (não é preferência de interface): nenhum campo de texto
 * livre. O conteúdo deste perfil entra no prompt do motor
 * (`buildStrategyBlock`, backend), e texto livre do usuário ali é injeção de
 * prompt — o alvo mais valioso do ataque é a taxa de abstenção (39%), o maior
 * diferencial medido do produto e a base da página pública `/accuracy`. Por
 * isso todo campo abaixo é multipla escolha fechada ou número limitado.
 *
 * As opções batem EXATAMENTE com a whitelist do backend
 * (`apps/backend/src/common/strategy/strategy-profile.ts`), copiadas de lá e
 * não do brief da tarefa. Um valor que exista aqui e não lá é descartado em
 * silêncio por `sanitizeStrategyProfile`, e o usuário veria a opção marcada
 * sumir sozinha depois de salvar.
 */

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const;
const SESSIONS = ['asian', 'london', 'new_york', 'overlap'] as const;
const INSTRUMENTS = ['crypto', 'forex', 'metals', 'indices', 'stocks'] as const;
const SETUPS = ['breakout', 'pullback', 'reversal', 'range', 'trend_continuation'] as const;
const DIRECTIONS = ['long', 'short', 'both'] as const;

type Direction = (typeof DIRECTIONS)[number];

const RISK_PROFILES = ['conservative', 'balanced', 'aggressive'] as const;

const MIN_RR = 1;
const MAX_RR = 10;

const EMPTY_PROFILE: StrategyProfileDto = {
  timeframes: [],
  sessions: [],
  instruments: [],
  setups: [],
  direction: 'both',
  minRiskReward: MIN_RR,
};

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

interface ChipGroupProps {
  label: string;
  values: readonly string[];
  selected: string[];
  labelFor: (value: string) => string;
  onToggle: (value: string) => void;
}

const ChipGroup = ({ label, values, selected, labelFor, onToggle }: ChipGroupProps) => (
  <div>
    <div className="tk-stat-label mb-2">{label}</div>
    <div className="flex flex-wrap gap-2">
      {values.map((value) => {
        const active = selected.includes(value);
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(value)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? 'border-transparent bg-[var(--inverse-bg)] text-[var(--inverse-fg)]'
                : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)]'
            }`}
          >
            {labelFor(value)}
          </button>
        );
      })}
    </div>
  </div>
);

const StrategyProfile = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const st = t.strategy;
  const { getStrategy, saveStrategy } = useAPIClient();

  const [loading, setLoading] = useState(true);
  const [paid, setPaid] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [profile, setProfile] = useState<StrategyProfileDto>(EMPTY_PROFILE);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('balanced');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await getStrategy();
        if (cancelled) return;
        setPaid(res.paid);
        if (res.profile) setProfile(res.profile);
        if (res.riskProfile) setRiskProfile(res.riskProfile);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionLabel = (v: string): string => {
    switch (v) {
      case 'asian': return st.sessionAsian;
      case 'london': return st.sessionLondon;
      case 'new_york': return st.sessionNewYork;
      case 'overlap': return st.sessionOverlap;
      default: return v;
    }
  };

  const instrumentLabel = (v: string): string => {
    switch (v) {
      case 'crypto': return st.instrumentCrypto;
      case 'forex': return st.instrumentForex;
      case 'metals': return st.instrumentMetals;
      case 'indices': return st.instrumentIndices;
      case 'stocks': return st.instrumentStocks;
      default: return v;
    }
  };

  const setupLabel = (v: string): string => {
    switch (v) {
      case 'breakout': return st.setupBreakout;
      case 'pullback': return st.setupPullback;
      case 'reversal': return st.setupReversal;
      case 'range': return st.setupRange;
      case 'trend_continuation': return st.setupTrendContinuation;
      default: return v;
    }
  };

  const directionLabel = (v: Direction): string => {
    switch (v) {
      case 'long': return st.directionLong;
      case 'short': return st.directionShort;
      default: return st.directionBoth;
    }
  };

  const riskLabel = (v: RiskProfile): string =>
    v === 'conservative' ? st.riskConservative : v === 'aggressive' ? st.riskAggressive : st.riskBalanced;
  const riskHint = (v: RiskProfile): string =>
    v === 'conservative' ? st.riskConservativeHint : v === 'aggressive' ? st.riskAggressiveHint : st.riskBalancedHint;

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    setSaveErrorMessage(null);
    try {
      const res = await saveStrategy({ ...profile, riskProfile });
      if (res.profile) {
        setProfile(res.profile);
      }
      if (res.riskProfile) setRiskProfile(res.riskProfile);
      setSaveMessage(st.saved);
    } catch (error) {
      setSaveErrorMessage(error instanceof APIError ? error.message : st.saveError);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
        <CardContent className="py-14 text-center text-sm text-[var(--text-secondary)]">
          {st.loading}
        </CardContent>
      </Card>
    );
  }

  if (!paid) {
    return (
      <Card className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
        <EmptyState
          icon={Sliders}
          title={st.emptyTitle}
          description={st.emptyDesc}
          ctaLabel={st.emptyCta}
          onCta={() => navigate('/dashboard/plans')}
        />
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      <CardHeader className="pb-3">
        <CardTitle className="tk-display text-lg">{st.title}</CardTitle>
        <CardDescription className="mt-0.5 text-xs leading-relaxed">{st.subtitle}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 pb-6">
        {loadError && (
          <p className="text-xs text-[var(--tone-warn-3)]">{st.loadError}</p>
        )}

        <ChipGroup
          label={st.timeframesLabel}
          values={TIMEFRAMES}
          selected={profile.timeframes}
          labelFor={(v) => v}
          onToggle={(v) => setProfile((p) => ({ ...p, timeframes: toggle(p.timeframes, v) }))}
        />

        <ChipGroup
          label={st.sessionsLabel}
          values={SESSIONS}
          selected={profile.sessions}
          labelFor={sessionLabel}
          onToggle={(v) => setProfile((p) => ({ ...p, sessions: toggle(p.sessions, v) }))}
        />

        <ChipGroup
          label={st.instrumentsLabel}
          values={INSTRUMENTS}
          selected={profile.instruments}
          labelFor={instrumentLabel}
          onToggle={(v) => setProfile((p) => ({ ...p, instruments: toggle(p.instruments, v) }))}
        />

        <ChipGroup
          label={st.setupsLabel}
          values={SETUPS}
          selected={profile.setups}
          labelFor={setupLabel}
          onToggle={(v) => setProfile((p) => ({ ...p, setups: toggle(p.setups, v) }))}
        />

        <div>
          <div className="tk-stat-label mb-2">{st.directionLabel}</div>
          <div className="flex flex-wrap gap-2">
            {DIRECTIONS.map((value) => {
              const active = profile.direction === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setProfile((p) => ({ ...p, direction: value }))}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-transparent bg-[var(--inverse-bg)] text-[var(--inverse-fg)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {directionLabel(value)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="tk-stat-label mb-2">{st.minRiskRewardLabel}</div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={MIN_RR}
              max={MAX_RR}
              step={0.1}
              value={profile.minRiskReward}
              onChange={(e) => {
                const raw = Number(e.target.value);
                const clamped = Number.isFinite(raw) ? Math.min(MAX_RR, Math.max(MIN_RR, raw)) : MIN_RR;
                setProfile((p) => ({ ...p, minRiskReward: clamped }));
              }}
              className="w-24 rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1.5 tabular-nums text-sm text-[var(--text-primary)] outline-none"
            />
            <span className="tabular-nums text-sm text-[var(--text-secondary)]">:1</span>
          </div>
          <p className="mt-1.5 text-xs text-[var(--text-secondary)]">{st.minRrHint}</p>
        </div>

        <div>
          <div className="tk-stat-label mb-2">{st.riskLabel}</div>
          <div className="flex flex-wrap gap-2">
            {RISK_PROFILES.map((value) => {
              const active = riskProfile === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setRiskProfile(value)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-transparent bg-[var(--inverse-bg)] text-[var(--inverse-fg)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {riskLabel(value)}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-[var(--text-secondary)]">{riskHint(riskProfile)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-4">
          <Button type="button" onClick={handleSave} disabled={saving} size="sm">
            {saving ? st.saving : st.save}
          </Button>
          {saveMessage && <span className="text-xs text-[var(--accent-green)]">{saveMessage}</span>}
          {saveErrorMessage && <span className="text-xs text-[var(--tone-down-3)]">{saveErrorMessage}</span>}
        </div>
      </CardContent>
    </Card>
  );
};

export default StrategyProfile;
