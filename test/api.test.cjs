const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cloudflare, payload } = require('../src/api.cjs');
const demo = require('../src/demo.cjs');
const token = 'fixture_not_a_real_credential';
const zone = 'a'.repeat(32), record = 'b'.repeat(32);
const ok = (result, result_info) => Response.json({ success: true, result, result_info });

test('zones traverses every page, maps account and nameservers, and uses bearer auth', async () => {
  const calls = [];
  const api = cloudflare(token, async (url, init) => {
    const parsed = new URL(url);
    calls.push(parsed);
    assert.equal(parsed.origin, 'https://api.cloudflare.com');
    assert.equal(parsed.pathname, '/client/v4/zones');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(parsed.searchParams.get('per_page'), '50');
    assert.match(parsed.searchParams.get('type'), /internal/);
    return calls.length === 1 ? ok([{ id: zone, name: 'one.example', account: { name: 'Conta 1' } }], { page: 1, total_pages: 2 }) :
      ok([{ id: record, name: 'two.example', name_servers: ['ns.example'] }], { page: 2, total_pages: 2 });
  });
  const result = await api.zones();
  assert.deepEqual(calls.map(url => url.searchParams.get('page')), ['1','2']);
  assert.equal(result[0].account, 'Conta 1');
  assert.deepEqual(result[1].nameServers, ['ns.example']);
});

test('records uses total_count and deduplicates boundary overlaps', async () => {
  const api = cloudflare(token, async url => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, `/client/v4/zones/${zone}/dns_records`);
    return parsed.searchParams.get('page') === '1' ? ok([{ id: zone }], { per_page: 1, total_count: 2 }) :
      ok([{ id: zone }, { id: record }], { per_page: 1, total_count: 2 });
  });
  assert.deepEqual(await api.records(zone), [{ id: zone }, { id: record }]);
});

test('pagination stops with a clear error when a page repeats', async () => {
  const api = cloudflare(token, async () => ok([{ id: record }], { page: 1, total_pages: 3 }));
  await assert.rejects(api.records(zone), /paginação/);
});

test('writes use POST, PATCH and DELETE only on the exact record endpoint', async () => {
  const calls = [];
  const api = cloudflare(token, async (url, init) => {
    calls.push({ path: new URL(url).pathname, method: init.method, body: init.body });
    return ok({ id: record });
  });
  const body = payload({ type: 'A', name: '@', ttl: 1, content: '192.0.2.4', proxied: false }, 'site.example');
  await api.write(zone, null, body);
  await api.write(zone, record, body);
  await api.remove(zone, record);
  const base = `/client/v4/zones/${zone}/dns_records`;
  assert.deepEqual(calls, [
    { path: base, method: 'POST', body: JSON.stringify(body) },
    { path: `${base}/${record}`, method: 'PATCH', body: JSON.stringify(body) },
    { path: `${base}/${record}`, method: 'DELETE', body: undefined }
  ]);
});

test('rejects invalid IDs and invalid tokens before any network call', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; };
  const api = cloudflare(token, fetcher);
  assert.throws(() => cloudflare('CF\nkey', fetcher), /API Token/);
  assert.throws(() => api.records('../zones'), /Identificador/);
  await assert.rejects(api.remove(zone, '../x'), /Identificador/);
  assert.equal(calls, 0);
});

test('handles refusal, rate limit and API envelope errors without repeating mutations or revealing the token', async () => {
  for (const code of [200, 401, 403, 429]) {
    let calls = 0;
    const api = cloudflare(token, async () => {
      calls++;
      return Response.json({ success: false, errors: [{ code: 1000, message: `API error with ${token}` }] }, { status: code });
    });
    await assert.rejects(api.remove(zone, record), e =>
      e.message.includes(`HTTP ${code}`) && e.message.includes('[token oculto]') && !e.message.includes(token));
    assert.equal(calls, 1);
  }
});

test('network failures and invalid successful responses warn before a second write', async () => {
  for (const fetcher of [async () => { throw new Error(token); }, async () => new Response('not JSON')]) {
    await assert.rejects(cloudflare(token, fetcher).remove(zone, record), /Atualize os registros/);
  }
});

test('normalizes apex, relative labels, numeric labels, IDNs and absolute names', () => {
  const input = { type: 'TXT', content: 'hello world', ttl: 300 };
  const cases = [
    ['@', 'site.example'], ['123', '123.site.example'], ['_dmarc', '_dmarc.site.example'],
    ['*.Site.Example.', '*.site.example'], ['ação', 'xn--ao-siap.site.example']
  ];
  for (const [name, expected] of cases) {
    assert.equal(payload({ ...input, name }, 'site.example').name, expected);
  }
  assert.throws(() => payload({ ...input, name: 'outside.example.' }, 'site.example'), /pertencer/);
});

test('validates TTL, IP family, structured data and MX priorities', () => {
  const base = { name: '@', ttl: 300 };
  const make = input => payload({ ...base, ...input }, 'site.example');
  assert.equal(make({ type: 'AAAA', content: '2001:db8::1', proxied: true }).ttl, 1);
  assert.equal(make({ type: 'TXT', content: '"first" "second"' }).content, '"first" "second"');
  assert.equal(make({ type: 'TXT', content: 'v=spf1 -all' }).content, '"v=spf1 -all"');
  assert.equal(make({ type: 'MX', content: 'mx.example', priority: 0 }).priority, 0);
  const data = { port: 443, weight: 1, priority: 2, target: 'srv.example' };
  assert.deepEqual(make({ type: 'SRV', data }).data, data);
  assert.throws(() => make({ type: 'SRV', data: [] }), /JSON/);
  assert.throws(() => make({ type: 'A', content: '::1' }), /IPv4/);
  assert.throws(() => make({ type: 'MX', content: 'mx.example', priority: -1 }), /prioridade/);
  assert.throws(() => make({ type: 'TXT', content: 'test', ttl: 2 }), /TTL/);
});

test('demo CRUD isolates zones and resets across demo sessions', async () => {
  const api = demo(), [first, second] = await api.zones();
  const body = { type: 'TXT', name: first.name, content: '"test"', ttl: 1 };
  const row = await api.write(first.id, null, body);
  await api.write(first.id, row.id, { ...body, content: '"updated"' });
  assert.equal((await api.records(first.id)).find(x => x.id === row.id).content, '"updated"');
  assert.ok(!(await api.records(second.id)).some(x => x.id === row.id));
  await api.remove(first.id, row.id);
  assert.equal((await api.records(first.id)).length, (await demo().records(first.id)).length);
});
