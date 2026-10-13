import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterNextPaint } from '../utils';

describe('afterNextPaint', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs once, after two animation frames, with painted=true', () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const fn = vi.fn();

    afterNextPaint(fn);
    frames.shift()!(0);
    expect(fn).not.toHaveBeenCalled();
    frames.shift()!(0);
    expect(fn).toHaveBeenCalledWith(true);

    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never loses the call when no frame comes (background tab)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const fn = vi.fn();

    afterNextPaint(fn, 1000);
    vi.advanceTimersByTime(999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledWith(false);
  });

  it('does not wait for a frame when the page is already hidden', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const fn = vi.fn();

    afterNextPaint(fn);
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledWith(false);
    expect(raf).not.toHaveBeenCalled();
  });
});
