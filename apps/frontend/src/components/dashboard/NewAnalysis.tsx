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
    accept: { 'image/*': ['.jpeg', '.png', '.jpg'] },
  });

  return (
    <Card 
      {...getRootProps()} 
      className={`flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed cursor-pointer transition-colors min-h-[400px] hover:border-primary hover:bg-primary/5 ${isDragActive ? 'border-primary bg-primary/10' : 'border-border'}`}
    >
      <input {...getInputProps({ capture: 'environment' })} />
      <div className="flex flex-col items-center justify-center gap-4">
        <UploadCloud className="h-16 w-16 text-muted-foreground" />
        <h3 className="text-2xl font-medium">
          {isDragActive ? 'Solte a imagem do gráfico aqui...' : 'Arraste e solte o seu gráfico'}
        </h3>
        <p className="text-muted-foreground">ou clique para fazer upload (PNG, JPG)</p>
        <p className="mt-2 text-xs text-muted-foreground">
          No celular, você pode usar a câmera.
        </p>
      </div>
    </Card>
  );
};

export default NewAnalysis;
