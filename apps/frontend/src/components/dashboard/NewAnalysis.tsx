import { useDropzone } from 'react-dropzone';
import { Card } from '@/components/ui/card';
import { UploadCloud, X, Plus, Layers, Info } from 'lucide-react';
import { useCallback, useState, type ChangeEvent } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { shrinkChartImage } from '@/lib/chart-image';

interface NewAnalysisProps {
  onStartAnalysis: (
    imageUrl: string | null,
    imageFile: File | null,
    htfBase64Images?: string[],
    analysisType?: 'quick' | 'deep',
  ) => void;
  /** Multi-timeframe (top-down) é recurso de assinante. No grátis/demo fica oculto. */
  allowHigherTimeframes?: boolean;
}

const MAX_HTF = 2;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

const NewAnalysis = ({ onStartAnalysis, allowHigherTimeframes = true }: NewAnalysisProps) => {
  const { t } = useLanguage();
  const u = t.analysis.upload;
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [mainPreview, setMainPreview] = useState<string | null>(null);
  const [htf, setHtf] = useState<Array<{ file: File; url: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [deep, setDeep] = useState(false);

  const [readError, setReadError] = useState(false);

  // Copia a imagem para a memoria no momento da escolha. No Android, o arquivo
  // escolhido do Google Fotos ou de pasta na nuvem pode deixar de ser legivel
  // ate o envio: o fetch falha em ~70 ms com "Failed to fetch", a tela diz
  // "sem internet" e o reenvio usa o mesmo arquivo quebrado (27/09/2026: um
  // usuario tentou 4 vezes e desistiu). Lendo aqui, o envio usa a copia, e se
  // nem aqui der para ler, a pessoa recebe o motivo certo.
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    let copy: File;
    try {
      const bytes = await file.arrayBuffer();
      copy = new File([bytes], file.name || 'chart.png', {
        type: file.type || 'image/png',
        lastModified: file.lastModified,
      });
    } catch (err) {
      track('upload_read_failed', {
        surface: 'dashboard',
        fileType: file.type || null,
        fileBytes: file.size ?? null,
        errorName: err instanceof Error ? err.name : null,
      });
      setReadError(true);
      return;
    }
    setReadError(false);
    setMainFile(copy);
    setMainPreview(URL.createObjectURL(copy));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.png', '.jpg', '.webp'] },
    multiple: false,
    maxSize: 10 * 1024 * 1024,
  });

  const pushHtf = (file: File | undefined | null) => {
    if (file && file.type.startsWith('image/') && htf.length < MAX_HTF) {
      setHtf((prev) => [...prev, { file, url: URL.createObjectURL(file) }]);
    }
  };

  const addHtf = (e: ChangeEvent<HTMLInputElement>) => {
    pushHtf(e.target.files?.[0]);
    e.target.value = '';
  };

  const removeHtf = (i: number) => setHtf((prev) => prev.filter((_, idx) => idx !== i));

  const reset = () => {
    setMainFile(null);
    setMainPreview(null);
    setHtf([]);
  };

  const analyze = async () => {
    if (!mainFile || submitting) return;
    setSubmitting(true);
    try {
      // As HTF pesam mais que a principal: vao como base64 em campo de texto,
      // o que ainda soma +33% em cima do arquivo. Reduzir antes vale o dobro.
      const [shrunkMain, ...shrunkHtf] = await Promise.all([
        shrinkChartImage(mainFile),
        ...htf.map((h) => shrinkChartImage(h.file)),
      ]);
      const htfBase64 = await Promise.all(shrunkHtf.map(fileToDataUrl));
      onStartAnalysis(mainPreview, shrunkMain, htfBase64, deep ? 'deep' : 'quick');
    } catch {
      // Rede de seguranca dupla: se qualquer coisa acima falhar, a analise
      // segue com os arquivos originais, exatamente como antes desta mudanca.
      onStartAnalysis(mainPreview, mainFile, [], deep ? 'deep' : 'quick');
    }
  };

  // ── Stepper editorial: Upload → Contexto (apenas visual; o avanço segue automático ao escolher o arquivo) ──
  const Stepper = ({ active }: { active: 1 | 2 }) => (
    <div className="flex items-center gap-4 sm:gap-7">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
            active === 1
              ? 'bg-white text-[#050508]'
              : 'border border-[var(--border-default)] text-[var(--text-secondary)]'
          }`}
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          1
        </span>
        <div>
          <div className={`tk-display text-[15px] ${active === 1 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
            {u.stepUpload}
          </div>
          <div className="font-terminal text-[9px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            {u.stepUploadSub}
          </div>
        </div>
      </div>
      <div className="h-px flex-1 bg-[var(--border-subtle)]" />
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
            active === 2
              ? 'bg-white text-[#050508]'
              : 'border border-[var(--border-default)] text-[var(--text-secondary)]'
          }`}
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          2
        </span>
        <div>
          <div className={`tk-display text-[15px] ${active === 2 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
            {u.stepContext}
          </div>
          <div className="font-terminal text-[9px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            {u.stepContextSub}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Estado inicial: dropzone (comportamento idêntico ao anterior) ──
  if (!mainFile) {
    return (
      <div className="flex flex-col gap-4">
        <p className="max-w-[480px] text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{u.subtitle}</p>

        <Stepper active={1} />

        <Card
          {...getRootProps()}
          className={`border border-[var(--border-subtle)] bg-[var(--bg-card)] cursor-pointer border border-[var(--border-subtle)] p-2 transition-all duration-300 hover:border-[var(--border-emphasis)] ${
            isDragActive ? 'border-[var(--signal-buy)] bg-[var(--signal-buy-bg)]' : ''
          }`}
        >
          <input {...getInputProps({ accept: 'image/*,image/png,image/jpeg,image/webp' })} />
          <div
            className={`flex min-h-[320px] flex-col items-center justify-center rounded-[14px] border-[1.5px] border-dashed px-6 py-12 text-center transition-all duration-300 md:min-h-[360px] ${
              isDragActive ? 'border-[var(--signal-buy-border)]' : 'border-[var(--border-default)]'
            }`}
          >
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[var(--bg-overlay)] text-[var(--text-secondary)]">
              <UploadCloud className="h-7 w-7" />
            </span>
            <h3 className="tk-display mt-5 text-balance text-2xl text-[var(--text-primary)] md:text-3xl">
              {/* Cada estado num <span> proprio: com a pagina traduzida pelo
                  navegador, trocar NOS DE TEXTO soltos derrubava o painel ao
                  arrastar o grafico (removeChild). Trocar elemento e seguro. */}
              {isDragActive ? (
                <span key="drop-active">{u.dropActive}</span>
              ) : (
                <span key="drop-idle">
                  {`${u.dropHere}, `}
                  <em className="font-serif italic text-[var(--text-secondary)]">{u.orClick}</em>
                </span>
              )}
            </h3>
            <p className="mt-2 max-w-[420px] text-pretty text-sm text-[var(--text-secondary)]">{u.dropSources}</p>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {['PNG', 'JPG', 'WEBP'].map((fmt) => (
                <span
                  key={fmt}
                  className="rounded-[5px] border border-[var(--border-default)] px-2 py-0.5 font-terminal text-[10px] text-[var(--text-secondary)]"
                >
                  {fmt}
                </span>
              ))}
              <span className="rounded-[5px] border border-[var(--border-default)] px-2 py-0.5 font-terminal text-[10px] text-[var(--text-secondary)] opacity-60">
                {u.maxSize}
              </span>
            </div>

            <p className="mt-4 font-terminal text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              {u.pasteHint}
            </p>
            <p className="mt-3 text-xs text-[var(--text-secondary)]">{u.mobileCamera}</p>
          </div>
        </Card>

        {readError && (
          <p role="alert" className="text-sm leading-relaxed text-[var(--signal-sell)]">
            {u.readError}
          </p>
        )}

        {/* O WAIT e o resultado mais comum. Quem nao sabe disso antes le o
            primeiro WAIT como "nao funcionou" e vai embora (medido 21 a 27/09:
            40% fazem uma 2a analise depois de um WAIT, 75% depois de um SELL). */}
        <Card className="border border-[var(--border-subtle)] bg-[var(--bg-card)] flex items-start gap-3 px-4 py-3.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--signal-buy)]" />
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">{u.outcomesTitle}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">{u.outcomesText}</p>
          </div>
        </Card>

        {/* Callout: o símbolo é lido automaticamente */}
        <Card className="border border-[var(--border-subtle)] bg-[var(--bg-card)] flex items-start gap-3 border border-[var(--border-subtle)] px-4 py-3.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--signal-buy)]" />
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">{u.symbolAutoTitle}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">{u.symbolAutoText}</p>
          </div>
        </Card>

        <div className="flex flex-col items-center gap-2 pt-1">
          <p className="font-terminal text-[11px] uppercase tracking-widest text-[var(--text-secondary)] opacity-50">
            {u.compatible}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 opacity-40">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">TradingView</span>
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">MetaTrader 4</span>
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">MetaTrader 5</span>
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">Binance</span>
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">Bybit</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Estado de revisão: gráfico principal + timeframes maiores (opcional) + Analisar ──
  return (
    <div className="flex flex-col gap-4">
      <Stepper active={2} />
      <Card className="border border-[var(--border-subtle)] bg-[var(--bg-card)] flex min-h-[480px] flex-1 flex-col px-4 py-6 md:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
          {/* Gráfico principal */}
          <div className="mb-2 flex items-center justify-between">
            <span className="tk-display text-base text-[var(--text-primary)]">{u.mainChart}</span>
            <button
              type="button"
              onClick={reset}
              className="text-xs text-[var(--text-secondary)] underline-offset-2 hover:underline"
            >
              {u.change}
            </button>
          </div>
          <div className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)]">
            {mainPreview && <img src={mainPreview} alt="Gráfico principal" className="max-h-[300px] w-full object-contain" />}
          </div>

          {/* Timeframes maiores (top-down) — somente assinante */}
          {allowHigherTimeframes && (
            <div className="mt-5">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                <Layers className="h-4 w-4 text-[var(--signal-buy)]" />
                {u.higherTfs} <span className="font-normal text-[var(--text-secondary)]">({u.higherTfsTag})</span>
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{u.higherTfsHint}</p>

              <div className="mt-3 flex flex-wrap gap-3">
                {htf.map((h, i) => (
                  <div key={i} className="relative h-20 w-28 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)]">
                    <img src={h.url} alt={`Timeframe maior ${i + 1}`} className="h-full w-full object-contain" />
                    <button
                      type="button"
                      onClick={() => removeHtf(i)}
                      className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-overlay)] text-[var(--signal-sell)]"
                      aria-label="Remover"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {htf.length < MAX_HTF && (
                  <label
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      pushHtf(e.dataTransfer.files?.[0]);
                    }}
                    className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[var(--border-default)] text-[var(--text-secondary)] transition-colors hover:border-[var(--signal-buy-border)] hover:text-[var(--text-primary)]"
                  >
                    <Plus className="h-5 w-5" />
                    <span className="text-[10px]">{u.dragOrClick}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={addHtf} />
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Ação */}
          <div className="mt-auto pt-6">
            {/* Deep é recurso de assinante (backend também valida) — mesma regra do multi-timeframe */}
            {allowHigherTimeframes && (
              <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={deep}
                  onChange={(e) => setDeep(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--signal-buy)]"
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{u.deepToggle}</span>
                  <span className="text-[11px] text-[var(--text-secondary)]">{u.deepHint}</span>
                </span>
              </label>
            )}
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={submitting}
              className="w-full rounded-md bg-[var(--signal-buy)] px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? u.analyzing : u.analyze}
            </button>
            {allowHigherTimeframes && (
              <p className="mt-2 text-center text-[11px] text-[var(--text-secondary)]">
                {htf.length > 0 ? `${u.topDownPrefix} ${htf.length + 1} ${u.charts}` : u.singleHint}
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default NewAnalysis;
