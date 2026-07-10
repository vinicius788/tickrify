// Fingerprint de device para a demo anônima (/try).
//
// IMPORTANTE (arquitetura): este valor NÃO é a proteção — é só o identificador.
// O enforcement da cota (1 análise grátis por device) acontece no SERVIDOR,
// que persiste apenas um hash com salt secreto (LGPD/GDPR). Limpar localStorage
// ou abrir aba anônima regenera o MESMO fingerprint (é determinístico a partir
// do hardware/browser), então o bloqueio server-side continua valendo.

function canvasSignature(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-canvas';
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(60, 4, 90, 24);
    ctx.fillStyle = '#069';
    ctx.fillText('tickrify.fp.v1 \u{1F4C8}', 2, 8);
    ctx.strokeStyle = 'rgba(120, 60, 200, 0.7)';
    ctx.beginPath();
    ctx.arc(28, 20, 14, 0, Math.PI * 1.6);
    ctx.stroke();
    return canvas.toDataURL();
  } catch {
    return 'no-canvas';
  }
}

function webglSignature(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!gl) return 'no-webgl';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return `${vendor}~${renderer}`;
  } catch {
    return 'no-webgl';
  }
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback (ambientes sem WebCrypto, ex.: http local): hash djb2 simples.
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return `fb${h.toString(16).padStart(8, '0')}${input.length.toString(16)}`;
}

let cached: string | null = null;

/** Fingerprint determinístico do device (64 hex chars). */
export async function getDeviceFingerprint(): Promise<string> {
  if (cached) return cached;
  const nav = typeof navigator !== 'undefined' ? navigator : ({} as Navigator);
  const scr = typeof screen !== 'undefined' ? screen : ({ width: 0, height: 0, colorDepth: 0 } as Screen);
  const parts = [
    nav.userAgent || '',
    nav.language || '',
    Array.isArray(nav.languages) ? nav.languages.join(',') : '',
    String(nav.hardwareConcurrency || 0),
    String((nav as Navigator & { deviceMemory?: number }).deviceMemory || 0),
    nav.platform || '',
    `${scr.width}x${scr.height}x${scr.colorDepth}`,
    String(window.devicePixelRatio || 1),
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    canvasSignature(),
    webglSignature(),
  ];
  cached = await sha256Hex(parts.join('||'));
  return cached;
}
