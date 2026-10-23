import { presentAnalysis } from './analysis-presentation';
import { buildPersistedAnalysisPayload, normalizeStoredAnalysis } from './analysis-payload';

const input = { factorsPresent: 5, confluenceScore: 71.43,
  structureValidation: '✅ HTF | ❌ Zone | ✅ ICT | ✅ Anti-retail | ✅ Structure | ✅ R:R | ❌ MTF → 4/7',
  executiveSummary: 'Checklist 4/7. Entrada 100, stop 95.', reasoning: 'Checklist 4/7. R1 2.0.',
  multiTimeframeAlignment: 'H1 bullish | H4 bullish | D1 neutral', entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120 };

describe('Presentation: restricted replacements, no strategic rewrite', () => {
  it('only reconciles explicit scores against the existing seven-item checklist', () => {
    const p = presentAnalysis(input, 'pt', 0);
    expect(p.executiveSummary).toBe('Checklist 5/7. Entrada 100, stop 95.');
    expect(p.reasoning).toBe('Checklist 5/7. R1 2.0.');
    expect(p.structureValidation).toContain('→ 5/7');
    expect(input.executiveSummary).toContain('4/7');
    for (const k of ['entry', 'stopLoss', 'takeProfit1', 'takeProfit2', 'factorsPresent', 'confluenceScore'] as const) expect(p[k]).toBe(input[k]);
  });
  it.each(['en', 'pt', 'es', 'fr', 'de', 'ja'])('qualifies single-image inference in %s, idempotently', language => {
    const p = presentAnalysis(input, language, 0);
    expect(p.multiTimeframeAlignment).not.toBe(input.multiTimeframeAlignment);
    expect(p.multiTimeframeAlignment.endsWith(input.multiTimeframeAlignment)).toBe(true);
    expect(presentAnalysis(p, language, 0)).toEqual(p);
  });
  it.each([['en', 'Checklist'], ['pt', 'Placar'], ['es', 'Confluencia'], ['fr', 'Facteurs'], ['de', 'Faktoren'], ['ja', 'チェックリスト']])('reconciles only the numeric score in localized %s text', (lang, label) => {
    const a = { ...input, executiveSummary: `${label} 4/7.` };
    expect(presentAnalysis(a, lang, 0).executiveSummary).toBe(`${label} 5/7.`);
  });
  it('does not certify or relabel multiple supplied charts as actual higher timeframes', () => {
    expect(presentAnalysis(input, 'en', 1).multiTimeframeAlignment).toBe(input.multiTimeframeAlignment);
  });
  it('does not manufacture missing MTF evidence or rewrite ambiguous prose', () => {
    const a = { ...input, structureValidation: 'unknown', executiveSummary: '4/7', multiTimeframeAlignment: null };
    expect(presentAnalysis(a, 'en', 0)).toEqual(a);
    const b = { ...input, executiveSummary: 'Reference 4/7' };
    expect(presentAnalysis(b, 'en', 0).executiveSummary).toBe(b.executiveSummary);
  });
  it('does not rewrite old, alternative or hypothetical scores or unknown image provenance', () => {
    const p = { ...input, executiveSummary: 'Anterior checklist 4/7. Se checklist 4/7, observar.' };
    expect(presentAnalysis(p, 'pt', -1).executiveSummary).toBe(p.executiveSummary);
    expect(presentAnalysis(p, 'pt', -1).multiTimeframeAlignment).toBe(p.multiTimeframeAlignment);
  });
  it('keeps Deep labels, output fields and untouched raw content through serialization', () => {
    const a = { ...input, executiveSummary: 'READING: Checklist 4/7\nVOLATILITY: moderate\nSCENARIOS: wait' };
    const raw = JSON.stringify({ recommendation: 'BUY', confidence: 60, analysis: a });
    const p = buildPersistedAnalysisPayload({ source: {}, recommendation: 'BUY', confidence: 60, analysis: a,
      presentation: { language: 'en', additionalCharts: 0 } });
    const restored = normalizeStoredAnalysis({ recommendation: 'BUY', confidence: 60, result: p.fullResponse, fullResponse: raw });
    expect(restored.fullResponse.analysis.executiveSummary).toContain('READING: Checklist 5/7\nVOLATILITY: moderate');
    expect(raw).toContain('Checklist 4/7');
    expect(restored.fullResponse).not.toHaveProperty('observation');
    expect(restored.recommendation).toBe('BUY');
    expect(restored.fullResponse.analysis.entry).toBe(100);
  });
});


