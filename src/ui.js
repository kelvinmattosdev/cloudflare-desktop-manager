'use strict';
const $ = id => document.getElementById(id);
const types = 'A AAAA CNAME MX TXT NS CAA SRV HTTPS SVCB PTR CERT DNSKEY DS LOC NAPTR OPENPGPKEY SMIMEA SSHFP TLSA URI'.split(' ');
const advanced = new Set('CERT DNSKEY DS HTTPS LOC NAPTR SMIMEA SSHFP SVCB TLSA URI'.split(' '));
const proxied = new Set(['A', 'AAAA', 'CNAME']);
const labels = { A: 'Endereço IPv4', AAAA: 'Endereço IPv6', CNAME: 'Destino', MX: 'Servidor de e-mail', NS: 'Servidor de nomes', PTR: 'Destino' };
const examples = { A: '192.0.2.10', AAAA: '2001:db8::10', TXT: 'v=spf1 -all', CNAME: 'destino.example', MX: 'mail.example', NS: 'ns1.example', PTR: 'host.example' };
const statusLabels = { active: 'Zona ativa', pending: 'Zona pendente', initializing: 'Inicializando', moved: 'Zona movida' };
const editor = $('editor'), deletion = $('deletion');
let mode, zones = [], zone, records = [], state, page = 0, revision = 0, edit, deleting, sending = false;
const pageSize = 25;

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const use = document.createElementNS(ns, 'use');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}
function say(id, text = '', error = false) {
  const el = $(id);
  el.textContent = text;
  el.hidden = !text;
  if (id === 'notice') el.classList.toggle('error', error);
}
async function call(name, ...args) {
  const result = await window.dns[name](...args);
  if (result.error) throw new Error(result.error);
  return result.value;
}
async function settings() {
  const value = await call('settings');
  $('remember-field').hidden = !value.canStore;
  $('storage-note').hidden = value.canStore;
  $('remembered').hidden = !value.remembered;
  if (!value.canStore) $('remember').checked = false;
}
function show(nextMode) {
  mode = nextMode;
  $('login').hidden = Boolean(mode);
  $('workspace').hidden = !mode;
  $('disconnect').hidden = !mode;
  $('zone-controls').hidden = !mode;
  $('zone-count').hidden = !mode;
  $('demo-banner').hidden = mode !== 'demo';
  $('status').className = `connection ${mode || ''}`;
  $('status').replaceChildren(node('i'), mode === 'live' ? 'Cloudflare conectada' : mode === 'demo' ? 'Demonstração' : 'Sem conexão');
}

async function login(method, ...args) {
  $('login-fields').disabled = true;
  say('login-error');
  try {
    zones = await call(method, ...args);
    $('token').value = '';
    $('remember').checked = false;
    $('zone-filter').value = '';
    show(method === 'demo' ? 'demo' : 'live');
    $('disconnect').focus();
    await selectZone(zones[0]);
  } catch (error) { say('login-error', error.message); }
  finally { $('login-fields').disabled = false; }
}
$('login-form').addEventListener('submit', e => {
  e.preventDefault();
  void login('connect', $('token').value, $('remember').checked);
});
$('try-demo').onclick = () => login('demo');
$('resume').onclick = () => login('resume');
$('token-link').onclick = async () => {
  try { await call('help'); } catch (error) { say('login-error', error.message); }
};
$('forget').onclick = async () => {
  try { await call('forget'); await settings(); say('login-error'); $('token').focus(); }
  catch (error) { say('login-error', error.message); }
};
$('disconnect').onclick = async () => {
  $('disconnect').disabled = true;
  try {
    await call('disconnect');
    revision++;
    zones = []; zone = undefined; records = [];
    show(null); renderZones(); await settings(); $('token').focus();
  } catch (error) { say(mode ? 'notice' : 'login-error', error.message, true); }
  finally { $('disconnect').disabled = false; }
};

