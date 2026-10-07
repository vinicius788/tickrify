import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import logo from '@/assets/tickrify-icon-official.png';
import { track } from '@/lib/analytics';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Link da extensao na Chrome Web Store. VAZIO de proposito ate a extensao ser
 * aprovada e publicada: com ele vazio o card nao aparece (anunciar o que
 * ninguem consegue instalar e claim falso e link quebrado). No dia da
 * publicacao, basta preencher.
 */
export const EXTENSION_STORE_URL = '';

/** Ate quando o card fica escondido ("Not now"). Clique na loja esconde de vez. */
const HIDDEN_UNTIL_KEY = 'tickrify_extension_card_hidden_until';
const HIDE_AFTER_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
const HIDE_FOREVER = Number.MAX_SAFE_INTEGER;

function hiddenNow(): boolean {
  try {
    return Number(localStorage.getItem(HIDDEN_UNTIL_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

function hideUntil(timestamp: number): void {
  try {
    localStorage.setItem(HIDDEN_UNTIL_KEY, String(timestamp));
  } catch {
    /* modo privado: o card so volta na proxima visita */
  }
}

/** A extensao so instala em navegador Chromium de computador (Chrome, Edge, Brave). */
function canInstallExtension(): boolean {
  const ua = navigator.userAgent;
  return /Chrome\/|Chromium\//.test(ua) && !/Mobile|Android/.test(ua);
}

/**
 * Novidade: extensao de navegador (06/10/2026). Fica na tela inicial do
 * painel, acima do quadrinho de opiniao.
 */
const ExtensionAnnouncement = ({ storeUrl = EXTENSION_STORE_URL }: { storeUrl?: string }) => {
  const { t } = useLanguage();
  const c = t.extensionCard;
  const [hidden, setHidden] = useState(() => !storeUrl || !canInstallExtension() || hiddenNow());

  useEffect(() => {
    if (!hidden) track('extension_card_viewed');
  }, [hidden]);

  if (hidden) return null;

  return (
    <section
      aria-labelledby="extension-card-title"
      className="relative flex items-start gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-4"
    >
      <button
        type="button"
        onClick={() => {
          track('extension_card_dismissed');
          hideUntil(Date.now() + HIDE_AFTER_DISMISS_MS);
          setHidden(true);
        }}
        aria-label={c.dismiss}
        className="absolute right-3 top-3 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <X className="h-4 w-4" />
      </button>
      <img src={logo} alt="Tickrify" width={40} height={48} className="h-12 w-10 shrink-0 object-contain" />
      <div className="min-w-0 pr-6">
        <h2 id="extension-card-title" className="text-sm font-semibold text-[var(--text-primary)]">
          {c.title}
        </h2>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{c.body}</p>
        <a
          href={storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            track('extension_card_clicked');
            hideUntil(HIDE_FOREVER);
            setHidden(true);
          }}
          className="mt-3 inline-flex items-center rounded-lg bg-[var(--accent-green)] px-3 py-2 text-xs font-semibold text-[#050508] transition-opacity hover:opacity-90"
        >
          {c.cta}
        </a>
      </div>
    </section>
  );
};

export default ExtensionAnnouncement;