describe('Historical and conditional scores in the six supported languages', () => {
  const cases = [
    ['en', 'Current checklist ', 'Previous checklist ', 'If checklist ', 'previously'],
    ['pt', 'Placar atual ', 'Placar anterior ', 'Se placar ', 'anteriormente'],
    ['es', 'Confluencia actual ', 'Confluencia anterior ', 'Si confluencia ', 'anteriormente'],
    ['fr', 'Checklist actuel ', 'Checklist précédent ', 'Si checklist ', 'auparavant'],
    ['de', 'Aktuelle Faktoren ', 'Vorherige Faktoren ', 'Wenn Faktoren ', 'zuvor'],
    ['ja', '現在のチェックリスト', '過去のチェックリスト', 'もしチェックリスト', '（前回）'],
  ];

  describe.each(cases)('%s', (language, current, historical, hypothetical, postfix) => {
    const show = (text: string) => presentAnalysis({ ...input, executiveSummary: text, reasoning: text }, language, 0);
    it('reconciles the current score and preserves every non-text field', () => {
      const before = { ...input, executiveSummary: `${current}4/7.`, recommendation: 'SELL', confidence: 64,
        invalidationLevel: 94, riskRewardTp1: 2, riskRewardTp2: 4, rawContent: 'original bytes' };
      const after = presentAnalysis(before, language, 1);
      expect(after.executiveSummary).toBe(`${current}5/7.`);
      expect({ ...after, executiveSummary: before.executiveSummary, reasoning: before.reasoning,
        structureValidation: before.structureValidation }).toEqual(before);
    });
    it('preserves a historical score', () => {
      const text = `${historical}4/7.`;
      expect(show(text)).toMatchObject({ executiveSummary: text, reasoning: text });
    });
    it('preserves a hypothetical condition', () => {
      const text = `${hypothetical}4/7, wait.`;
      expect(show(text)).toMatchObject({ executiveSummary: text, reasoning: text });
    });
    it('handles multiple current, historical and conditional scores without context leaking between clauses', () => {
      const text = `${historical}4/7; ${current}4/7; ${hypothetical}3/7, wait.`;
      const expected = `${historical}4/7; ${current}5/7; ${hypothetical}3/7, wait.`;
      expect(show(text)).toMatchObject({ executiveSummary: expected, reasoning: expected });
    });
    it('keeps historical and current references distinct within one sentence', () => {
      const text = `${current}4/7, ${historical}4/7, ${current}3/7.`;
      const expected = `${current}5/7, ${historical}4/7, ${current}5/7.`;
      expect(show(text)).toMatchObject({ executiveSummary: expected, reasoning: expected });
    });
    it('preserves a historical qualifier after the score', () => {
      const text = `${current}4/7 ${postfix}.`;
      expect(show(text)).toMatchObject({ executiveSummary: text, reasoning: text });
    });
    it('does not lose a qualifier more than 45 characters before its score', () => {
      const text = `${historical}(${'context '.repeat(12)}) 4/7.`;
      expect(show(text)).toMatchObject({ executiveSummary: text, reasoning: text });
    });
    it('also protects non-current scores inside the seven-item validation text', () => {
      const text = `${input.structureValidation}; ${historical}4/7; ${hypothetical}4/7, wait.`;
      const after = presentAnalysis({ ...input, structureValidation: text }, language, 1);
      expect(after.structureValidation).toBe(`${input.structureValidation.replace('4/7', '5/7')}; ${historical}4/7; ${hypothetical}4/7, wait.`);
    });
    it.each(['BUY', 'SELL', 'WAIT'])('preserves the %s decision and public payload shape', recommendation => {
      const text = `${historical}4/7. ${current}4/7. ${hypothetical}4/7, wait.`;
      const source = { ...input, executiveSummary: text, reasoning: text };
      const raw = JSON.stringify({ recommendation, analysis: source });
      const stored = buildPersistedAnalysisPayload({ source: {}, recommendation, confidence: 60,
        analysis: source, presentation: { language, additionalCharts: 0 } });
      const again = normalizeStoredAnalysis({ recommendation, confidence: 60, result: stored.fullResponse, fullResponse: raw });
      expect(again.recommendation).toBe(recommendation);
      expect(again.fullResponse.analysis.executiveSummary).toBe(`${historical}4/7. ${current}5/7. ${hypothetical}4/7, wait.`);
      expect(Object.keys(again.fullResponse.analysis).sort()).toEqual(Object.keys(stored.fullResponse.analysis).sort());
      for (const key of ['entry', 'stopLoss', 'takeProfit1', 'takeProfit2', 'factorsPresent', 'confluenceScore']) {
        expect(again.fullResponse.analysis[key]).toBe(stored.fullResponse.analysis[key]);
      }
      expect(raw).toContain(`${current}4/7.`);
      expect(presentAnalysis(again.fullResponse.analysis, language, 0)).toEqual(again.fullResponse.analysis);
    });
  });
});