function renderZones() {
  const container = $('zones');
  $('zone-count').textContent = zones.length;
  if (!mode) {
    container.replaceChildren(node('p', 'side-note', 'Conecte sua conta para listar os domínios disponíveis.'));
    return;
  }
  const term = $('zone-filter').value.trim().toLowerCase();
  const visible = zones.filter(z => `${z.name} ${z.account || ''}`.toLowerCase().includes(term));
  if (!visible.length) {
    container.replaceChildren(node('p', 'side-note', term ? 'Nenhum domínio encontrado.' : 'Nenhum domínio liberado no token.'));
    return;
  }
  const active = document.activeElement?.dataset.zone;
  const buttons = visible.map(z => {
    const button = node('button', 'zone-item');
    const label = node('span', 'zone-label');
    button.dataset.zone = z.id;
    label.append(node('span', '', z.name));
    if (z.account) label.append(node('small', '', z.account));
    button.append(icon('globe'), label);
    button.title = [z.name, z.account].filter(Boolean).join(' · ');
    button.setAttribute('aria-current', String(z.id === zone?.id));
    button.onclick = () => { if (z.id !== zone?.id) void selectZone(z); };
    return button;
  });
  container.replaceChildren(...buttons);
  buttons.find(button => button.dataset.zone === active)?.focus();
}
function renderZoneHeader() {
  $('crumb-zone').textContent = zone?.name || 'Domínios';
  $('zone-title').textContent = zone ? [zone.name, zone.account].filter(Boolean).join(' · ') :
    'Nenhum domínio disponível. Confira os recursos e as permissões do token.';
  const badge = $('zone-status');
  badge.hidden = !statusLabels[zone?.status];
  badge.textContent = statusLabels[zone?.status] || '';
  badge.classList.toggle('active', zone?.status === 'active');
  $('nameservers').hidden = !zone?.nameServers?.length;
  $('ns-list').replaceChildren(...(zone?.nameServers || []).map(ns => node('span', 'nameserver', ns)));
}
async function selectZone(selected) {
  zone = selected;
  $('record-filter').value = '';
  $('type-filter').value = '';
  page = 0;
  say('notice');
  renderZones();
  renderZoneHeader();
  await loadRecords();
}
$('zone-filter').oninput = renderZones;
$('refresh-zones').onclick = async () => {
  $('refresh-zones').disabled = true;
  const original = mode;
  say('notice');
  try {
    const result = await call('zones');
    if (mode !== original || !mode) return;
    zones = result;
    await selectZone(zones.find(z => z.id === zone?.id) || zones[0]);
  } catch (error) { if (mode === original) say('notice', error.message, true); }
  finally { $('refresh-zones').disabled = false; }
};
async function loadRecords(keepPage = false) {
  const current = ++revision;
  records = [];
  if (!keepPage) page = 0;
  state = zone ? 'loading' : 'idle';
  renderRecords();
  if (!zone) return;
  try {
    const result = await call('records', zone.id);
    if (current !== revision) return;
    records = result;
    state = 'ready';
  } catch (error) {
    if (current !== revision) return;
    state = 'error';
    say('notice', error.message, true);
  }
  const selected = $('type-filter').value;
  $('type-filter').replaceChildren(new Option('Todos os tipos', ''),
    ...[...new Set(records.map(r => r.type))].sort().map(type => new Option(type, type)));
  if ([...$('type-filter').options].some(option => option.value === selected)) $('type-filter').value = selected;
  renderRecords();
}

