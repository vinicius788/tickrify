import { useState, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { API_BASE_URL, AIAnalysisResponse } from '@/lib/api';

export type StreamingPhase = 'uploading' | 'analyzing' | 'structuring';

export interface StreamingState {
  phase: StreamingPhase | null;
  pct: number;
  partialText: string;
  result: AIAnalysisResponse | null;
  error: { code: string; message: string; retriable: boolean } | null;
  isStreaming: boolean;
}

const INITIAL_STATE: StreamingState = {
  phase: null,
  pct: 0,
  partialText: '',
  result: null,
  error: null,
  isStreaming: false,
};

export function useStreamingAnalysis() {
  const { getToken } = useAuth();
  const [state, setState] = useState<StreamingState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  const start = useCallback(
    async (file: File, opts?: { analysisType?: 'quick' | 'deep'; promptOverride?: string }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ ...INITIAL_STATE, isStreaming: true });

      try {
        const token = await getToken({ skipCache: true });

        const formData = new FormData();
        formData.append('image', file);
        if (opts?.analysisType) formData.append('analysisType', opts.analysisType);
        if (opts?.promptOverride) formData.append('promptOverride', opts.promptOverride);

        const response = await fetch(`${API_BASE_URL}/api/ai/analyze/stream`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const err = await response.json().catch(() => ({}));
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: {
              code: err.code || 'request_failed',
              message: err.message || 'Falha ao iniciar análise.',
              retriable: false,
            },
          }));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processLine = (line: string) => {
          // SSE lines: "event: name" or "data: {...}"
          if (line.startsWith('event:')) {
            // event type is handled together with the next data line
            return;
          }
          if (!line.startsWith('data:')) return;

          const jsonStr = line.slice(5).trim();
          if (!jsonStr) return;

          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(jsonStr);
          } catch {
            return;
          }

          // Determine event type from the buffer
          return payload;
        };

        let currentEvent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const raw of lines) {
            const line = raw.trim();
            if (!line) {
              currentEvent = '';
              continue;
            }

            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
              continue;
            }

            if (line.startsWith('data:')) {
              const jsonStr = line.slice(5).trim();
              if (!jsonStr) continue;

              let payload: Record<string, unknown>;
              try {
                payload = JSON.parse(jsonStr);
              } catch {
                continue;
              }

              switch (currentEvent) {
                case 'progress':
                  setState((prev) => ({
                    ...prev,
                    phase: (payload.phase as StreamingPhase) ?? prev.phase,
                    pct: typeof payload.pct === 'number' ? payload.pct : prev.pct,
                  }));
                  break;

                case 'chunk':
                  setState((prev) => ({
                    ...prev,
                    partialText: prev.partialText + (String(payload.text ?? '')),
                  }));
                  break;

                case 'result':
                  setState({
                    phase: 'structuring',
                    pct: 100,
                    partialText: '',
                    result: payload as unknown as AIAnalysisResponse,
                    error: null,
                    isStreaming: false,
                  });
                  break;

                case 'error':
                  setState((prev) => ({
                    ...prev,
                    isStreaming: false,
                    error: {
                      code: String(payload.code ?? 'unknown'),
                      message: String(payload.message ?? 'Erro na análise.'),
                      retriable: Boolean(payload.retriable),
                    },
                  }));
                  break;
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: {
            code: 'network_error',
            message: err instanceof Error ? err.message : 'Erro de conexão.',
            retriable: true,
          },
        }));
      }
    },
    [getToken],
  );

  return { state, start, cancel };
}
