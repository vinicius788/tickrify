import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewAnalysis from '../NewAnalysis';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { MAX_CHART_BYTES } from '@/lib/chart-upload';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
const start = vi.fn();
function file(type: string, size = 10) {
  const f = new File(['image'], type === 'image/png' ? 'chart.png' : 'chart.gif', { type });
  Object.defineProperty(f, 'size', { value: size });
  Object.defineProperty(f, 'arrayBuffer', { value: async () => new ArrayBuffer(10) });
  return f;
}
function drop(f: File) {
  fireEvent.drop(document.querySelector('[role="presentation"]')!, {
    dataTransfer: { files: [f], items: [{ kind: 'file', type: f.type, getAsFile: () => f }], types: ['Files'] },
  });
}

describe('chart upload validation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:chart');
  });
  afterEach(cleanup);

  it.each([
    ['image/gif', 10, 'Unsupported file. Choose a PNG, JPG/JPEG or WEBP image.'],
    ['image/png', MAX_CHART_BYTES + 1, 'File too large. Maximum size: 10 MB per image.'],
  ])('arquivo principal rejeitado mostra o motivo sem chamar a IA: %s', async (type, size, message) => {
    render(<LanguageProvider><NewAnalysis onStartAnalysis={start} /></LanguageProvider>);
    drop(file(type, size));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(start).not.toHaveBeenCalled();
    drop(file('image/png'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('Main chart (execution timeframe)')).toBeTruthy();
  });

  it('timeframe maior rejeitado informa limite e preserva o grafico principal', async () => {
    render(<LanguageProvider><NewAnalysis onStartAnalysis={start} /></LanguageProvider>);
    drop(file('image/png'));
    await screen.findByText('Main chart (execution timeframe)');
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file('image/png', MAX_CHART_BYTES + 1)] } });
    expect(screen.getByRole('alert').textContent).toContain('10 MB');
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText('Main chart (execution timeframe)')).toBeTruthy();
  });
});
