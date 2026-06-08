import { useDropzone } from 'react-dropzone';
import { Card } from '@/components/ui/card';
import { UploadCloud, X, Plus, Layers } from 'lucide-react';
import { useCallback, useState, type ChangeEvent } from 'react';

interface NewAnalysisProps {
  onStartAnalysis: (imageUrl: string | null, imageFile: File | null, htfBase64Images?: string[]) => void;
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

const NewAnalysis = ({ onStartAnalysis }: NewAnalysisProps) => {
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [mainPreview, setMainPreview] = useState<string | null>(null);
  const [htf, setHtf] = useState<Array<{ file: File; url: string }>>([]);
  const [submitting, setSubmitting] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setMainFile(file);
      setMainPreview(URL.createObjectURL(file));
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.png', '.jpg', '.webp'] },
    multiple: false,
    maxSize: 10 * 1024 * 1024,
  });

  const addHtf = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && htf.length < MAX_HTF) {
      setHtf((prev) => [...prev, { file, url: URL.createObjectURL(file) }]);
    }
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
      const htfBase64 = await Promise.all(htf.map((h) => fileToDataUrl(h.file)));
      onStartAnalysis(mainPreview, mainFile, htfBase64);
    } catch {
      onStartAnalysis(mainPreview, mainFile, []);
    }
  };

  // ── Estado inicial: dropzone (comportamento idêntico ao anterior) ──
  if (!mainFile) {
    return (
      <Card
        {...getRootProps()}
        className={`surface-terminal-elevated flex min-h-[560px] flex-1 cursor-pointer flex-col items-center justify-center border-2 border-dashed px-4 py-8 text-center transition-all duration-300 hover:border-[var(--border-emphasis)] hover:bg-[var(--bg-overlay)] md:min-h-[calc(100svh-11rem)] md:px-8 ${isDragActive ? 'border-[var(--signal-buy)] bg-[var(--signal-buy-bg)]' : 'border-[var(--border-default)]'}`}
      >
        <input {...getInputProps({ accept: 'image/*,image/png,image/jpeg,image/webp' })} />
        <div className="w-full max-w-4xl space-y-5">
          <div className="flex min-h-[320px] items-center justify-center rounded-md border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] px-6 py-10 transition-all duration-300 hover:border-[var(--signal-buy-border)] md:min-h-[360px] md:px-10 md:py-14">
            <div className="flex flex-col items-center justify-center gap-4">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[var(--bg-overlay)] text-[var(--text-secondary)]">
                <UploadCloud className="h-7 w-7" />
              </span>
              <p className="text-[13px] text-[var(--text-secondary)]">PNG · JPG · WEBP · max 10MB</p>
              <h3 className="text-balance text-xl font-semibold text-[var(--text-primary)] md:text-2xl">
                {isDragActive ? 'Solte o gráfico aqui' : 'Arraste o gráfico aqui'}
              </h3>
              <p className="text-pretty text-sm text-[var(--text-secondary)]">ou clique para selecionar o arquivo</p>
            </div>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">No celular, você pode usar a câmera.</p>

          <div className="flex flex-col items-center gap-2 pt-1">
            <p className="text-[11px] uppercase tracking-widest text-[var(--text-secondary)] opacity-50">
              Compatível com qualquer plataforma
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
      </Card>
    );
  }

  // ── Estado de revisão: gráfico principal + timeframes maiores (opcional) + Analisar ──
  return (
    <Card className="surface-terminal-elevated flex min-h-[560px] flex-1 flex-col px-4 py-6 md:min-h-[calc(100svh-11rem)] md:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        {/* Gráfico principal */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--text-primary)]">Gráfico principal (timeframe de execução)</span>
          <button
            type="button"
            onClick={reset}
            className="text-xs text-[var(--text-secondary)] underline-offset-2 hover:underline"
          >
            Trocar
          </button>
        </div>
        <div className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)]">
          {mainPreview && <img src={mainPreview} alt="Gráfico principal" className="max-h-[300px] w-full object-contain" />}
        </div>

        {/* Timeframes maiores (top-down) */}
        <div className="mt-5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
            <Layers className="h-4 w-4 text-[var(--signal-buy)]" />
            Timeframes maiores <span className="font-normal text-[var(--text-secondary)]">(opcional · top-down)</span>
          </p>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Adicione 1-2 gráficos de tempo maior (ex: 1H, 4H) para a IA fazer a leitura top-down real.
          </p>

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
              <label className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[var(--border-default)] text-[var(--text-secondary)] transition-colors hover:border-[var(--signal-buy-border)] hover:text-[var(--text-primary)]">
                <Plus className="h-5 w-5" />
                <span className="text-[10px]">Adicionar</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={addHtf} />
              </label>
            )}
          </div>
        </div>

        {/* Ação */}
        <div className="mt-auto pt-6">
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={submitting}
            className="w-full rounded-md bg-[var(--signal-buy)] px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Analisando…' : 'Analisar gráfico'}
          </button>
          <p className="mt-2 text-center text-[11px] text-[var(--text-secondary)]">
            {htf.length > 0
              ? `Análise top-down com ${htf.length + 1} gráficos`
              : 'Análise de gráfico único · adicione timeframes maiores para top-down'}
          </p>
        </div>
      </div>
    </Card>
  );
};

export default NewAnalysis;
