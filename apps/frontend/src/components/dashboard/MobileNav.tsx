import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  CreditCard,
  Handshake,
  History,
  LayoutGrid,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Settings,
  Sliders,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DiscordIcon } from '@/components/ui/DiscordIcon';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { COMMUNITY_URL, trackCommunityClick } from '@/lib/analytics';
import { openChat } from '@/lib/support-chat';

/**
 * Ilha de navegacao do painel no celular (abaixo de md), 10/11/2026.
 *
 * A area ativa vem da URL (o DashboardPage passa `activeNav`, a mesma conta da
 * barra lateral); nada aqui troca de area por estado. Os itens saem das duas
 * listas abaixo: area nova no "Mais" (ex.: Watching, quando a rota existir) e
 * uma linha em MORE_ITEMS.
 */
export type MobileNavSection = 'home' | 'new' | 'trades' | 'journal' | 'strategy' | 'plans' | 'settings';
type Messages = ReturnType<typeof useLanguage>['t'];
type Counter = 'alerts' | 'chat';
type Target =
  | { kind: 'section'; section: MobileNavSection }
  | { kind: 'href'; href: string }
  | { kind: 'chat' }
  | { kind: 'discord' };

interface NavItem {
  id: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: (t: Messages) => string;
  target: Target;
  counter?: Counter;
}

export const BAR_ITEMS: NavItem[] = [
  { id: 'home', icon: LayoutGrid, label: (t) => t.bottomNav.home, target: { kind: 'section', section: 'home' }, counter: 'alerts' },
  { id: 'journal', icon: BookOpen, label: (t) => t.bottomNav.journal, target: { kind: 'section', section: 'journal' } },
  { id: 'new', icon: Plus, label: (t) => t.bottomNav.analyze, target: { kind: 'section', section: 'new' } },
  { id: 'trades', icon: History, label: (t) => t.bottomNav.trades, target: { kind: 'section', section: 'trades' } },
];

export const MORE_ITEMS: NavItem[] = [
  { id: 'strategy', icon: Sliders, label: (t) => t.nav.strategy, target: { kind: 'section', section: 'strategy' } },
  { id: 'plans', icon: CreditCard, label: (t) => t.nav.plans, target: { kind: 'section', section: 'plans' } },
  { id: 'settings', icon: Settings, label: (t) => t.nav.settings, target: { kind: 'section', section: 'settings' } },
  { id: 'affiliates', icon: Handshake, label: (t) => t.nav.affiliates, target: { kind: 'href', href: '/affiliate' } },
  { id: 'chat', icon: MessageCircle, label: (t) => t.chat.menu, target: { kind: 'chat' }, counter: 'chat' },
  { id: 'discord', icon: DiscordIcon, label: (t) => t.community.join, target: { kind: 'discord' } },
];

const TEXT_ENTRY =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="range"]):not([type="color"]),textarea,select,[contenteditable=""],[contenteditable="true"]';

/** Campo de texto em foco = teclado do celular aberto: a ilha sai do caminho. */
function useTypingFocus(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = document.activeElement;
      setTyping(el instanceof HTMLElement && el.matches(TEXT_ENTRY));
    };
    const onFocusOut = () => window.setTimeout(check, 0);
    check();
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);
  return typing;
}

function CounterDot({ value, label }: { value: number; label: string }) {
  if (value <= 0) return null;
  return (
    <span
      key="counter"
      aria-label={label}
      data-testid="bottom-nav-counter"
      className="absolute -right-1 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--badge-bg)] px-1 text-[10px] font-semibold leading-none text-[var(--badge-fg)] tabular-nums"
    >
      {value > 99 ? '99+' : String(value)}
    </span>
  );
}

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]';

