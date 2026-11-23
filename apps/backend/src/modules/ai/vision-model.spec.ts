import OpenAI from 'openai';
import {
  AnthropicVisionModel,
  FallbackVisionModel,
  OpenAiVisionModel,
  collapseNullable,
  countUnionFields,
  createVisionModels,
  recordProviderComparison,
  restoreNulls,
  type VisionModelRequest,
} from './vision-model';

const fakeOpenAiClient = (create: jest.Mock = jest.fn()) =>
  ({ chat: { completions: { create } } }) as any;

const request = (extra: Partial<VisionModelRequest> = {}): VisionModelRequest => ({
  tier: 'quick',
  instructions: 'FIXED',
  context: ['VARIABLE'],
  userContent: [
    { type: 'text', text: 'Analyze' },
    { type: 'image', url: 'data:image/png;base64,AAAA' },
  ],
  schemaName: 'test',
  schema: {
    type: 'object',
    properties: { a: { type: ['number', 'null'] } },
    required: ['a'],
    additionalProperties: false,
  },
  maxTokens: 1000,
  timeoutMs: 5_000,
  ...extra,
});

function anthropicReply(body: Record<string, unknown>, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => body,
  });
}

describe('createVisionModels', () => {
  it('with only the OpenAI key: OpenAI active, no second provider, no log', () => {
    const log = jest.fn();
    const { model, secondary } = createVisionModels(fakeOpenAiClient(), { OPENAI_API_KEY: 'sk-test' }, log);
    expect(model.primary).toBeInstanceOf(OpenAiVisionModel);
    expect(model.provider).toBe('openai');
    expect(secondary).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it('AI_PROVIDER=anthropic without the key stays on OpenAI with one quiet line', () => {
    const log = jest.fn();
    const { model, secondary } = createVisionModels(
      fakeOpenAiClient(),
      { OPENAI_API_KEY: 'sk-test', AI_PROVIDER: 'anthropic' },
      log,
    );
    expect(model.provider).toBe('openai');
    expect(secondary).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('switches provider by env var without changing the request', async () => {
    const fetchImpl = anthropicReply({
      model: 'claude-test',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"a":1}' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 },
    });
    const create = jest.fn();
    const { model, secondary } = createVisionModels(
      fakeOpenAiClient(create),
      { OPENAI_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'test-key', AI_PROVIDER: 'anthropic', ANTHROPIC_MODEL_QUICK: 'claude-test' },
      jest.fn(),
      fetchImpl as any,
    );
    expect(model.provider).toBe('anthropic');
    expect(secondary?.provider).toBe('openai');

    const result = await model.complete(request());
    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: 'anthropic',
      model: 'claude-test',
      content: '{"a":1}',
      finishReason: 'stop',
      usage: { promptTokens: 100, cachedTokens: 90, completionTokens: 5, totalTokens: 105 },
    });
  });

  it('OpenAI stays active by default even when the Anthropic key exists', () => {
    const { model, secondary } = createVisionModels(
      fakeOpenAiClient(),
      { OPENAI_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'test-key' },
    );
    expect(model.provider).toBe('openai');
    expect(secondary?.provider).toBe('anthropic');
  });
});

describe('AnthropicVisionModel request', () => {
  const models = { quick: 'claude-q', deep: 'claude-d' };

  it('sends base64 images, cached fixed instructions and structured output', async () => {
    const fetchImpl = anthropicReply({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], usage: {} });
    await new AnthropicVisionModel('k', models, fetchImpl as any).complete(request());

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-q');
    expect(body.system).toEqual([
      { type: 'text', text: 'FIXED', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'VARIABLE' },
    ]);
    expect(body.messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
    expect(body.output_config.format).toMatchObject({ type: 'json_schema' });
    expect(body).not.toHaveProperty('temperature');
  });

  it('schema with more than 16 nullable fields goes structured, collapsed, and 0 / empty string come back as null', async () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < 17; i++) properties[`f${i}`] = { type: ['number', 'null'] };
    properties.txt = { type: ['string', 'null'] };
    properties.plain = { type: 'number' };
    const schema = { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
    expect(countUnionFields(schema)).toBe(18);

    const fetchImpl = anthropicReply({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"f0":0,"f1":5,"txt":"","plain":0}' }],
      usage: {},
    });
    const result = await new AnthropicVisionModel('k', models, fetchImpl as any).complete(request({ schema }));
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const sent = body.output_config.format.schema;
    expect(body.output_config.format.type).toBe('json_schema');
    expect(sent.properties.f0).toEqual({ type: 'number' });
    expect(sent.properties.txt).toEqual({ type: 'string' });
    expect(countUnionFields(sent)).toBe(0);
    expect(body.system[0].text).toContain('write 0 for a number');
    // campo anulavel: 0 e '' viram null; campo NAO anulavel mantem o 0
    expect(JSON.parse(result.content)).toMatchObject({ f0: null, f1: 5, txt: null, plain: 0 });
  });

  it('collapseNullable removes null from enums and restoreNulls follows array paths', () => {
    const schema = {
      type: 'object',
      properties: {
        dir: { type: ['string', 'null'], enum: ['long', 'short', null] },
        list: { type: 'array', items: { type: 'object', properties: { n: { type: ['number', 'null'] } } } },
      },
    };
    const { schema: out, paths } = collapseNullable(schema);
    const props = (out as any).properties;
    expect(props.dir).toEqual({ type: 'string', enum: ['long', 'short'] });
    expect(props.list.items.properties.n).toEqual({ type: 'number' });
    expect(restoreNulls({ dir: '', list: [{ n: 0 }, { n: 3 }] }, paths)).toEqual({
      dir: null,
      list: [{ n: null }, { n: 3 }],
    });
  });

  it('sends output_config.effort: low by default, medium/high when asked', async () => {
    const run = async (reasoningEffort?: 'medium' | 'high' | 'low') => {
      const fetchImpl = anthropicReply({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], usage: {} });
      await new AnthropicVisionModel('k', models, fetchImpl as any).complete(request({ reasoningEffort }));
      return JSON.parse(fetchImpl.mock.calls[0][1].body).output_config.effort;
    };
    expect(await run()).toBe('low');
    expect(await run('medium')).toBe('medium');
    expect(await run('high')).toBe('high');
  });

  it('maps truncation, refusal and HTTP errors', async () => {
    const truncated = anthropicReply({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"a":' }], usage: {} });
    expect((await new AnthropicVisionModel('k', models, truncated as any).complete(request())).finishReason).toBe('length');

    const refused = anthropicReply({ stop_reason: 'refusal', content: [], usage: {} });
    expect((await new AnthropicVisionModel('k', models, refused as any).complete(request())).refusal).toBe('refusal');

    const limited = anthropicReply({ error: { message: 'rate limited' } }, 429);
    await expect(new AnthropicVisionModel('k', models, limited as any).complete(request()))
      .rejects.toMatchObject({ status: 429 });
  });
});

