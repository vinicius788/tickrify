import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewAnalysis from '@/components/dashboard/NewAnalysis';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

const track = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', () => ({ track }));

function pasteEvent(files: File[], target: EventTarget = window) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  const items = files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file }));
  Object.defineProperty(event, 'clipboardData', { value: { items } });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });

const renderScreen = () =>
  render(
    <LanguageProvider>
      <NewAnalysis onStartAnalysis={() => undefined} />
    </LanguageProvider>,
  );

describe('tela de envio do painel: colar o print', () => {
  beforeEach(() => {
    window.localStorage.setItem('tickrify-language', 'en');
    URL.createObjectURL = vi.fn(() => 'blob:chart');
    track.mockClear();
  });
  afterEach(() => cleanup());

  it('print colado vai para a revisao e conta upload_pasted', async () => {
    renderScreen();
    const event = pasteEvent([png()]);

    await waitFor(() => expect(screen.getByAltText('Gráfico principal')).toBeTruthy());
    expect(event.defaultPrevented).toBe(true);
    expect(track).toHaveBeenCalledWith('upload_pasted', { surface: 'dashboard' });
  });

  it('colar texto ou arquivo que nao e imagem nao faz nada', () => {
    renderScreen();
    const event = pasteEvent([new File(['x'], 'nota.txt', { type: 'text/plain' })]);

    expect(screen.queryByAltText('Gráfico principal')).toBeNull();
    expect(event.defaultPrevented).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });

  it('colar dentro de um campo de texto nao rouba o print', () => {
    renderScreen();
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    const event = pasteEvent([png()], field);
    field.remove();

    expect(screen.queryByAltText('Gráfico principal')).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('a dica mostra Ctrl+V fora do Mac', () => {
    renderScreen();
    expect(screen.getByText(/Ctrl\+V/)).toBeTruthy();
    expect(screen.queryByText(/⌘V/)).toBeNull();
  });
});
