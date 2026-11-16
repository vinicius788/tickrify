/**
 * Montador unico do prompt (26/10/2026). Worker, caminho sincrono, /try e
 * scripts de medicao passam por `buildAnalysisPrompt`/`assembleAnalysisPrompt`;
 * nenhum outro arquivo monta prompt de analise. Desde 27/10/2026 o prompt e
 * sempre o do codigo: nada de banco, versao por job ou override.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PROMPT_C_CHANGES, TRADING_SYSTEM_PROMPT, TRADING_SYSTEM_PROMPT_B, TRADING_SYSTEM_PROMPT_C } from '../../common/prompts/trading-system-prompt';
import {
  assembleAnalysisPrompt,
  buildAnalysisPrompt,
  DEEP_ANALYSIS_INSTRUCTION,
  outputLanguageInstruction,
  promptVariantForUser,
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

describe('teste A/B do prompt', () => {
  afterEach(() => { delete process.env.PROMPT_VARIANT_B_PERCENT; });

  it('a B difere do prompt atual so na frase do nivel do pullback', () => {
    const sentence = ' Use the first pullback or retest closest to current price that has real structure (a reclaim, a swing, a zone edge), not the deepest one.';
    expect(TRADING_SYSTEM_PROMPT_B).not.toBe(TRADING_SYSTEM_PROMPT);
    expect(TRADING_SYSTEM_PROMPT_B.replace(sentence, () => '')).toBe(TRADING_SYSTEM_PROMPT);
  });

  it('sem variante, o montador usa o prompt atual; com B, o B', () => {
    const input = { userLanguage: 'en', analysisType: 'quick' } as const;
    expect(buildAnalysisPrompt(input)).toBe(buildAnalysisPrompt(input, 'A'));
    expect(buildAnalysisPrompt(input, 'B')).toContain('not the deepest one');
    expect(buildAnalysisPrompt(input)).not.toContain('not the deepest one');
  });

  const users = Array.from({ length: 2000 }, (_, i) => `user_${i}`);

  it('0 = todos na A, 100 = todos na B, sem usuario sempre A', () => {
    process.env.PROMPT_VARIANT_B_PERCENT = '0';
    expect(users.every((u) => promptVariantForUser(u) === 'A')).toBe(true);
    process.env.PROMPT_VARIANT_B_PERCENT = '100';
    expect(users.every((u) => promptVariantForUser(u) === 'B')).toBe(true);
    expect(promptVariantForUser(null)).toBe('A');
  });

  it('sem linha no /admin nem env, o padrao deixa todos na A', () => {
    expect(users.every((u) => promptVariantForUser(u) === 'A')).toBe(true);
  });

  it('valor invalido cai no padrao: todos na A', () => {
    process.env.PROMPT_VARIANT_B_PERCENT = 'abc';
    expect(users.every((u) => promptVariantForUser(u) === 'A')).toBe(true);
  });

  it('com 50 divide perto da metade e a mesma pessoa fica na mesma variante', () => {
    process.env.PROMPT_VARIANT_B_PERCENT = '50';
    const inB = users.filter((u) => promptVariantForUser(u) === 'B').length;
    expect(inB).toBeGreaterThan(900);
    expect(inB).toBeLessThan(1100);
    expect(users.map(promptVariantForUser)).toEqual(users.map(promptVariantForUser));
  });
});

describe('prompt C (16/11/2026)', () => {
  afterEach(() => { delete process.env.PROMPT_VARIANT_B_PERCENT; delete process.env.PROMPT_VARIANT_C_PERCENT; });
  const users = Array.from({ length: 2000 }, (_, i) => `user_${i}`);

  it('cada trecho trocado existe uma vez no prompt atual, e a C e o atual com so essas trocas', () => {
    let back = TRADING_SYSTEM_PROMPT_C;
    for (const [from, to] of PROMPT_C_CHANGES) {
      expect(TRADING_SYSTEM_PROMPT.split(from)).toHaveLength(2);
      expect(TRADING_SYSTEM_PROMPT_C.split(to)).toHaveLength(2);
      back = back.replace(to, () => from);
    }
    expect(back).toBe(TRADING_SYSTEM_PROMPT);
    expect(TRADING_SYSTEM_PROMPT_C).not.toBe(TRADING_SYSTEM_PROMPT);
  });

  it('nao afrouxa C3 nem C6, nao muda o contrato e nao tem travessao nem emoji', () => {
    const line = (prompt: string, start: string) => prompt.split('\n').find((l) => l.startsWith(start));
    for (const start of ['C3 Setup:', 'C6 Geometry:', '4. NO_TRADE']) expect(line(TRADING_SYSTEM_PROMPT_C, start)).toBe(line(TRADING_SYSTEM_PROMPT, start));
    expect(TRADING_SYSTEM_PROMPT_C).toContain('Use when: the bias is neutral, the tape is empty, C3 FAIL, no valid geometry, or fewer than 4 PASS.');
    for (const [, to] of PROMPT_C_CHANGES) expect(to).not.toMatch(/[\u2014\u2013]|\p{Extended_Pictographic}/u);
    expect(buildAnalysisPrompt({ userLanguage: 'en', analysisType: 'quick' }, 'C')).toContain('not a round number');
  });

  it('0 (padrao) = ninguem na C; 10 = perto de 10% das contas, sempre as mesmas; 100 = todos', () => {
    expect(users.every((u) => promptVariantForUser(u) === 'A')).toBe(true);
    process.env.PROMPT_VARIANT_C_PERCENT = '10';
    const inC = users.filter((u) => promptVariantForUser(u) === 'C');
    expect(inC.length).toBeGreaterThan(150);
    expect(inC.length).toBeLessThan(250);
    expect(users.filter((u) => promptVariantForUser(u) === 'C')).toEqual(inC);
    expect(promptVariantForUser(null)).toBe('A');
    process.env.PROMPT_VARIANT_C_PERCENT = '100';
    expect(users.every((u) => promptVariantForUser(u) === 'C')).toBe(true);
    process.env.PROMPT_VARIANT_C_PERCENT = 'abc';
    expect(users.every((u) => promptVariantForUser(u) === 'A')).toBe(true);
  });

  it('quem esta na B fica na B', () => {
    process.env.PROMPT_VARIANT_B_PERCENT = '100';
    process.env.PROMPT_VARIANT_C_PERCENT = '100';
    expect(users.every((u) => promptVariantForUser(u) === 'B')).toBe(true);
  });
});