export function MobileNav({
  activeNav,
  linkTo,
  onNewAnalysis,
  counts,
  signedIn,
}: {
  activeNav: MobileNavSection | null;
  linkTo: (section: MobileNavSection) => string;
  onNewAnalysis: (event: ReactMouseEvent) => void;
  counts: Record<Counter, number>;
  signedIn: boolean;
}) {
  const { t } = useLanguage();
  const b = t.bottomNav;
  const [moreOpen, setMoreOpen] = useState(false);
  const typing = useTypingFocus();
  const visible = !typing;

  // A bolha do chat e o painel dela leem isto no CSS (index.css): no celular a
  // bolha fechada some (o chat esta no Mais) e o painel aberto sobe acima da ilha.
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.setAttribute('data-bottom-nav', '');
    else root.removeAttribute('data-bottom-nav');
    return () => root.removeAttribute('data-bottom-nav');
  }, [visible]);

  const moreItems = MORE_ITEMS.filter((item) => item.target.kind !== 'chat' || signedIn);
  const moreSections = new Set(moreItems.flatMap((item) => (item.target.kind === 'section' ? [item.target.section] : [])));
  const moreActive = activeNav !== null && moreSections.has(activeNav);
  const moreCount = moreItems.reduce((sum, item) => sum + (item.counter ? counts[item.counter] : 0), 0);
  const counterLabel = (counter: Counter, n: number) =>
    counter === 'alerts' ? t.alerts.menuBadge.replace('{n}', String(n)) : t.chat.unread.replace('{n}', String(n));

  const barItem = (item: NavItem) => {
    if (item.target.kind !== 'section') return null;
    const { section } = item.target;
    const active = activeNav === section;
    const primary = section === 'new';
    const Icon = item.icon;
    const n = item.counter ? counts[item.counter] : 0;
    return (
      <li key={item.id} className="min-w-0">
        <Link
          to={linkTo(section)}
          onClick={primary ? onNewAnalysis : undefined}
          aria-current={active ? 'page' : undefined}
          data-nav={item.id}
          className={`flex min-h-[52px] w-full flex-col items-center justify-center gap-1 rounded-[22px] px-0.5 py-1.5 text-[11px] font-medium leading-none transition-colors ${focusRing} ${
            active && !primary ? 'bg-[var(--fill-5)] text-[var(--text-primary)] shadow-[inset_0_1px_0_var(--fill-4)]' : primary ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          <span
            className={`relative flex items-center justify-center ${
              primary ? `h-8 w-8 rounded-full ${active ? 'bg-[var(--accent-green)] text-[var(--on-accent)]' : 'bg-[var(--inverse-bg)] text-[var(--inverse-fg)]'}` : 'h-8 w-8'
            }`}
          >
            <Icon className={primary ? 'h-[18px] w-[18px]' : 'h-[22px] w-[22px]'} strokeWidth={primary ? 2.5 : 1.75} />
            {item.counter ? <CounterDot value={n} label={counterLabel(item.counter, n)} /> : null}
          </span>
          <span key="label" className="max-w-full whitespace-nowrap">{item.label(t)}</span>
        </Link>
      </li>
    );
  };

  const close = () => setMoreOpen(false);
  const sheetRow = 'flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)]';

  return (
    <>
      <nav
        aria-label={b.label}
        data-testid="bottom-nav"
        hidden={!visible}
        className="tk-bottom-nav fixed inset-x-0 bottom-0 z-40 px-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5 gap-0.5 rounded-[28px] border border-[var(--border-default)] bg-[var(--bg-island)] p-1 shadow-[0_12px_32px_var(--scrim-soft)] backdrop-blur-md">
          {BAR_ITEMS.map(barItem)}
          <li className="min-w-0">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              data-nav="more"
              className={`flex min-h-[52px] w-full flex-col items-center justify-center gap-1 rounded-[22px] px-0.5 py-1.5 text-[11px] font-medium leading-none transition-colors ${focusRing} ${
                moreActive ? 'bg-[var(--fill-5)] text-[var(--text-primary)] shadow-[inset_0_1px_0_var(--fill-4)]' : 'text-[var(--text-secondary)]'
              }`}
            >
              <span className="relative flex h-8 w-8 items-center justify-center">
                <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={1.75} />
                <CounterDot value={moreCount} label={b.moreBadge.replace('{n}', String(moreCount))} />
              </span>
              <span key="label" className="max-w-full whitespace-nowrap">{b.more}</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-[24px] border-[var(--border-default)] bg-[var(--bg-solid)] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-5 md:hidden"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="text-base font-semibold text-[var(--text-primary)]">{b.moreTitle}</SheetTitle>
            <SheetDescription className="sr-only">{b.moreTitle}</SheetDescription>
          </SheetHeader>
          <ul data-testid="bottom-nav-more" className="mt-2 flex flex-col gap-0.5">
            {moreItems.map((item) => {
              const Icon = item.icon;
              const n = item.counter ? counts[item.counter] : 0;
              const body = (
                <>
                  <span className="relative flex h-6 w-6 shrink-0 items-center justify-center text-[var(--text-secondary)]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span key="label" className="min-w-0 flex-1">{item.label(t)}</span>
                  {item.counter && n > 0 ? (
                    <span key="counter" aria-label={counterLabel(item.counter, n)} className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--badge-bg)] px-1.5 text-[11px] font-semibold text-[var(--badge-fg)] tabular-nums">
                      {String(n)}
                    </span>
                  ) : null}
                </>
              );
              const target = item.target;
              return (
                <li key={item.id}>
                  {target.kind === 'section' ? (
                    <Link
                      to={linkTo(target.section)}
                      onClick={close}
                      aria-current={activeNav === target.section ? 'page' : undefined}
                      className={`${sheetRow} ${focusRing} ${activeNav === target.section ? 'bg-[var(--fill-3)]' : ''}`}
                    >
                      {body}
                    </Link>
                  ) : target.kind === 'href' ? (
                    <Link to={target.href} onClick={close} className={`${sheetRow} ${focusRing}`}>
                      {body}
                    </Link>
                  ) : target.kind === 'chat' ? (
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        openChat('dashboard_more');
                      }}
                      className={`${sheetRow} ${focusRing}`}
                    >
                      {body}
                    </button>
                  ) : (
                    <a
                      href={COMMUNITY_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        trackCommunityClick('app');
                        close();
                      }}
                      className={`${sheetRow} ${focusRing}`}
                    >
                      {body}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
