import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { getTranslations, LANGUAGES, formatNumber } from '../index';
import { errorText, messageText, translatedAnnotation } from '../messages';

function leaves(value: unknown, path = ''): Record<string, string> {
  if (typeof value === 'string') return { [path]: value };
  return Object.assign({}, ...Object.entries(value as object).map(([key, child]) => leaves(child, `${path}.${key}`)));
}
const sections = ['pricingPage', 'pricingPlan', 'pricingWeekly', 'pricingChrome', 'dashboardCopy', 'foundingBanner', 'demoUi', 'interfaceExtras', 'sampleUi', 'backendMessages', 'scenarioLabels', 'monitoring', 'alerts'] as const;

describe('six-language presentation contract', () => {
  it('has complete keys and the same interpolation parameters in every language', () => {
    const en = getTranslations('en');
    for (const { code } of LANGUAGES) for (const section of sections) {
      const expected = leaves(en[section]);
      const actual = leaves(getTranslations(code)[section]);
      expect(Object.keys(actual).sort(), `${code}.${section}`).toEqual(Object.keys(expected).sort());
      for (const key of Object.keys(expected)) {
        expect(actual[key].trim(), `${code}.${section}${key}`).not.toBe('');
        const parameters = (s: string) => [...s.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
        expect(parameters(actual[key]), `${code}.${section}${key}`).toEqual(parameters(expected[key]));
      }
    }
  });

  it('translates stable codes and parameters while preserving unknown codes and legacy prose', () => {
    for (const { code } of LANGUAGES) {
      const t = getTranslations(code);
      expect(messageText(t, code, 'engine_news_event', {}, 'original English')).toBe(t.backendMessages.engine_news_event);
      expect(messageText(t, code, 'engine_future_reason', {}, 'old model prose')).toBe('old model prose');
      expect(messageText(t, code, undefined, {}, 'legacy prose')).toBe('legacy prose');
      expect(messageText(t, code, 'trade_check_limit', {}, 'missing params')).toBe('missing params');
      expect(messageText(t, code, 'affiliate_min_payout', { amount: 1234.5 }, '')).toContain(formatNumber(1234.5, code));
      expect(errorText(t, code, { code: 'openai_invalid_json', message: 'raw' }, '')).toBe(code === 'en' ? 'raw' : t.backendMessages.analysis_failed);
      expect(errorText(t, code, { code: 'validation_failed', message: 'raw', details: [{ code: 'validation_empty_field', params: { field: 'symbol' }, text: 'symbol vazio' }] }, '')).toBe(t.backendMessages.validation_failed.replace('{details}', t.backendMessages.validation_empty_field.replace('{field}', 'symbol')));
      const text = 'Model prose.\n\nReferencias visuais: A e B.';
      const metadata = { code: 'drawing_references', params: { firstId: 'A', secondId: 'B' }, text: 'Referencias visuais: A e B.' };
      expect(translatedAnnotation(t, code, text, metadata)).toBe(`Model prose.\n\n${messageText(t, code, metadata.code, metadata.params, metadata.text)}`);
      expect(translatedAnnotation(t, code, 'Unrelated model prose.', metadata)).toBe('Unrelated model prose.');
    }
  });

  it('does not reintroduce inline two-language UI dictionaries in PR A', () => {
    const root = resolve(import.meta.dirname, '../../..');
    const files: string[] = [];
    function visitDirectory(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory() && !['__tests__', 'i18n', 'admin'].includes(entry.name)) visitDirectory(path);
        else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(path);
      }
    }
    visitDirectory(root);
    const failures: string[] = [];
    for (const file of files) {
      // Explicitly excluded from this task: the demonstration itself.
      if (/(?:PlatformDemoSection|AccuracyPage|AboutPage|AffiliatesPage|AffiliateDashboardPage|NotFoundPage|LegalPage|CookiePolicyPage|PrivacyPolicyPage|TermsPage|RiskDisclosurePage|AdminPage|sample-analyses)\.tsx?$/.test(file)) continue;
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if (ts.isObjectLiteralExpression(node)) {
          const names = node.properties.map(p => p.name?.getText(source));
          if (names.includes('pt') && names.includes('en') && names.length < 6) {
            // Only untouched example prose remains bilingual. UI titles/buttons
            // must come from sampleUi, never be added to this exception.
            const proseOnly = file.endsWith('/SampleAnalyses.tsx') && node.properties.every(p => ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer) && p.initializer.properties.every(field => ['pickerDesc', 'banner', 'neutralTitle', 'neutralDesc', 'afterTitle', 'afterFine'].includes(field.name?.getText(source) ?? '')));
            if (!proseOnly) failures.push(`${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
          }
        }
        if (ts.isConditionalExpression(node) && /\b(?:language|lang)\s*(?:===|!==)\s*['"](?:pt|en|es|fr|de|ja)['"]/.test(node.condition.getText(source))) {
          const excludedProse = file.endsWith('/SampleAnalyses.tsx') && node.whenTrue.getText(source) === 'COPY.pt' && node.whenFalse.getText(source) === 'COPY.en';
          const calendarWeekStart = file.endsWith('/lib/journal.ts') && ts.isNumericLiteral(node.whenTrue) && ts.isNumericLiteral(node.whenFalse);
          if (!excludedProse && !calendarWeekStart) failures.push(`${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: language ternary`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(failures).toEqual([]);
  });
});
