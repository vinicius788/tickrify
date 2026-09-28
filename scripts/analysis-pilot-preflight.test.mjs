import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyPilot } from './analysis-pilot-preflight.mjs';

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-pilot-preflight-'));
  fs.mkdirSync(path.join(root, 'charts'));
  fs.mkdirSync(path.join(root, 'data'));
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('fixture')]);
  const samples = Buffer.from('{}');
  const selection = Buffer.from('{}');
  const data = Buffer.from('{"candles":[]}');
  fs.writeFileSync(path.join(root, 'samples.json'), samples);
  fs.writeFileSync(path.join(root, 'pilot-selection.json'), selection);
  fs.writeFileSync(path.join(root, 'data', 'BTCUSDT_30m.json'), data);
  for (const id of ['a', 'b']) fs.writeFileSync(path.join(root, 'charts', `${id}.png`), png);
  const manifest = {
    schemaVersion: 1,
    count: 2,
    sourceSamplesSha256: hash(samples),
    selectionSha256: hash(selection),
    countByClass: { crypto: 2 },
    cases: ['a', 'b'].map((id, index) => ({
      id, symbol: 'BTCUSDT', interval: '30m', assetClass: 'crypto',
      mode: index ? 'deep' : 'quick', chartFile: `charts/${id}.png`,
      chartSha256: hash(png), dataSha256: hash(data),
    })),
  };
  const save = () => fs.writeFileSync(path.join(root, 'pilot-manifest.json'), JSON.stringify(manifest));
  save();
  return { root, manifest, save };
}

test('confere entrada, modos, fontes e quantidade mínima de chamadas sem API', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const result = verifyPilot(f.root);
  assert.equal(result.status, 'verified_offline_no_api_calls');
  assert.deepEqual(result.modes, { quick: 1, deep: 1 });
  assert.equal(result.requiredCallsForTwoVariantsWithoutRetries, 4);
});

test('bloqueia gráfico modificado, fuga de caminho e caso repetido', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.root, 'charts', 'a.png'), 'alterado');
  assert.throws(() => verifyPilot(f.root), /Hash divergente/);
  fs.writeFileSync(path.join(f.root, 'charts', 'a.png'), fs.readFileSync(path.join(f.root, 'charts', 'b.png')));
  f.manifest.cases[0].chartFile = '../outro.png';
  f.save();
  assert.throws(() => verifyPilot(f.root), /fora do diretório/);
  f.manifest.cases[0].chartFile = 'charts/a.png';
  f.manifest.cases[1].id = 'a';
  f.save();
  assert.throws(() => verifyPilot(f.root), /repetido/);
});
