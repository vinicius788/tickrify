/**
 * Editor da anotacao de um trade (Diario, 05/10/2026): setup, emocao, erros e
 * nota livre. Arquivo proprio porque e uma janela com estado proprio; o
 * Diario so abre e recebe o resultado salvo. Grava em
 * PATCH /api/ai/analysis/:id/note (rota separada da do resultado do trade).
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAPIClient } from '@/lib/api';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { TRADE_EMOTIONS, TRADE_MISTAKES, TRADE_NOTE_MAX, TRADE_SETUPS, type TradeNote } from '@/lib/trade-note';

interface TradeNoteDialogProps {
  analysisId: string;
  title: string;
  initial: TradeNote | null;
  onClose: () => void;
  onSaved: (note: TradeNote | null) => void;
}

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition-colors ${
    active
      ? 'border-[var(--text-primary)] bg-[var(--fill-4)] text-[var(--text-primary)]'
      : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
  }`;

const TradeNoteDialog = ({ analysisId, title, initial, onClose, onSaved }: TradeNoteDialogProps) => {
  const { setTradeNote } = useAPIClient();
  const { t } = useLanguage();
  const j = t.journal;
  const [setup, setSetup] = useState<string | null>(initial?.setup ?? null);
  const [emotion, setEmotion] = useState<string | null>(initial?.emotion ?? null);
  const [mistakes, setMistakes] = useState<string[]>(initial?.mistakes ?? []);
  const [note, setNote] = useState(initial?.note ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');

  const toggleMistake = (m: string) =>
    setMistakes((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

  const save = async () => {
    setState('saving');
    try {
      const out = await setTradeNote(analysisId, { note: note.trim() || null, setup, emotion, mistakes });
      onSaved(out.tradeNote ?? null);
    } catch {
      setState('error');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <DialogTitle className="text-base text-[var(--text-primary)]">{`${j.noteTitle} · ${title}`}</DialogTitle>
        <DialogDescription className="text-xs text-[var(--text-secondary)]">{j.notePrivate}</DialogDescription>

        <fieldset className="mt-2">
          <legend className="mb-2 text-xs text-[var(--text-secondary)]">{j.noteSetup}</legend>
          <div className="flex flex-wrap gap-1.5">
            {TRADE_SETUPS.map((s) => (
              <button key={s} type="button" aria-pressed={setup === s} onClick={() => setSetup(setup === s ? null : s)} className={chip(setup === s)}>
                {j.setupLabels[s]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-3">
          <legend className="mb-2 text-xs text-[var(--text-secondary)]">{j.noteEmotion}</legend>
          <div className="flex flex-wrap gap-1.5">
            {TRADE_EMOTIONS.map((e) => (
              <button key={e} type="button" aria-pressed={emotion === e} onClick={() => setEmotion(emotion === e ? null : e)} className={chip(emotion === e)}>
                {j.emotionLabels[e]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-3">
          <legend className="mb-2 text-xs text-[var(--text-secondary)]">{j.noteMistakes}</legend>
          <div className="flex flex-wrap gap-1.5">
            {TRADE_MISTAKES.map((m) => (
              <button key={m} type="button" aria-pressed={mistakes.includes(m)} onClick={() => toggleMistake(m)} className={chip(mistakes.includes(m))}>
                {j.mistakeLabels[m]}
              </button>
            ))}
          </div>
        </fieldset>

        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={TRADE_NOTE_MAX}
          rows={4}
          placeholder={j.notePlaceholder}
          aria-label={j.noteTitle}
          className="mt-3 w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] outline-none focus:border-[var(--accent-green)] md:text-sm"
        />

        {state === 'error' && (
          <p role="alert" className="text-xs text-[var(--signal-sell)]">{j.noteError}</p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            {j.noteCancel}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={state === 'saving'}
            className="rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {state === 'saving' ? j.noteSaving : j.noteSave}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TradeNoteDialog;
