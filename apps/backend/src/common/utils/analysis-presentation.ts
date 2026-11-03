import { countChecklistApproved } from './analysis-normalizer';

const mtfLabels: Record<string, string> = {
  en: 'One image supplied; periods not visible in that image are visual inferences: ',
  pt: 'Uma imagem fornecida; períodos não visíveis nela são inferências visuais: ',
  es: 'Una imagen proporcionada; los períodos no visibles en ella son inferencias visuales: ',
  fr: 'Une image fournie ; les périodes non visibles sont des inférences visuelles : ',
  de: 'Ein Bild bereitgestellt; darin nicht sichtbare Zeitrahmen sind visuelle Ableitungen: ',
  ja: '提供画像は1枚です。画像内に見えない時間足は視覚的推論です：',
};
// Score context is local to a clause/reference, independent of the requested output language.
const historicalScoreContext = /(?<!\p{L})(?:previous|previously|prior|old|earlier|historical|formerly|past|anterior(?:es|mente)?|antes|antig[oa]s?|históric[oa]s?|passad[oa]s?|pasad[oa]s?|prévi[oa]s?|previ[oa]s?|précédent(?:e|s|es)?|auparavant|antérieur(?:e|s|es)?|ancien(?:ne|s|nes)?|historique|passé(?:e|s|es)?|vorher(?:ig(?:e|en|er|es|em))?|zuvor|früher(?:e|en|er|es|em)?|bisherig(?:e|en|er|es|em)?|ehemalig(?:e|en|er|es|em)?|vergangen(?:e|en|er|es|em)?|historisch(?:e|en|er|es|em)?)(?!\p{L})|過去|以前|前回|前の|従来/iu;
const conditionalScoreContext = /(?<!\p{L})(?:if|unless|hypothetical|hypothetically|assuming|suppose|se|si|caso|hipotétic[oa]s?|condicional|supondo|suponiendo|hypothétique|conditionnel(?:le)?|supposons|wenn|falls|sofern|hypothetisch(?:e|en|er|es|em)?|würde(?:n)?)(?!\p{L})|もし|仮に|仮定|場合|なら|であれば|だったら/iu;

/** Display-only: does not change counts, evidence, signals, confidence or prices. */
export function presentAnalysis<T extends Record<string, any>>(analysis: T, language: string, additionalCharts: number): T {
  const out: Record<string, any> = { ...analysis };
  const count = analysis.factorsPresent;
  // Only an exactly seven-item checklist already reconciled by the normalizer
  // authorizes replacing an explicit score token. No free prose rewriting.
  if (Number.isInteger(count) && count >= 0 && count <= 7 && countChecklistApproved(analysis.structureValidation) === count) {
    for (const field of ['structureValidation', 'executiveSummary', 'reasoning']) {
      if (typeof analysis[field] !== 'string') continue;
      const text = analysis[field];
      out[field] = text.replace(/\b([0-7])\s*\/\s*7\b/gu, (match: string, _n: string, offset: number) => {
        const clausePrefix = text.slice(0, offset).split(/[.!?;。！？；\n]/u).pop() ?? '';
        // A preceding score starts a new reference, so its historical qualifier
        // must not suppress a later current score in the same sentence.
        const prefix = clausePrefix.split(/\b[0-7]\s*\/\s*7\b/u).pop() ?? '';
        const suffix = text.slice(offset + match.length)
          .split(/[,.!?;。！？；、\n]|\b(?:and|but|et|mais|und|aber|e|mas|y|pero)\b/iu)[0];
        const context = `${prefix} ${suffix}`;
        if (conditionalScoreContext.test(clausePrefix) || conditionalScoreContext.test(context) || historicalScoreContext.test(context)) return match;
        return field === 'structureValidation' || /checklist|placar|score|fator|factor|conflu|facteur|faktor|要因|項目|チェックリスト/iu.test(prefix) ? `${count}/7` : match;
      });
    }
  }
  const mtf = analysis.multiTimeframeAlignment;
  if (additionalCharts === 0 && typeof mtf === 'string' && mtf.trim() && !Object.values(mtfLabels).some(label => mtf.startsWith(label))) {
    const prefix = mtfLabels[language] ?? mtfLabels.en;
    out.multiTimeframeAlignment = prefix + mtf;
    out.displayMessages = { ...analysis.displayMessages, multiTimeframePrefix: { code: 'single_image_inference', params: {}, text: prefix } };
  }
  return out as T;
}
