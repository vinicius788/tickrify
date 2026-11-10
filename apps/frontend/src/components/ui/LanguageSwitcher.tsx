import { Globe } from 'lucide-react';
import { useLanguage } from '../../lib/i18n/LanguageContext';
import { LANGUAGES, Language } from '../../lib/i18n';
import { useState, useRef, useEffect } from 'react';

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { language, setLanguage, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const current = LANGUAGES.find(l => l.code === language);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors ${className}`}
        title={t.language.select}
      >
        <Globe size={14} />
        <span className="sm:hidden">{current?.code.toUpperCase()}</span>
        <span className="hidden sm:inline">{current?.label}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] shadow-xl py-1">
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => { setLanguage(lang.code as Language); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-[var(--bg-base)] ${
                language === lang.code
                  ? 'text-[var(--text-primary)] font-semibold'
                  : 'text-[var(--text-secondary)]'
              }`}
            >
              <span>{lang.label}</span>
              {language === lang.code && (
                <span className="ml-auto text-[var(--signal-buy)] text-xs">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
