import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { assertTrustedOpsTarget } from './ops-audit-target.mjs';

for (const target of [
  'https://tickrify.onrender.com',
  'https://tickrify.onrender.com:443/api/health',
]) {
  test(`aceita a API oficial: ${target}`, () => {
    assert.doesNotThrow(() => assertTrustedOpsTarget(target));
  });
}

for (const target of [
  'http://tickrify.onrender.com',
  'https://tickrify.onrender.com:444',
  'https://tickrify.onrender.com.attacker.example',
  'https://sub.tickrify.onrender.com',
  'https://tickrify.onrender.com@attacker.example',
  'https://user:password@tickrify.onrender.com',
  'https://attacker.example',
  'https://tickrify.com',
  'http://127.0.0.1:3001',
  '//tickrify.onrender.com',
  'not-a-url',
]) {
  test(`recusa destino não autorizado: ${target}`, () => {
    assert.throws(() => assertTrustedOpsTarget(target));
  });
}

const auditScript = new URL('./auditoria-producao.mjs', import.meta.url).href;

// Executa o CLI real com rede e TLS substituídos ANTES de importá-lo.
// Nenhum teste acessa produção ou utiliza credenciais reais.
function runAudit(api, { token = 'fixture-only', redirect = false } = {}) {
  const code = `
    import tls from 'node:tls';
    import { EventEmitter } from 'node:events';
    tls.connect = (_options, ready) => {
      const socket = new EventEmitter();
      socket.authorized = true;
      socket.getPeerCertificate = () => ({ valid_to: '2099-01-01' });
      socket.getProtocol = () => 'TLSv1.3';
      socket.end = () => {};
      socket.destroy = () => {};
      queueMicrotask(ready);
      return socket;
    };
    globalThis.fetch = async (value, options = {}) => {
      const url = new URL(value);
      const authenticated = new Headers(options.headers).has('x-ops-token');
      console.log('REQUEST', JSON.stringify({
        origin: url.origin, path: url.pathname,
        authenticated, redirect: options.redirect,
      }));
      const headers = {
        'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'self'",
      };
      if (authenticated && ${JSON.stringify(redirect)}) {
        return new Response(null, { status: 302, headers: {
          location: 'https://attacker.example/collect',
        }});
      }
      if (url.protocol === 'http:') {
        return new Response(null, { status: 308, headers: {
          location: value.replace('http:', 'https:'),
        }});
      }
      if (url.pathname === '/api/health/live' || authenticated) {
        return Response.json({ ai: { quickGrounding: 'enabled' } }, { headers });
      }
      if (url.pathname === '/api/demo/analyze') {
        return Response.json({ code: 'bot_check_failed' }, { status: 403 });
      }
      return new Response(null, { status: 401 });
    };
    process.argv = ['node', 'auditoria-producao.mjs', ${JSON.stringify(api)}];
    await import(${JSON.stringify(auditScript)});
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { SMOKE_OPS_TOKEN: token, INTERNAL_OPS_TOKEN: '', BACKEND_URL: '', FRONTEND_URL: '' },
  });
  assert.ifError(result.error);
  const requests = result.stdout.split('\n')
    .filter((line) => line.startsWith('REQUEST '))
    .map((line) => JSON.parse(line.slice(8)));
  return { ...result, requests };
}

test('CLI recusa destino arbitrário antes de qualquer acesso à rede', () => {
  const result = runAudit('https://attacker.example');
  assert.equal(result.status, 2);
  assert.deepEqual(result.requests, []);
  assert.doesNotMatch(result.stderr, /fixture-only/);
});

test('CLI preserva auditoria autenticada da API oficial', () => {
  const result = runAudit('https://tickrify.onrender.com');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const authenticated = result.requests.filter((request) => request.authenticated);
  assert.equal(authenticated.length, 1);
  assert.deepEqual(authenticated[0], {
    origin: 'https://tickrify.onrender.com', path: '/api/health',
    authenticated: true, redirect: 'manual',
  });
});

test('redirect autenticado falha sem seguir o destino externo', () => {
  const result = runAudit('https://tickrify.onrender.com', { redirect: true });
  assert.equal(result.status, 1);
  assert(result.requests.every((request) => request.redirect === 'manual'));
  assert(!result.requests.some((request) => request.origin.includes('attacker.example')));
});

test('auditoria de ambiente alternativo continua disponível sem token', () => {
  const result = runAudit('https://staging.example', { token: '' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert(!result.requests.some((request) => request.authenticated));
});

test('inputs do workflow são dados do shell, sem interpolação executável', () => {
  const workflow = readFileSync(new URL('../.github/workflows/auditoria-prod.yml', import.meta.url), 'utf8');
  const run = workflow.split('        run: |\n')[1].replace(/^          /gm, '');
  assert.doesNotMatch(run, /\$\{\{/);
  const api = 'https://attacker.example/$(printf INJECTED); `printf BAD`';
  const site = '"; printf BAD; #';
  const shell = run.replace('node scripts/auditoria-producao.mjs', "printf '%s\\n'");
  const result = spawnSync('bash', ['-c', shell], {
    encoding: 'utf8', env: { AUDIT_API: api, AUDIT_SITE: site },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${api}\n${site}\n`);
});