function recordContent(record) {
  const text = record.content || (record.data ? Object.values(record.data).join(' ') : '—');
  return record.type === 'MX' && record.priority != null ? `${record.priority} ${text}` : text;
}
function rowFor(record) {
  const row = node('tr');
  const type = node('td');
  type.append(node('span', 'type-pill', record.type));
  const short = record.name === zone.name ? '@' : record.name.endsWith(`.${zone.name}`) ?
    record.name.slice(0, -zone.name.length - 1) : record.name;
  const name = node('td', '', short);
  name.title = record.name;
  const content = node('td', 'mono', recordContent(record));
  content.title = recordContent(record);
  const proxy = node('td');
  const proxyLabel = node('span', `proxy${record.proxied ? ' on' : ''}`);
  if (record.proxied || record.proxiable) {
    proxyLabel.append(icon('cloud'), record.proxied ? 'Com proxy' : 'Só DNS');
  } else proxyLabel.textContent = '—';
  proxy.append(proxyLabel);
  const ttl = node('td', '', record.ttl === 1 ? 'Auto' : `${record.ttl} s`);
  const actions = node('td', 'right');
  if (record.locked) {
    const lock = node('span', 'locked', 'Bloqueado');
    lock.title = 'A Cloudflare não permite alterar este registro.';
    actions.append(lock);
  } else {
    if (types.includes(record.type)) {
      const change = node('button', 'row-action', 'Editar');
      change.setAttribute('aria-label', `Editar ${record.type} ${record.name}`);
      change.onclick = () => openEditor(record);
      actions.append(change);
    }
    const remove = node('button', 'row-action del', 'Excluir');
    remove.setAttribute('aria-label', `Excluir ${record.type} ${record.name}`);
    remove.onclick = () => openDelete(record);
    actions.append(remove);
  }
  row.append(type, name, content, proxy, ttl, actions);
  return row;
}
function renderRecords() {
  const ready = state === 'ready';
  $('add').disabled = !ready;
  $('refresh').disabled = !zone || state === 'loading';
  $('record-filter').disabled = !ready;
  $('type-filter').disabled = !ready;
  const term = $('record-filter').value.trim().toLowerCase();
  const type = $('type-filter').value;
  const filtered = records.filter(r => (!type || r.type === type) &&
    (r.name === zone?.name && term === '@' || `${r.name} ${recordContent(r)} ${r.comment || ''}`.toLowerCase().includes(term)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (ready) page = Math.min(page, pages - 1);
  $('pagination').hidden = pages === 1;
  $('previous').disabled = page === 0;
  $('next').disabled = page >= pages - 1;
  const from = page * pageSize;
  const until = Math.min(from + pageSize, filtered.length);
  $('record-count').textContent = ready ? `${filtered.length ? `${from + 1}–${until} de ` : ''}${filtered.length} ${filtered.length === 1 ? 'registro' : 'registros'}${filtered.length !== records.length ? ` (${records.length} no domínio)` : ''}` : '';
  if (ready && filtered.length) {
    $('records').replaceChildren(...filtered.slice(from, until).map(rowFor));
  } else {
    const row = node('tr');
    const td = node('td', 'empty', { loading: 'Carregando registros…', error: 'Não foi possível carregar os registros. Tente atualizar.',
      idle: 'Selecione um domínio.', ready: records.length ? 'Nenhum registro corresponde aos filtros.' : 'Nenhum registro neste domínio.' }[state]);
    td.colSpan = 6;
    row.append(td);
    $('records').replaceChildren(row);
  }
}
$('refresh').onclick = () => { say('notice'); return loadRecords(true); };
for (const id of ['record-filter', 'type-filter']) $(id).oninput = () => { page = 0; renderRecords(); };
$('previous').onclick = () => { page--; renderRecords(); };
$('next').onclick = () => { page++; renderRecords(); };

const knownData = {
  CAA: [['flags', 'Flags', 0, 255], ['tag', 'Tag', 'issue'], ['value', 'Valor', '']],
  SRV: [['priority', 'Prioridade', 0, 65535], ['weight', 'Peso', 0, 65535], ['port', 'Porta', 443, 65535], ['target', 'Destino', '']]
};
const dataExamples = {
  CERT: { type: 1, key_tag: 0, algorithm: 8, certificate: '' },
  DNSKEY: { flags: 257, protocol: 3, algorithm: 13, public_key: '' },
  DS: { key_tag: 0, algorithm: 13, digest_type: 2, digest: '' },
  HTTPS: { priority: 1, target: '.', value: 'alpn="h2"' },
  LOC: { lat_degrees: 0, lat_minutes: 0, lat_seconds: 0, lat_direction: 'N', long_degrees: 0, long_minutes: 0, long_seconds: 0, long_direction: 'E', altitude: 0, size: 1, precision_horz: 10000, precision_vert: 10 },
  NAPTR: { order: 100, preference: 10, flags: 'S', service: 'SIP+D2U', regexp: '', replacement: '_sip._udp.example' },
  SMIMEA: { usage: 3, selector: 1, matching_type: 1, certificate: '' },
  SSHFP: { algorithm: 4, type: 2, fingerprint: '' },
  SVCB: { priority: 1, target: '.', value: 'alpn="h2"' },
  TLSA: { usage: 3, selector: 1, matching_type: 1, certificate: '' },
  URI: { weight: 1, target: 'https://example.net' }
};
function configureEditor(original) {
  const type = $('record-type').value;
  const structured = knownData[type];
  const structuredVisible = structured && (!original || original.data);
  $('structured').hidden = !structuredVisible;
  $('structured').replaceChildren();
  if (structuredVisible) for (const [key, label, initial, max] of structured) {
    const field = node('label', 'field', label);
    const input = node('input');
    input.dataset.data = key;
    if (typeof initial === 'number') {
      input.type = 'number'; input.min = 0; input.max = max;
    } else input.spellcheck = false;
    input.required = true;
    input.value = original?.data?.[key] ?? initial;
    field.append(input);
    $('structured').append(field);
  }
  const json = advanced.has(type) && (!original || original.data);
  $('content-field').hidden = Boolean(structuredVisible);
  $('content').disabled = Boolean(structuredVisible);
  $('content').required = !structuredVisible;
  $('content').dataset.json = String(json);
  $('content').rows = json ? 5 : 2;
  $('content-label').textContent = json ? 'Campos do registro (JSON)' : labels[type] || 'Conteúdo';
  $('content').placeholder = json ? 'Objeto JSON' : examples[type] || '';
  $('content').value = json ? JSON.stringify(original?.data || dataExamples[type], null, 2) : original?.content ?? '';
  $('content-hint').hidden = !json;
  $('content-hint').textContent = json ? 'Ajuste os valores dos campos para o seu registro.' : '';
  $('priority-field').hidden = !['MX', 'URI'].includes(type);
  $('priority').required = !$('priority-field').hidden;
  $('priority').value = original?.priority ?? 10;
  $('proxy-field').hidden = !proxied.has(type) || original?.proxiable === false;
  $('proxy').checked = !$('proxy-field').hidden && original?.proxied === true;
  configureTTL();
}
function configureTTL() {
  const active = $('proxy').checked && !$('proxy-field').hidden;
  $('ttl').disabled = active;
  $('custom-ttl-field').hidden = active || $('ttl').value !== 'custom';
  $('custom-ttl').required = !$('custom-ttl-field').hidden;
}
function openEditor(original) {
  edit = { zone, original };
  $('editor-form').reset();
  $('editor-title').textContent = original ? 'Editar registro DNS' : 'Adicionar registro DNS';
  $('editor-zone').textContent = zone.name;
  $('record-type').value = original?.type || 'A';
  $('record-type').disabled = Boolean(original);
  $('record-name').value = original?.name || '';
  $('record-name').placeholder = `@ ou www.${zone.name}`;
  $('comment').value = original?.comment || '';
  const ttl = String(original?.ttl || 1);
  $('ttl').value = [...$('ttl').options].some(opt => opt.value === ttl) ? ttl : 'custom';
  $('custom-ttl').value = ttl === '1' ? 300 : ttl;
  configureEditor(original);
  say('editor-error');
  editor.showModal();
  $('record-name').focus();
}
$('record-type').append(...types.map(type => new Option(type, type)));
$('record-type').onchange = () => configureEditor(null);
$('ttl').onchange = $('proxy').onchange = configureTTL;
$('add').onclick = () => openEditor(null);

function openDelete(record) {
  deleting = { zone, record };
  $('delete-zone').textContent = zone.name;
  $('delete-record').replaceChildren(node('strong', '', `${record.type} · ${record.name}`),
    node('span', 'mono', recordContent(record)));
  say('delete-error');
  deletion.showModal();
}
for (const dialog of [editor, deletion]) {
  dialog.querySelectorAll('.close, .cancel').forEach(button => {
    button.onclick = () => { if (!sending) dialog.close(); };
  });
  dialog.addEventListener('cancel', event => { if (sending) event.preventDefault(); });
}
async function mutation(dialog, errorId, success, action) {
  if (sending) return;
  sending = true;
  const buttons = [...dialog.querySelectorAll('button')];
  buttons.forEach(button => button.disabled = true);
  if (dialog === editor) $('editor-fields').disabled = true;
  say(errorId);
  try {
    await action();
    dialog.close();
    say('notice', success);
    await loadRecords(true);
    $('add').focus();
  } catch (error) { say(errorId, error.message); }
  finally {
    sending = false;
    buttons.forEach(button => button.disabled = false);
    if (dialog === editor) $('editor-fields').disabled = false;
  }
}
$('editor-form').onsubmit = e => {
  e.preventDefault();
  const { original, zone: selected } = edit;
  return mutation(editor, 'editor-error', original ? 'Registro atualizado.' : 'Registro adicionado.', () => {
    const proxy = !$('proxy-field').hidden ? $('proxy').checked : undefined;
    const input = {
      type: $('record-type').value, name: $('record-name').value,
      comment: $('comment').value, proxied: proxy,
      ttl: proxy ? 1 : Number($('ttl').value === 'custom' ? $('custom-ttl').value : $('ttl').value)
    };
    if (!$('priority-field').hidden) input.priority = Number($('priority').value);
    if (!$('structured').hidden) input.data = Object.fromEntries([...$('structured').querySelectorAll('input')].map(el =>
      [el.dataset.data, el.type === 'number' ? Number(el.value) : el.value]));
    else if ($('content').dataset.json === 'true') {
      try { input.data = JSON.parse($('content').value); }
      catch { throw new Error('O JSON está inválido. Confira os campos, aspas e vírgulas.'); }
    } else input.content = $('content').value;
    return call('write', selected.id, original?.id ?? null, input);
  });
};
$('delete-form').onsubmit = e => {
  e.preventDefault();
  return mutation(deletion, 'delete-error', 'Registro excluído.', () => call('remove', deleting.zone.id, deleting.record.id));
};
settings().catch(error => say('login-error', error.message));

const settingsDialog = $('settings-dialog'), settingsButton = $('open-settings'), themePicker = $('theme');
let themeSource;
settingsButton.onclick = () => {
  if (!settingsDialog.open) {
    settingsDialog.showModal();
    if (!themePicker.disabled) themePicker.focus();
  }
};
$('close-settings').onclick = () => settingsDialog.close();
settingsDialog.addEventListener('close', () => settingsButton.focus());

call('themeStatus').then(value => {
  themeSource = themePicker.value = value;
  themePicker.disabled = false;
}).catch(error => say('theme-notice', error.message));

themePicker.onchange = async () => {
  const next = themePicker.value;
  try {
    themeSource = await call('setTheme', next);
    say('theme-notice');
  } catch (error) {
    if (themePicker.value === next) themePicker.value = themeSource;
    say('theme-notice', error.message);
  }
};

let updateSeq = -1, updateTarget, manualUpdate;
function renderUpdate(info) {
  if (info.seq < updateSeq) return;
  updateSeq = info.seq;
  const available = info.status === 'available';
  manualUpdate = info.status === 'manual';
  const working = ['downloading', 'installing', 'restarting'].includes(info.status);
  const label = $('update-label');
  const latest = info.latest ? `v${info.latest}` : '';
  const current = `v${info.current}`;
  const texts = {
    idle: current,
    disabled: current,
    checking: 'Checando versões…',
    unpublished: 'Sem release publicada',
    error: 'Falha na checagem',
    current: `Atualizado ${current}`,
    available: '',
    manual: current,
    'no-package': `Pacote ${latest} indisponível`,
    downloading: `Baixando ${latest} · ${info.percent}%`,
    installing: info.admin ? 'Instalando · confirme no sistema' : `Instalando ${latest}…`,
    restarting: `Reabrindo na ${latest}…`,
    installed: `Instalado ${latest}`
  };
  label.textContent = texts[info.status] || current;
  label.toggleAttribute('data-current', info.status === 'current');
  label.title = info.status === 'disabled' ? 'Checagem disponível em uma versão empacotada do NimboDesk.' :
    info.status === 'current' && info.current !== info.latest ? `Versão publicada: ${latest}. A sua é mais recente.` :
      `Versão em uso: ${current}`;
  $('check-update').disabled = working || ['checking', 'disabled', 'installed'].includes(info.status);
  $('install-update').hidden = !available && !manualUpdate;
  $('install-update').textContent = manualUpdate ? `Baixar ${latest}` : `Atualizar para ${latest}`;
  $('install-update').title = manualUpdate ? 'Abrir a página de releases no GitHub.' :
    info.admin ? 'A instalação do .deb pede autorização de administrador.' :
      'Baixar a nova versão e reabrir o aplicativo.';
  updateTarget = available ? info.latest : undefined;
  document.querySelector('.shell').inert = working;
  $('disconnect').inert = working;
  settingsButton.inert = working;
  say('update-notice', info.message || '');
}
window.dns.onUpdate(renderUpdate);
call('updateStatus').then(renderUpdate).catch(error => say('update-notice', error.message));
$('check-update').onclick = () => call('checkUpdate').then(renderUpdate).catch(error => say('update-notice', error.message));
$('install-update').onclick = () => (manualUpdate ? call('openRelease') : call('installUpdate', updateTarget).then(renderUpdate))
  .catch(error => say('update-notice', error.message));

const notesDialog = $('whats-new');
function showUpdateNotes(history) {
  if (!history || notesDialog.open) return;
  const activeDialog = document.querySelector('dialog[open]');
  if (activeDialog) {
    activeDialog.addEventListener('close', () => showUpdateNotes(history), { once: true });
    return;
  }
  $('release-range').textContent = `Da v${history.from} para a v${history.to}`;
  $('release-offline').hidden = history.complete;
  $('release-history').replaceChildren(...history.releases.map(version => {
    const section = node('section', 'release-version');
    section.append(node('h3', '', `v${version.version}`));
    if (!version.notes.length) {
      section.append(node('p', 'hint', 'Não há notas disponíveis para esta versão.'));
      return section;
    }
    const list = node('ul', 'release-items');
    list.setAttribute('role', 'list');
    for (const note of version.notes) {
      const item = node('li', 'release-item');
      const symbol = node('span', '', note.icon);
      symbol.setAttribute('aria-hidden', 'true');
      const text = node('span');
      if (note.security) text.append(node('span', 'release-label', 'Segurança'), ' ');
      text.append(note.text);
      item.append(symbol, text);
      list.append(item);
    }
    section.append(list);
    return section;
  }));
  notesDialog.showModal();
}
$('close-whats-new').onclick = () => notesDialog.close();
notesDialog.addEventListener('close', () => {
  void call('dismissUpdateNotes').catch(() => {});
});
call('updateNotes').then(showUpdateNotes).catch(() => {});
