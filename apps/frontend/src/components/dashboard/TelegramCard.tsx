import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Send } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { buildApiUrl } from "@/lib/api";
import { track } from "@/lib/analytics";

type Status = { available: boolean; linked: boolean; botUsername: string | null };

async function call<T>(getToken: () => Promise<string | null>, method: 'GET' | 'POST' | 'DELETE', path: string): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error('no token');
  const res = await fetch(buildApiUrl(path), { method, headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

/**
 * Alertas de nivel pelo Telegram (10/11/2026). So aparece quando o servidor
 * tem o bot configurado. Ligar = abrir o bot pelo link com o codigo da conta e
 * tocar em Start; a tela confere de novo quando a pessoa volta para a aba.
 */
const TelegramCard = ({ getToken, className }: { getToken: () => Promise<string | null>; className: string }) => {
  const { t } = useLanguage();
  const s = t.settings;
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await call<Status>(getToken, 'GET', '/api/telegram/status');
      setStatus(next);
      if (next.linked) setLink(null);
    } catch {
      setStatus((current) => current);
    }
  }, [getToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A pessoa toca em Start no Telegram e volta: confere sem pedir clique.
  useEffect(() => {
    if (!link) return;
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [link, refresh]);

  if (!status?.available) return null;

  const run = async (action: 'connect' | 'disconnect') => {
    setBusy(true);
    setFailed(false);
    try {
      if (action === 'connect') {
        track('telegram_connect_clicked', {});
        setLink((await call<{ url: string }>(getToken, 'POST', '/api/telegram/link')).url);
      } else {
        track('telegram_disconnect_clicked', {});
        setStatus(await call<Status>(getToken, 'DELETE', '/api/telegram/link'));
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const primary = "inline-flex items-center gap-2 rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 disabled:opacity-60";
  const secondary = "inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)] disabled:opacity-60";

  return (
    <section className={className} aria-labelledby="settings-telegram">
      <h2 id="settings-telegram" className="tk-stat-label mb-1">
        {s.telegramTitle}
      </h2>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">{s.telegramSub}</p>
      {status.linked ? (
        <div key="linked" className="flex flex-wrap items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--signal-buy)' }}>{s.telegramConnected}</span>
          <button type="button" onClick={() => void run('disconnect')} disabled={busy} className={secondary}>
            {s.telegramDisconnect}
          </button>
        </div>
      ) : link ? (
        <div key="link" className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <a href={link} target="_blank" rel="noreferrer" className={primary}>
              <Send className="h-4 w-4" />
              <span>{s.telegramOpen}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button type="button" onClick={() => void refresh()} className={secondary}>
              {s.telegramCheck}
            </button>
          </div>
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{s.telegramHint}</p>
        </div>
      ) : (
        <button key="connect" type="button" onClick={() => void run('connect')} disabled={busy} className={primary}>
          <Send className="h-4 w-4" />
          <span>{s.telegramConnect}</span>
        </button>
      )}
      {failed ? (
        <p role="status" className="mt-3 text-sm" style={{ color: 'var(--signal-sell)' }}>
          {s.actionFailed}
        </p>
      ) : null}
    </section>
  );
};

export default TelegramCard;
