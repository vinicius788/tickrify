import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Options = Record<string, (...a: unknown[]) => void> & { sitekey: string };
let rendered: Options | null = null;
const remove = vi.fn();

async function load(siteKey = 'site-key') {
  vi.resetModules();
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', siteKey);
  return import('@/lib/turnstile');
}

describe('Turnstile da demo: motivo de cada falha', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rendered = null;
    remove.mockClear();
    (window as any).turnstile = { render: (_c: HTMLElement, o: Options) => { rendered = o; return 'w1'; }, execute: vi.fn(), remove };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    delete (window as any).turnstile;
  });

  it('sem chave configurada: null e motivo not_configured', async () => {
    const t = await load('');
    expect(await t.getTurnstileToken()).toBeNull();
    expect(t.getTurnstileOutcome()).toBe('not_configured');
  });

  it('desafio resolvido: devolve o token e o motivo ok', async () => {
    const t = await load();
    const pending = t.getTurnstileToken();
    await vi.advanceTimersByTimeAsync(0);
    rendered!.callback('tok-1');
    expect(await pending).toBe('tok-1');
    expect(t.getTurnstileOutcome()).toBe('ok');
    expect(remove).toHaveBeenCalledWith('w1');
  });

  it('erro do widget e token vencido ficam registrados', async () => {
    const t = await load();
    let pending = t.getTurnstileToken();
    await vi.advanceTimersByTimeAsync(0);
    rendered!['error-callback']();
    expect(await pending).toBeNull();
    expect(t.getTurnstileOutcome()).toBe('widget_error');
    pending = t.getTurnstileToken();
    await vi.advanceTimersByTimeAsync(0);
    rendered!['expired-callback']();
    expect(await pending).toBeNull();
    expect(t.getTurnstileOutcome()).toBe('expired');
  });

  it('desafio silencioso sem resposta desiste em 20 s', async () => {
    const t = await load();
    const pending = t.getTurnstileToken();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toBeNull();
    expect(t.getTurnstileOutcome()).toBe('timeout');
  });

  it('desafio na tela: nao some aos 20 s e aceita a resposta da pessoa depois', async () => {
    const t = await load();
    const pending = t.getTurnstileToken();
    await vi.advanceTimersByTimeAsync(5_000);
    rendered!['before-interactive-callback']();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(remove).not.toHaveBeenCalled();
    rendered!.callback('tok-humano');
    expect(await pending).toBe('tok-humano');
    expect(t.getTurnstileOutcome()).toBe('ok');
  });

  it('desafio na tela sem resposta por 90 s: motivo timeout_interactive', async () => {
    const t = await load();
    const pending = t.getTurnstileToken();
    await vi.advanceTimersByTimeAsync(1_000);
    rendered!['before-interactive-callback']();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await pending).toBeNull();
    expect(t.getTurnstileOutcome()).toBe('timeout_interactive');
  });

  it('render que estoura vira render_error', async () => {
    (window as any).turnstile.render = () => { throw new Error('TurnstileError'); };
    const t = await load();
    expect(await t.getTurnstileToken()).toBeNull();
    expect(t.getTurnstileOutcome()).toBe('render_error');
  });
});
