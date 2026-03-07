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
      className={`surface-terminal-elevated flex min-h-[420px] flex-1 cursor-pointer flex-col items-center justify-center border-2 border-dashed p-8 text-center transition-all duration-300 hover:border-[var(--border-emphasis)] hover:bg-[var(--bg-overlay)] ${isDragActive ? 'border-[var(--signal-buy)] bg-[var(--signal-buy-bg)]' : 'border-[var(--border-default)]'}`}
    >
      <input {...getInputProps({ capture: 'environment' })} />
      <div className="w-full max-w-2xl space-y-5">
        <div className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] p-10 transition-all duration-300 hover:border-[var(--signal-buy-border)]">
          <div className="flex flex-col items-center justify-center gap-4">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[var(--bg-overlay)] text-[var(--text-secondary)]">
              <UploadCloud className="h-7 w-7" />
            </span>
            <h3 className="text-xl font-semibold text-[var(--text-primary)]">
              {isDragActive ? 'Solte o gráfico aqui' : 'Arraste o gráfico aqui'}
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">ou clique para selecionar o arquivo</p>
          </div>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          Suporta: PNG, JPG, WEBP • Máx: 10MB
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          No celular, você pode usar a câmera.
        </p>
      </div>
    </Card>
  );
};

export default NewAnalysis;
