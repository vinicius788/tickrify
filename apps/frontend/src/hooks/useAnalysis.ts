import { useState, useCallback } from 'react';
import { useAPIClient, AIAnalysisResponse } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export type AnalysisState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'polling'; analysisId: string }
  | { status: 'completed'; analysis: AIAnalysisResponse }
  | { status: 'failed'; errorMessage: string; retriable: boolean; analysisId?: string };

const RETRIABLE_ERROR_MESSAGES = [
  'sobrecarregado',
  'rate limit',
  'tente novamente',
];

function isRetriableMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return RETRIABLE_ERROR_MESSAGES.some((keyword) => lower.includes(keyword));
}

export function useAnalysis() {
  const api = useAPIClient();
  const { toast } = useToast();
  const [state, setState] = useState<AnalysisState>({ status: 'idle' });

  const start = useCallback(
    async (payload: { imageFile?: File; base64Image?: string; analysisType?: 'quick' | 'deep'; promptOverride?: string }) => {
      setState({ status: 'submitting' });

      try {
        const initial = await api.createAnalysis(payload);
        setState({ status: 'polling', analysisId: initial.id });

        const completed = await api.waitForAnalysisCompletion(initial.id, initial);

        if (completed.status === 'failed') {
          const msg = completed.errorMessage || 'Erro na análise. Tente novamente.';
          const retriable = isRetriableMessage(msg);
          setState({ status: 'failed', errorMessage: msg, retriable, analysisId: initial.id });
          toast({ title: 'Análise falhou', description: msg, variant: 'destructive' });
          return;
        }

        setState({ status: 'completed', analysis: completed });
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : 'Erro na análise. Tente novamente.';
        const retriable = isRetriableMessage(msg);
        setState({ status: 'failed', errorMessage: msg, retriable });
        toast({ title: 'Erro', description: msg, variant: 'destructive' });
      }
    },
    [api, toast],
  );

  const retry = useCallback(
    async (analysisId?: string) => {
      if (state.status !== 'failed') return;

      if (analysisId) {
        setState({ status: 'polling', analysisId });
        try {
          const completed = await api.waitForAnalysisCompletion(analysisId);
          if (completed.status === 'failed') {
            const msg = completed.errorMessage || 'Erro na análise. Tente novamente.';
            setState({ status: 'failed', errorMessage: msg, retriable: isRetriableMessage(msg), analysisId });
            toast({ title: 'Análise falhou', description: msg, variant: 'destructive' });
          } else {
            setState({ status: 'completed', analysis: completed });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Erro na análise. Tente novamente.';
          setState({ status: 'failed', errorMessage: msg, retriable: isRetriableMessage(msg), analysisId });
          toast({ title: 'Erro', description: msg, variant: 'destructive' });
        }
        return;
      }

      setState({ status: 'idle' });
    },
    [state, api, toast],
  );

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return { state, start, retry, reset };
}
