const fs = require('node:fs');
const { parseVersion, compareVersions, repository } = require('./updater.cjs');

function savePendingUpdate(file, from, to) {
  const transition = { from: parseVersion(from), to: parseVersion(to) };
  if (compareVersions(transition.from, transition.to) >= 0) throw new Error('Transição de versão inválida.');
  const temp = `${file}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(transition), { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch { /* Keep the original result. */ }
  }
}

function readTransition(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const from = parseVersion(data.from), to = parseVersion(data.to);
    return compareVersions(from, to) < 0 ? { from, to } : null;
  } catch { return null; }
}

function clearPendingUpdate(file, from, to) {
  const transition = readTransition(file);
  if (transition?.from === from && transition?.to === to) fs.rmSync(file, { force: true });
}

function pendingUpdateFor(file, current) {
  const transition = readTransition(file);
  if (transition?.to === current) return transition;
  // A failed/cancelled install or manual jump must not show notes on a later, unrelated launch.
  if (transition) {
    try { clearPendingUpdate(file, transition.from, transition.to); } catch { /* Ignore stale notes. */ }
  }
  return null;
}

const security = /\b(?:seguran[çc]a|security|vulnerab\p{L}*|CVE-\d{4}-\d+)\b/iu;
const securityNote = /\bCVE-\d{4}-\d+\b|^(?:(?:seguran[çc]a|security)\s*[:–-]|(?:patch|corre[çc][aã]o|atualiza[çc][aã]o) de seguran[çc]a\b|(?:corrig\p{L}*|mitig\p{L}*|refor[çc]\p{L}*|fix\p{L}*)\b[^.!?]{0,100}\b(?:vulnerab\p{L}*|seguran[çc]a|security)\b)/iu;
const installation = /\b(?:instala[çc][aã]o|install(?:ation)?|download|baixar|anexos|artefatos|arquivos)\b/iu;
const topics = [
  [/dns|registro|nameserver|subdom[ií]nio|\bttl\b/i, '🌐'],
  [/nuvem|\brede\b|proxy|cloudflare|conex[aã]o/i, '☁️'],
  [/engrenagem/i, '⚙️'],
  [/contraste|acessibilidade/i, '👁️'],
  [/tema|escuro|apar[eê]ncia|logo|[íi]cone|visual/i, '🎨'],
  [/configura[çc][aã]o|prefer[eê]ncia|engrenagem/i, '⚙️'],
  [/token|cofre|autentica[çc][aã]o|credencial/i, '🔑'],
  [/notas (?:da|de) vers[aã]o|changelog|hist[óo]rico|modal/i, '📋'],
  [/atualiza|update/i, '⬆️'],
  [/velocidade|desempenho|performance|mais r[aá]pid/i, '⚡'],
  [/build|linux|windows|macos|instalador/i, '📦'],
  [/corre[çc][aã]o|corrig|erro|falha|fix/i, '🛠️']
];

function plain(line) {
  return line.replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`|\*\*([^*]+)\*\*/g, (_match, code, bold) => code || bold)
    .replace(/\s+/g, ' ').trim();
}

function parseNotes(markdown) {
  const notes = [];
  let section = '', fence = null;
  for (const raw of (typeof markdown === 'string' ? markdown : '').slice(0, 180_000).split(/\r?\n/)) {
    const line = raw.trim();
    const delimiter = line.match(/^(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1][0];
      else if (fence === delimiter[1][0]) fence = null;
      continue;
    }
    if (fence || !line || /^\s*<!--|^\s*!\[|^[-=_]{3,}\s*$|^\**full changelog\b/i.test(line)) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$|^\*\*([^*]+)\*\*:?$/);
    if (heading) { section = plain(heading[1] || heading[2]); continue; }
    if (installation.test(section) && !security.test(section)) continue;
    const text = plain(line.replace(/^(?:[-*+]\s+|\d+\.\s+|>\s*)/, ''));
    if (!text) continue;
    const isSecurity = security.test(section) || securityNote.test(text);
    notes.push({
      text: text.slice(0, 1200),
      security: isSecurity,
      icon: isSecurity ? '🛡️' : topics.find(([keyword]) => keyword.test(`${text} ${section}`))?.[1] || '✨'
    });
  }
  return notes;
}

function inRange(version, transition) {
  return compareVersions(version, transition.from) > 0 && compareVersions(version, transition.to) <= 0;
}

function bundledNotes(markdown, transition) {
  const headers = [...markdown.matchAll(/^##[ \t]+\[?v?(\d+\.\d+\.\d+)(?=[ \t\]\r\n]|$)[^\r\n]*$/gm)];
  return headers.flatMap((header, i) => {
    try {
      const version = parseVersion(header[1]);
      if (!inRange(version, transition)) return [];
      return [{ version, notes: parseNotes(markdown.slice(header.index + header[0].length, headers[i + 1]?.index)) }];
    } catch { return []; }
  });
}

async function githubNotes(transition, fetcher) {
  const releases = [];
  const signal = AbortSignal.timeout(7000);
  for (let page = 1; page <= 10; page++) {
    try {
      const response = await fetcher(`https://api.github.com/repos/${repository}/releases?per_page=50&page=${page}`, {
        redirect: 'error', signal,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NimboDesk' }
      });
      if (!response.ok) break;
      const rows = await response.json();
      if (!Array.isArray(rows)) break;
      for (const row of rows) {
        if (row?.draft !== false || row.prerelease !== false) continue;
        try {
          const version = parseVersion(row.tag_name);
          if (inRange(version, transition)) releases.push({ version, notes: parseNotes(row.body) });
        } catch { /* Skip version tags outside the stable format. */ }
      }
      if (!/\brel="next"/.test(response.headers.get('link') || '')) return { releases, complete: true };
    } catch { break; }
  }
  return { releases, complete: false };
}

async function collectReleaseNotes({ transition, markdown = '', fetcher = fetch }) {
  const remote = await githubNotes(transition, fetcher);
  const all = new Map([[transition.to, new Map()]]);
  for (const { version, notes } of [...bundledNotes(markdown, transition), ...remote.releases]) {
    if (!all.has(version)) all.set(version, new Map());
    const records = all.get(version);
    for (const note of notes) {
      const key = note.text.toLowerCase().replace(/[.!?]+$/, '');
      const existing = records.get(key);
      if (!existing || (note.security && !existing.security)) records.set(key, note);
    }
  }
  const releases = [...all].sort(([a], [b]) => compareVersions(b, a))
    .map(([version, records]) => ({ version, notes: [...records.values()] }));
  return { ...transition, releases, complete: remote.complete };
}

module.exports = { savePendingUpdate, pendingUpdateFor, clearPendingUpdate, collectReleaseNotes, parseNotes };
