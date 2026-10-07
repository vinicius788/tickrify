// `wxt build` termina o build mas o processo nao sai (algum handle do Vite
// fica aberto; visto no WXT 0.21.4 + Vite 8). A mesma chamada pela API, com
// saida explicita, para `npm run build` terminar sozinho.
import { build } from 'wxt';

try {
  await build({});
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