describe('FallbackVisionModel', () => {
  const ok = (provider: string) => ({
    provider,
    complete: jest.fn().mockResolvedValue({ provider, content: '{}' }),
  });

  it('uses the other provider when the active one throws', async () => {
    const primary = { provider: 'a', complete: jest.fn().mockRejectedValue(new Error('timeout')) };
    const secondary = ok('b');
    const onFallback = jest.fn();
    const result = await new FallbackVisionModel(primary, secondary, onFallback).complete(request());
    expect(result.provider).toBe('b');
    expect(onFallback).toHaveBeenCalledWith('a', 'b', expect.any(Error));
  });

  it('without another provider the error goes up unchanged', async () => {
    const error = Object.assign(new Error('rate'), { status: 429 });
    const primary = { provider: 'a', complete: jest.fn().mockRejectedValue(error) };
    await expect(new FallbackVisionModel(primary, null).complete(request())).rejects.toBe(error);
  });

  it('never calls the other provider when the active one answers', async () => {
    const primary = ok('a');
    const secondary = ok('b');
    await new FallbackVisionModel(primary, secondary).complete(request());
    expect(secondary.complete).not.toHaveBeenCalled();
  });
});

describe('OpenAiVisionModel', () => {
  it('preserves the analysis wire contract through the real SDK without a network call', async () => {
    const transport = jest.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      id: 'synthetic-completion', object: 'chat.completion', created: 0, model: 'gpt-5.6-luna',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"a":1}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
    }), { headers: { 'content-type': 'application/json' } }));
    const client = new OpenAI({ apiKey: 'synthetic-test-only', fetch: transport as typeof fetch, maxRetries: 0 });
    const previous = process.env.AI_MODEL_QUICK;
    process.env.AI_MODEL_QUICK = 'gpt-5.6-luna';
    try {
      const result = await new OpenAiVisionModel(client).complete(request({ reasoningEffort: 'low' }));
      const [url, init] = transport.mock.calls[0];
      expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: 'gpt-5.6-luna', max_completion_tokens: 1000, reasoning_effort: 'low' });
      expect(body.messages[0]).toEqual({ role: 'system', content: 'FIXED\n\nVARIABLE' });
      expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'high' } });
      expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'test', strict: true } });
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('seed');
      expect(result).toMatchObject({ content: '{"a":1}', finishReason: 'stop', usage: { promptTokens: 100, completionTokens: 5 } });
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.AI_MODEL_QUICK;
      else process.env.AI_MODEL_QUICK = previous;
    }
  });

  it('without instructions and schema: no system message and a free JSON object', async () => {
    const create = jest.fn().mockResolvedValue({ model: 'gpt-4o', choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
    const previous = process.env.AI_MODEL_QUICK;
    process.env.AI_MODEL_QUICK = 'gpt-4o';
    try {
      await new OpenAiVisionModel(fakeOpenAiClient(create)).complete(
        request({ tier: 'quick', instructions: '', context: [], schema: undefined, imageDetail: 'low', sampling: { temperature: 0 }, maxTokens: 80 }),
      );
    } finally {
      if (previous === undefined) delete process.env.AI_MODEL_QUICK;
      else process.env.AI_MODEL_QUICK = previous;
    }
    const body = create.mock.calls[0][0];
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content[1].image_url.detail).toBe('low');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body).toMatchObject({ max_tokens: 80, temperature: 0 });
    expect(body).not.toHaveProperty('top_p');
  });
});

describe('recordProviderComparison', () => {
  it('writes both results and never throws', async () => {
    const create = jest.fn().mockResolvedValue({});
    const summary = {
      provider: 'openai', model: 'm', respondedModel: null, modelMs: 1,
      usage: { promptTokens: 1, cachedTokens: 0, completionTokens: 1, reasoningTokens: 0, totalTokens: 2 },
      recommendation: 'BUY' as const, entry: 1, stopLoss: 0.5, takeProfit1: 2, result: {}, error: null,
    };
    await recordProviderComparison(
      { adminAudit: { create } },
      { analysisId: 'an1', userId: 'u1', comparison: Promise.resolve({ primary: summary, secondary: summary, agree: true }) },
      jest.fn(),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'ai:provider_compare', targetUserId: 'u1', details: expect.objectContaining({ analysisId: 'an1', agree: true }) }),
    });

    const warn = jest.fn();
    await recordProviderComparison(
      { adminAudit: { create: jest.fn().mockRejectedValue(new Error('db')) } },
      { analysisId: 'an1', userId: 'u1', comparison: Promise.resolve({ primary: summary, secondary: summary, agree: true }) },
      warn,
    );
    expect(warn).toHaveBeenCalled();
  });
});
