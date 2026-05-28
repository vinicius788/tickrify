import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const STEPS = [
  'Classificando tipo de gráfico...',
  'Analisando estrutura de mercado...',
  'Validando zonas de demanda/oferta...',
  'Calculando níveis de entry/stop/take...',
  'Gerando relatório final...',
];

const AnalysisLoading = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    const stepTimer = setInterval(() => {
      setActiveStep((prev) => Math.min(prev + 1, STEPS.length - 1));
    }, 2500);

    const progressTimer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 92) {
          return 92;
        }
        return Math.min(prev + 3, 92);
      });
    }, 250);

    return () => {
      clearInterval(stepTimer);
      clearInterval(progressTimer);
    };
  }, []);

  const rows = useMemo(
    () =>
      STEPS.map((label, index) => {
        if (index < activeStep) {
          return { label, status: 'DONE', marker: '✓' };
        }
        if (index === activeStep) {
          return { label, status: 'RUNNING', marker: '●' };
        }
        return { label, status: 'PENDING', marker: '○' };
      }),
    [activeStep],
  );

  return (
    <Card className="surface-terminal-elevated mx-auto w-full max-w-3xl rounded-xl">
      <CardHeader className="border-b border-[var(--border-subtle)] pb-3">
        <CardTitle className="text-sm tracking-wider text-[var(--text-primary)]">
          TICKRIFY AI · PROCESSANDO
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 p-5 md:p-6">
        <div className="space-y-2 text-sm">
          {rows.map((step) => (
            <div
              key={step.label}
              className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
            >
              <span className="text-[var(--text-primary)]">&gt; {step.label}</span>
              <span
                className={
                  step.status === 'DONE'
                    ? 'text-[var(--signal-buy)]'
                    : step.status === 'RUNNING'
                      ? 'animate-pulse text-[var(--signal-hold)]'
                      : 'text-[var(--text-secondary)]'
                }
              >
                {step.marker} {step.status}
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="h-3 overflow-hidden rounded-sm bg-[var(--bg-overlay)]">
            <div
              className="h-full bg-[var(--signal-buy)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="font-terminal text-xs text-[var(--text-secondary)]">{progress}%</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default AnalysisLoading;
