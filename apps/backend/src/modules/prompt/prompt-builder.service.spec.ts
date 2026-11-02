/**
 * Montador unico do prompt (26/10/2026). Worker, caminho sincrono, /try e
 * scripts de medicao passam por `buildAnalysisPrompt`/`assembleAnalysisPrompt`;
 * nenhum outro arquivo monta prompt de analise. Desde 27/10/2026 o prompt e
 * sempre o do codigo: nada de banco, versao por job ou override.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TRADING_SYSTEM_PROMPT } from '../../common/prompts/trading-system-prompt';
import {
  assembleAnalysisPrompt,
  buildAnalysisPrompt,
  DEEP_ANALYSIS_INSTRUCTION,
  outputLanguageInstruction,
  splitUserContextClose,
} from './prompt-builder.service';

describe('buildAnalysisPrompt', () => {
  it('sempre o prompt do codigo, com o idioma no lugar do placeholder', () => {
    const prompt = buildAnalysisPrompt({ userLanguage: 'es', analysisType: 'quick' });
    expect(prompt).toBe(TRADING_SYSTEM_PROMPT.replace('{{USER_CONTEXT}}', outputLanguageInstruction('Spanish')));
    expect(prompt).toContain('TICKRIFY ANALYSIS ENGINE v11');
    expect(prompt).not.toContain('{{USER_CONTEXT}}');
    expect(prompt).not.toContain(DEEP_ANALYSIS_INSTRUCTION);
  });

  it.each([undefined, '', 'xx', 'PT'])('idioma %p vira English', (userLanguage) => {
    expect(buildAnalysisPrompt({ userLanguage, analysisType: 'quick' })).toContain('OUTPUT LANGUAGE: English');
  });

  it('deep: o bloco do modo deep entra uma vez, dentro do <user_context>, depois do idioma', () => {
    const prompt = buildAnalysisPrompt({ userLanguage: 'pt', analysisType: 'deep' });
    expect(prompt.split('ANALYSIS MODE: DEEP')).toHaveLength(2);
    const inside = prompt.slice(prompt.lastIndexOf('<user_context>'), prompt.lastIndexOf('</user_context>'));
    expect(inside.indexOf('OUTPUT LANGUAGE: Portuguese (Brazil)')).toBeLessThan(inside.indexOf('ANALYSIS MODE: DEEP'));
  });

  it('o bloco deep nao empurra sinal nem WAIT e nao tem travessao nem emoji', () => {
    expect(DEEP_ANALYSIS_INSTRUCTION).toContain('never into a different state');
    expect(DEEP_ANALYSIS_INSTRUCTION).not.toMatch(/—|\p{Extended_Pictographic}/u);
    expect(DEEP_ANALYSIS_INSTRUCTION).not.toMatch(/\b(BUY|SELL|WAIT|HOLD)\b/);
  });
});

describe('assembleAnalysisPrompt (prompt candidato dos scripts de medicao)', () => {
  it('mesmo montador; sem placeholder fica sem idioma e o deep vai no fim', () => {
    expect(assembleAnalysisPrompt('meu {{USER_CONTEXT}}', { userLanguage: 'de' })).toBe(`meu ${outputLanguageInstruction('German')}`);
    expect(assembleAnalysisPrompt('sem placeholder', { analysisType: 'deep' })).toBe(`sem placeholder\n\n${DEEP_ANALYSIS_INSTRUCTION}`);
  });

  it('cifrao no idioma ou no prompt nao vira padrao de replace', () => {
    expect(assembleAnalysisPrompt('preco $29 {{USER_CONTEXT}} $&', {})).toBe(`preco $29 ${outputLanguageInstruction('English')} $&`);
  });
});

describe('splitUserContextClose', () => {
  it('tira o </user_context> do fim para os blocos variaveis entrarem antes dele', () => {
    const prompt = buildAnalysisPrompt({ userLanguage: 'en' });
    const { instructions, close } = splitUserContextClose(prompt);
    expect(close).toBe('</user_context>');
    expect(instructions.endsWith(outputLanguageInstruction('English'))).toBe(true);
    expect(`${instructions}\n${close}`).toBe(prompt.trimEnd());
  });

  it('prompt sem a tag no fim volta inteiro', () => {
    expect(splitUserContextClose('antigo')).toEqual({ instructions: 'antigo', close: null });
  });
});

describe('montador unico: ninguem mais monta o prompt da analise', () => {
  const root = path.resolve(__dirname, '../../..');
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(full);
      return /\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name) ? [full] : [];
    });

  it('so o montador troca o {{USER_CONTEXT}}', () => {
    const offenders = ['src', 'worker', 'scripts']
      .flatMap((d) => files(path.join(root, d)))
      .filter((f) => !f.endsWith(path.join('prompt', 'prompt-builder.service.ts')))
      .filter((f) => /replace\(\s*['"`]\{\{USER_CONTEXT\}\}/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
