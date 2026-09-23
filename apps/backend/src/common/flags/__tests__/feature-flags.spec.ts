import {
  FLAG_REGISTRY,
  __resetFlagCacheForTests,
  applyFlagOverrideLocally,
  flagBool,
  flagNumber,
  getFlagCacheStatus,
  loadFlagsFromDb,
  resolveAllFlags,
  resolveFlag,
  startFlagRefresh,
} from '../feature-flags';

const CHAVES = FLAG_REGISTRY.map((f) => f.key);

describe('loja de apps — resolução de flags', () => {
  const envOriginal = { ...process.env };

  beforeEach(() => {
    __resetFlagCacheForTests();
    for (const chave of CHAVES) delete process.env[chave];
  });

  afterAll(() => {
    process.env = envOriginal;
  });

  describe('ordem banco → ambiente → padrão', () => {
    it('sem nada configurado, usa o padrão do código', () => {
      const r = resolveFlag('ENABLE_QUICK_GROUNDING');
      expect(r.value).toBe('false');
      expect(r.source).toBe('padrao');
    });

    it('a variável de ambiente vence o padrão', () => {
      process.env.ENABLE_QUICK_GROUNDING = 'true';
      const r = resolveFlag('ENABLE_QUICK_GROUNDING');
      expect(r.value).toBe('true');
      expect(r.source).toBe('ambiente');
    });

    it('o banco vence a variável de ambiente', () => {
      process.env.ENABLE_QUICK_GROUNDING = 'true';
      applyFlagOverrideLocally('ENABLE_QUICK_GROUNDING', 'false');
      const r = resolveFlag('ENABLE_QUICK_GROUNDING');
      expect(r.value).toBe('false');
      expect(r.source).toBe('banco');
    });

    it('limpar o override devolve o controle para o ambiente', () => {
      process.env.ENABLE_QUICK_GROUNDING = 'true';
      applyFlagOverrideLocally('ENABLE_QUICK_GROUNDING', 'false');
      applyFlagOverrideLocally('ENABLE_QUICK_GROUNDING', null);
      const r = resolveFlag('ENABLE_QUICK_GROUNDING');
      expect(r.value).toBe('true');
      expect(r.source).toBe('ambiente');
    });

    it('chave fora do registro estoura em vez de virar flag fantasma', () => {
      expect(() => resolveFlag('ENABLE_QUIK_GROUNDING')).toThrow(/desconhecida/i);
    });
  });

  describe('compatibilidade com o comportamento que já existia', () => {
    // A troca só é segura se cada flag continuar decidindo EXATAMENTE como
    // decidia com `process.env` direto. Estes casos são o contrato.

    it('ENABLE_QUICK_GROUNDING continua DESLIGADO por padrão (era === "true")', () => {
      expect(flagBool('ENABLE_QUICK_GROUNDING')).toBe(false);
      process.env.ENABLE_QUICK_GROUNDING = 'true';
      expect(flagBool('ENABLE_QUICK_GROUNDING')).toBe(true);
    });

    it('a guarda temporal experimental do deep cripto permanece desligada por padrão', () => {
      expect(flagBool('ENABLE_DEEP_CRYPTO_GROUNDING')).toBe(false);
      process.env.ENABLE_DEEP_CRYPTO_GROUNDING = 'true';
      expect(flagBool('ENABLE_DEEP_CRYPTO_GROUNDING')).toBe(true);
      process.env.ENABLE_DEEP_CRYPTO_GROUNDING = 'false';
      expect(flagBool('ENABLE_DEEP_CRYPTO_GROUNDING')).toBe(false);
    });

    it.each(['ENABLE_RR_GUARD', 'ENABLE_NEWS_GUARD', 'ENABLE_MARKET_ENRICHMENT', 'ENABLE_OUTCOME_TRACKING'])(
      '%s continua LIGADO por padrão (era !== "false")',
      (chave) => {
        expect(flagBool(chave)).toBe(true);
        process.env[chave] = 'false';
        expect(flagBool(chave)).toBe(false);
      },
    );

    // ⭐ O caso que motivou o parser tolerante.
    //
    // A semântica antiga NÃO era uniforme: `ENABLE_RR_GUARD !== 'false'` mantinha
    // a guarda LIGADA para qualquer valor estranho, enquanto
    // `ENABLE_QUICK_GROUNDING === 'true'` mantinha DESLIGADO. Um parser ingênuo
    // ("é 'true'? então ligado") desligaria a guarda de risco por causa de um
    // typo — calada, e a guarda de risco é o que impede o motor de sugerir
    // entrada com retorno pior que o risco.
    it.each(['sim', 'yes', 'ON', '', '  ', 'talvez', 'TRUE '])(
      'valor lixo (%p) NÃO desliga uma guarda que é ligada por padrão',
      (lixo) => {
        applyFlagOverrideLocally('ENABLE_RR_GUARD', lixo);
        expect(flagBool('ENABLE_RR_GUARD')).toBe(true);
      },
    );

    it.each(['sim', 'ON', 'talvez'])(
      'valor lixo (%p) NÃO liga uma função que é desligada por padrão',
      (lixo) => {
        applyFlagOverrideLocally('ENABLE_QUICK_GROUNDING', lixo);
        expect(flagBool('ENABLE_QUICK_GROUNDING')).toBe(false);
      },
    );

    it('aceita 1/0 além de true/false', () => {
      applyFlagOverrideLocally('ENABLE_QUICK_GROUNDING', '1');
      expect(flagBool('ENABLE_QUICK_GROUNDING')).toBe(true);
      applyFlagOverrideLocally('ENABLE_RR_GUARD', '0');
      expect(flagBool('ENABLE_RR_GUARD')).toBe(false);
    });

    it('AB_PROMPT_V9_PERCENT continua 0 por padrão e lê número do banco', () => {
      expect(flagNumber('AB_PROMPT_V9_PERCENT')).toBe(0);
      applyFlagOverrideLocally('AB_PROMPT_V9_PERCENT', '20');
      expect(flagNumber('AB_PROMPT_V9_PERCENT')).toBe(20);
    });

    it('número inválido cai no padrão em vez de virar NaN', () => {
      applyFlagOverrideLocally('AB_PROMPT_V9_PERCENT', 'vinte');
      expect(flagNumber('AB_PROMPT_V9_PERCENT')).toBe(0);
    });
  });

  describe('carga a partir do banco', () => {
    it('popula o cache e marca a origem', async () => {
      const ok = await loadFlagsFromDb(async () => [
        { key: 'ENABLE_QUICK_GROUNDING', value: 'true' },
      ]);
      expect(ok).toBe(true);
      expect(resolveFlag('ENABLE_QUICK_GROUNDING').source).toBe('banco');
      expect(getFlagCacheStatus().overridesNoBanco).toBe(1);
    });

    it('ignora chave que não está no registro (sobra de flag removida do código)', async () => {
      await loadFlagsFromDb(async () => [
        { key: 'FLAG_QUE_NAO_EXISTE_MAIS', value: 'true' },
        { key: 'ENABLE_RR_GUARD', value: 'false' },
      ]);
      expect(getFlagCacheStatus().overridesNoBanco).toBe(1);
      expect(flagBool('ENABLE_RR_GUARD')).toBe(false);
    });

    // ⭐ A propriedade que torna esta feature segura de existir.
    it('banco fora do ar NÃO derruba nada: tudo volta a resolver por env', async () => {
      process.env.ENABLE_QUICK_GROUNDING = 'true';

      const ok = await loadFlagsFromDb(async () => {
        throw new Error('relation "tickrify.FeatureFlag" does not exist');
      });

      expect(ok).toBe(false);
      expect(() => flagBool('ENABLE_QUICK_GROUNDING')).not.toThrow();
      expect(flagBool('ENABLE_QUICK_GROUNDING')).toBe(true);
      expect(getFlagCacheStatus().ultimoErro).toMatch(/does not exist/);
    });

    it('falha na recarga preserva o cache anterior em vez de zerar as flags', async () => {
      await loadFlagsFromDb(async () => [{ key: 'ENABLE_RR_GUARD', value: 'false' }]);
      expect(flagBool('ENABLE_RR_GUARD')).toBe(false);

      await loadFlagsFromDb(async () => {
        throw new Error('conexão caiu');
      });

      // Continua desligada: uma queda de rede não pode religar sozinha uma
      // guarda que alguém desligou de propósito.
      expect(flagBool('ENABLE_RR_GUARD')).toBe(false);
    });
  });

  describe('refresher', () => {
    it('carrega na hora e para quando mandado', async () => {
      const load = jest.fn(async () => [{ key: 'ENABLE_RR_GUARD', value: 'false' }]);
      const stop = startFlagRefresh(load, 10_000);
      await Promise.resolve();
      await Promise.resolve();
      expect(load).toHaveBeenCalledTimes(1);
      stop();
    });
  });

  describe('integridade do registro', () => {
    it('toda função tem descrição, risco e padrão coerente com o tipo', () => {
      for (const f of FLAG_REGISTRY) {
        expect(f.label.length).toBeGreaterThan(3);
        // A descrição aparece no painel e é o que evita alguém desligar algo
        // sem saber o que quebra. Vazia = armadilha.
        expect(f.description.length).toBeGreaterThan(30);
        expect(['alto', 'medio', 'baixo']).toContain(f.risk);
        if (f.type === 'boolean') expect(['true', 'false']).toContain(f.defaultValue);
        if (f.type === 'number') expect(Number.isFinite(Number(f.defaultValue))).toBe(true);
      }
    });

    it('não há chave duplicada', () => {
      expect(new Set(CHAVES).size).toBe(CHAVES.length);
    });

    it('resolveAllFlags devolve exatamente o registro', () => {
      expect(resolveAllFlags().map((f) => f.key).sort()).toEqual([...CHAVES].sort());
    });
  });
});
