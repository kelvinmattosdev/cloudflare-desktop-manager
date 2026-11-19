const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseNotes, collectReleaseNotes, savePendingUpdate, pendingUpdateFor, clearPendingUpdate } = require('../src/release-notes.cjs');
const { createUpdater } = require('../src/updater.cjs');

const transition = { from: '1.0.0', to: '1.2.0' };
const stable = (tag_name, body, extra) => ({ tag_name, body, draft: false, prerelease: false, ...extra });

test('only completed in-app updates leave notes for the target version until dismissed', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbodesk-notes-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'pending-update.json');
  assert.equal(pendingUpdateFor(file, '1.2.0'), null);
  savePendingUpdate(file, 'v1.0.0', '1.2.0');
  assert.deepEqual(pendingUpdateFor(file, '1.2.0'), transition);
  assert.deepEqual(pendingUpdateFor(file, '1.2.0'), transition);
  clearPendingUpdate(file, '1.1.0', '1.2.0');
  assert.deepEqual(pendingUpdateFor(file, '1.2.0'), transition);
  clearPendingUpdate(file, transition.from, transition.to);
  assert.equal(pendingUpdateFor(file, '1.2.0'), null);
  savePendingUpdate(file, '1.0.0', '1.2.0');
  assert.equal(pendingUpdateFor(file, '1.0.0'), null);
  assert.equal(pendingUpdateFor(file, '1.2.0'), null);
  assert.throws(() => savePendingUpdate(file, '1.2.0', '1.1.0'), /inválida/);
});

test('collects all skipped stable releases with pagination, deduplication and security notes', async () => {
  const calls = [];
  const history = await collectReleaseNotes({ transition,
    markdown: '# Histórico\n## [1.2.0] - local\n- Novo tema escuro.\n## 1.1.0\n- Nova busca de DNS.',
    fetcher: async (url, options) => {
      calls.push(new URL(url).searchParams.get('page'));
      assert.equal(new URL(url).origin, 'https://api.github.com');
      assert.equal(options.headers.Authorization, undefined);
      if (calls.length === 1) return Response.json([
        stable('v1.2.1', 'Versão futura'),
        stable('v1.2.0', '- Novo tema escuro'),
        stable('v1.1.1', '### Segurança\n- Corrige CVE-2026-12345.'),
        stable('v1.1.2', 'Beta', { prerelease: true })
      ], { headers: { link: '<https://example.invalid/never-followed>; rel="next"' } });
      return Response.json([
        stable('v1.1.0', '- Nova busca de DNS.\n- Melhora a conexão de rede.'),
        stable('v1.0.0', 'Não pertence ao intervalo')
      ]);
    }
  });
  assert.deepEqual(calls, ['1', '2']);
  assert.equal(history.complete, true);
  assert.deepEqual(history.releases.map(x => x.version), ['1.2.0', '1.1.1', '1.1.0']);
  assert.equal(history.releases[0].notes.length, 1);
  assert.equal(history.releases[0].notes[0].icon, '🎨');
  assert.equal(history.releases[1].notes[0].security, true);
  assert.equal(history.releases[1].notes[0].icon, '🛡️');
  assert.deepEqual(history.releases[2].notes.map(note => note.icon), ['🌐', '☁️']);
});

test('offline notes fall back to the bundled changelog and show no invented details', async () => {
  const history = await collectReleaseNotes({ transition, markdown: '## 1.1.0\n### Correções\n- Corrige a busca.',
    fetcher: async () => { throw new Error('offline'); } });
  assert.equal(history.complete, false);
  assert.equal(history.releases[0].version, '1.2.0');
  assert.deepEqual(history.releases[0].notes, []);
  assert.equal(history.releases[1].notes[0].text, 'Corrige a busca.');
});

test('release notes omit download instructions and preserve underscores in DNS labels', () => {
  const notes = parseNotes('### Qual arquivo baixar\n- baixe a versão Linux\n### DNS\n- Ajusta `_acme-challenge`.\n### Segurança\n- **Renova** a verificação.');
  assert.equal(notes.length, 2);
  assert.equal(notes[0].text, 'Ajusta _acme-challenge.');
  assert.equal(notes[0].icon, '🌐');
  assert.equal(notes[1].security, true);
});

test('a feature that displays security notes is not mislabeled as a security patch', () => {
  const [modal, fix] = parseNotes('- O modal destaca as correções de segurança.\n- Corrige uma vulnerabilidade na validação.');
  assert.equal(modal.security, false);
  assert.equal(modal.icon, '📋');
  assert.equal(fix.security, true);
});

test('updater records the transition before installation and discards it on failure', async () => {
  const actions = [];
  let fail = true;
  const updater = createUpdater({ currentVersion: transition.from, kind: 'deb',
    lookup: async () => ({ version: transition.to, asset: {} }),
    stageNotes: (...args) => actions.push(['stage', ...args]),
    discardNotes: (...args) => actions.push(['discard', ...args]),
    apply: async (_release, _kind, _image, _progress, install) => {
      install();
      actions.push(['install']);
      if (fail) throw new Error('cancelled');
    },
    restart: () => actions.push(['restart'])
  });
  await updater.check();
  assert.deepEqual(actions, []);
  await updater.install(transition.to);
  assert.deepEqual(actions.splice(0), [
    ['stage', '1.0.0', '1.2.0'], ['install'], ['discard', '1.0.0', '1.2.0']
  ]);
  fail = false;
  await updater.install(transition.to);
  assert.deepEqual(actions, [['stage', '1.0.0', '1.2.0'], ['install'], ['restart']]);
});
