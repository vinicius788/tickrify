/**
 * Compartilhado pelo painel (NewAnalysis) e pelo /try desde 05/10/2026: o /try
 * mandava a foto do celular inteira (varios MB) pela rede movel e 30% dos
 * envios de grafico proprio caiam em network_error.
 */

/**
 * Redimensiona o print ANTES do upload, para as dimensoes que a OpenAI usa de
 * fato. Nao e "comprimir para economizar": e parar de enviar pixel que o outro
 * lado descarta.
 *
 * Em `detail: 'high'` a OpenAI faz exatamente isto com a imagem recebida:
 * encaixa dentro de 2048x2048 e depois escala ate o MENOR lado ter 768px, antes
 * de fatiar em blocos de 512. Um print 2560x1440 e reduzido para 1366x768 la
 * dentro de qualquer jeito. Fazendo a mesma conta aqui, o modelo recebe a MESMA
 * imagem, e o usuario para de subir megabytes que sao jogados fora.
 *
 * Medido em 08/09/2026: a analise leva ~30s de modelo, e o upload de um print
 * de 4MB numa conexao brasileira tipica somava de 5 a 25 segundos ANTES disso,
 * fora da medicao do backend. Era o maior pedaco invisivel da espera.
 *
 * REGRAS DE SEGURANCA (o produto esta no ar):
 * - NUNCA aumenta imagem. Print menor que o alvo passa intacto.
 * - Mantem PNG (sem perda) por padrao. Grafico tem texto fino de eixo e pavio
 *   de candle, que e onde artefato de compressao com perda estraga leitura.
 *   So cai para WebP se o PNG reduzido ainda passar de 1,5MB.
 * - Se o resultado nao ficar menor que o original, devolve o ORIGINAL.
 * - QUALQUER falha (canvas bloqueado, decode, toBlob nulo) devolve o ORIGINAL.
 *   Comprimir nunca pode impedir uma analise de acontecer.
 */
const OPENAI_MAX_SIDE = 2048;
const OPENAI_SHORT_SIDE = 768;
const WEBP_FALLBACK_BYTES = 1_500_000;

export async function shrinkChartImage(file: File): Promise<File> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    if (!width || !height) {
      bitmap.close?.();
      return file;
    }

    // Mesma conta da OpenAI, na mesma ordem.
    let scale = Math.min(1, OPENAI_MAX_SIDE / Math.max(width, height));
    const shortAfterFit = Math.min(width, height) * scale;
    if (shortAfterFit > OPENAI_SHORT_SIDE) scale *= OPENAI_SHORT_SIDE / shortAfterFit;

    // Ja esta no tamanho (ou menor): nao mexe. Reencodar de graca so perderia.
    if (scale >= 1) {
      bitmap.close?.();
      return file;
    }

    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();

    const toBlob = (type: string, quality?: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

    let blob = await toBlob('image/png');
    let outType = 'image/png';
    let outExt = 'png';

    if (blob && blob.size > WEBP_FALLBACK_BYTES) {
      const webp = await toBlob('image/webp', 0.92);
      // Só aceita o WebP se o navegador realmente encodou WebP: quando não
      // suporta, o toBlob devolve PNG silenciosamente com o tamanho de antes.
      if (webp && webp.type === 'image/webp' && webp.size < blob.size) {
        blob = webp;
        outType = 'image/webp';
        outExt = 'webp';
      }
    }

    if (!blob || blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^.]+$/, '') || 'chart';
    return new File([blob], `${base}.${outExt}`, { type: outType, lastModified: Date.now() });
  } catch {
    return file;
  }
}
