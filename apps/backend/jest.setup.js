/* global process, Request */
// Teste nao sai da maquina (25/11/2026). O Prisma Client le o .env local ao ser
// importado: a ANTHROPIC_API_KEY de verdade ligava o terceiro leitor e os testes do
// adapter chamavam api.anthropic.com (cobrado) e o feed do calendario (ate 4 s),
// o que estourava o tempo do pre-push. Chave vazia (o dotenv nao sobrescreve) e
// fetch externo recusado; teste que precisa de rede ou chave faz o proprio mock.
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENAI_API_KEY = '';
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)) return realFetch(input, init);
  return Promise.reject(new TypeError(`fetch blocked in tests: ${url.slice(0, 80)}`));
};
