import { Link } from 'react-router-dom';
import { BookmarkCheck, BookmarkPlus } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { APIError } from '@/lib/api';
import { useSetupActions, useSetupForAnalysis, type SetupVerdict } from '@/lib/setups';

/**
 * "Follow setup" abaixo do resultado (12/10/2026). Ao lado das acoes de
 * sempre, sem substituir nenhuma: seguir nao marca entrada, nao favorita e nao
 * entra em resultado. No WAIT o cartao fica em destaque, porque e ali que a
 * pessoa precisa de um caminho para voltar quando a condicao acontecer.
 *
 * Gratis esgotado: o servidor responde 402 e o cartao simplesmente nao aparece.
 */
const FollowSetupBar = ({ analysisId, recommendation, base }: { analysisId: string; recommendation: SetupVerdict; base: string }) => {
  const { t } = useLanguage();
  const s = t.setups;
  const { toast } = useToast();
  const { data, isLoading, isError } = useSetupForAnalysis(analysisId);
  const { follow, setStatus } = useSetupActions();

  if (isLoading || isError || !data) return null;
  const setup = data.setup;
  const following = setup?.status === 'tracking';
  const busy = follow.isPending || setStatus.isPending;
  const isWait = recommendation === 'WAIT';

  const onFollow = () => {
    track('setup_follow_clicked', { surface: 'result', recommendation });
    follow.mutate(analysisId, {
      onError: (error) => {
        if (error instanceof APIError && error.code === 'setup_limit') {
          toast({ title: s.limitTitle, description: s.limitDesc });
          return;
        }
        toast({ title: s.followFailed, variant: 'destructive' });
      },
    });
  };

  const onUnfollow = () => {
    if (!setup) return;
    setStatus.mutate(
      { setupId: setup.id, status: 'untracked' },
      {
        onSuccess: () => toast({ title: s.unfollowed }),
        onError: () => toast({ title: s.actionFailed, variant: 'destructive' }),
      },
    );
  };

  if (following && setup) {
    return (
      <div
        key="following"
        className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <BookmarkCheck className="h-4 w-4 text-[var(--accent-green)]" />
          <span>{s.following}</span>
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            to={`${base}/setups/${encodeURIComponent(setup.id)}`}
            onClick={() => track('setup_opened', { setupId: setup.id, surface: 'result' })}
            className="rounded-lg border border-[var(--border-default)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-white/[0.04]"
          >
            {s.openSetup}
          </Link>
          <button
            type="button"
            onClick={onUnfollow}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {s.unfollow}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      key="not-following"
      className={`flex flex-col gap-3 rounded-2xl border bg-[var(--bg-card)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
        isWait ? 'border-[var(--border-accent)]' : 'border-[var(--border-subtle)]'
      }`}
    >
      <div className="min-w-0">
        {isWait ? <p className="text-sm font-semibold text-[var(--text-primary)]">{s.followWaitTitle}</p> : null}
        <p className={`text-xs leading-relaxed text-[var(--text-secondary)] ${isWait ? 'mt-1' : ''}`}>
          {isWait ? s.followWaitHint : s.followHint}
        </p>
      </div>
      <button
        type="button"
        onClick={onFollow}
        disabled={busy}
        className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 ${
          isWait ? 'bg-white text-[#050508]' : 'border border-[var(--border-default)] text-[var(--text-primary)]'
        }`}
      >
        <BookmarkPlus className="h-4 w-4" /> {s.follow}
      </button>
    </div>
  );
};

export default FollowSetupBar;
