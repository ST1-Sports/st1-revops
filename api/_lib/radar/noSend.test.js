import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RADAR_SCOPES } from './gmail.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(ROOT, '../../..');

const FORBIDDEN = [
  'messages/send',
  'drafts/send',
  'gmail.send',
  'users.messages.send',
];

async function walk(dir, acc = []) {
  const entries = await readdir(dir);
  for (const name of entries) {
    const p = join(dir, name);
    const st = await stat(p);
    if (st.isDirectory()) await walk(p, acc);
    else if (/\.(js|jsx|mjs|ts)$/.test(name) && !name.endsWith('.test.js')) acc.push(p);
  }
  return acc;
}

describe('Radar never sends email', () => {
  it('OAuth scopes are readonly + compose only', () => {
    assert.deepEqual(RADAR_SCOPES, [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ]);
    assert.ok(!RADAR_SCOPES.some(s => s.endsWith('gmail.send')));
  });

  it('radar source files contain no send endpoints', async () => {
    const files = [
      ...(await walk(join(WORKSPACE, 'api/_lib/radar'))),
      ...(await walk(join(WORKSPACE, 'api/radar'))),
      join(WORKSPACE, 'api/cron/radar-sync.js'),
      join(WORKSPACE, 'src/pages/FollowUpRadar.jsx'),
      join(WORKSPACE, 'src/pages/RadarInboxCard.jsx'),
    ];
    const hits = [];
    for (const f of files) {
      let src;
      try { src = await readFile(f, 'utf8'); } catch { continue; }
      for (const needle of FORBIDDEN) {
        if (src.includes(needle)) hits.push(`${f}: ${needle}`);
      }
    }
    assert.deepEqual(hits, []);
  });
});
