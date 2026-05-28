import { useDropzone } from 'react-dropzone';
import { Card } from "@/components/ui/card";
import { UploadCloud } from "lucide-react";
import { useCallback } from 'react';

interface NewAnalysisProps {
  onStartAnalysis: (imageUrl: string | null, imageFile: File | null) => void;
}

const NewAnalysis = ({ onStartAnalysis }: NewAnalysisProps) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      const imageUrl = URL.createObjectURL(file);
      onStartAnalysis(imageUrl, file);
    }
  }, [onStartAnalysis]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.png', '.jpg', '.webp'] },
    multiple: false,
    maxSize: 10 * 1024 * 1024,
  });

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
            <p className="text-[13px] text-[var(--text-secondary)]">
              PNG · JPG · WEBP · max 10MB
            </p>
            <h3 className="text-balance text-xl font-semibold text-[var(--text-primary)] md:text-2xl">
              {isDragActive ? 'Solte o gráfico aqui' : 'Arraste o gráfico aqui'}
            </h3>
            <p className="text-pretty text-sm text-[var(--text-secondary)]">
              ou clique para selecionar o arquivo
            </p>
          </div>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          No celular, você pode usar a câmera.
        </p>

        {/* Plataformas compatíveis */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <p className="text-[11px] uppercase tracking-widest text-[var(--text-muted,var(--text-secondary))] opacity-50">
            Compatível com qualquer plataforma
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 opacity-40">
            {/* TradingView */}
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
              <svg width="14" height="14" viewBox="0 0 50 50" fill="currentColor"><path d="M25 0C11.2 0 0 11.2 0 25s11.2 25 25 25 25-11.2 25-25S38.8 0 25 0zm0 6c10.5 0 19 8.5 19 19S35.5 44 25 44 6 35.5 6 25 14.5 6 25 6zm-2 8v11H13v4h10v7l12-11-12-11z"/></svg>
              TradingView
            </span>
            {/* MetaTrader 4 */}
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">MetaTrader 4</span>
            {/* MetaTrader 5 */}
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">MetaTrader 5</span>
            {/* Binance */}
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
              <svg width="14" height="14" viewBox="0 0 126.61 126.61" fill="currentColor"><path d="M38.73 53.2 63.3 28.63l24.59 24.59 14.3-14.3L63.3 0 24.43 38.87zM0 63.31l14.3-14.31 14.31 14.31-14.31 14.3zM38.73 73.41 63.3 97.98l24.59-24.57 14.31 14.28-38.9 38.92L24.43 87.71zM97.99 63.31l14.3-14.31 14.32 14.3-14.32 14.32zM77.83 63.3 63.3 48.78 52.59 59.49l-1.28 1.27-2.62 2.54 14.61 14.62 14.53-14.62z"/></svg>
              Binance
            </span>
            {/* Bybit */}
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">Bybit</span>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default NewAnalysis;
