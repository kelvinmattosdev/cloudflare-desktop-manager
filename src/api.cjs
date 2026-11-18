const { isIP } = require('node:net');
const { domainToASCII } = require('node:url');

const origin = 'https://api.cloudflare.com/client/v4';
const proxyTypes = new Set(['A', 'AAAA', 'CNAME']);
const basicTypes = new Set(['A', 'AAAA', 'CNAME', 'MX', 'NS', 'OPENPGPKEY', 'PTR', 'TXT']);
const dataTypes = new Set([
  'CAA', 'CERT', 'DNSKEY', 'DS', 'HTTPS', 'LOC', 'NAPTR', 'SMIMEA',
  'SRV', 'SSHFP', 'SVCB', 'TLSA', 'URI'
]);

function id(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/i.test(value)) {
    throw new Error('Identificador da Cloudflare inválido.');
  }
  return value;
}

function tokenValue(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{20,300}$/.test(token)) throw new Error('Informe um API Token válido da Cloudflare.');
  return token;
}

function fqdn(value, zone) {
  if (typeof value !== 'string') throw new Error('Informe o nome do registro.');
  const input = value.trim().toLowerCase();
  if (input === '@') return zone;
  if (!input || /[\s/#?@:%\\[\]]/.test(input)) throw new Error('Nome DNS inválido.');
  const absolute = input.endsWith('.');
  const converted = domainToASCII(`${input.replace(/\.$/, '')}.invalid`);
  const ascii = converted.endsWith('.invalid') ? converted.slice(0, -8) : '';
  if (!ascii) throw new Error('Nome DNS inválido.');
  const inside = ascii === zone || ascii.endsWith(`.${zone}`);
  if (absolute && !inside) throw new Error('O nome completo deve pertencer ao domínio selecionado.');
  const result = inside ? ascii : `${ascii}.${zone}`;
  if (result.length > 253 || !result.split('.').every((part, i) =>
    (i === 0 && part === '*') || /^[a-z0-9_-]{1,63}$/.test(part))) {
    throw new Error('Nome DNS inválido.');
  }
  return result;
}

function payload(input, zone) {
  if (!input || (!basicTypes.has(input.type) && !dataTypes.has(input.type))) {
    throw new Error('Tipo de registro não suportado para gravação.');
  }
  const { type, ttl } = input;
  const out = { type, name: fqdn(input.name, zone) };
  if (!Number.isInteger(ttl) || (ttl !== 1 && (ttl < 30 || ttl > 86400))) {
    throw new Error('Use TTL automático ou entre 30 e 86400 segundos (mínimo conforme o plano).');
  }
  if (proxyTypes.has(type) && input.proxied !== undefined) {
    out.proxied = input.proxied === true;
  }
  out.ttl = out.proxied ? 1 : ttl;
  if (typeof input.comment === 'string') {
    if (input.comment.length > 100) throw new Error('O comentário pode ter até 100 caracteres.');
    out.comment = input.comment;
  }
  if (type === 'MX' || type === 'URI') {
    if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 65535) {
      throw new Error('Informe uma prioridade entre 0 e 65535.');
    }
    out.priority = input.priority;
  }
  if (dataTypes.has(type) && input.data != null) {
    if (typeof input.data !== 'object' || Array.isArray(input.data) || !Object.keys(input.data).length ||
        !Object.values(input.data).every(v => typeof v === 'string' || Number.isFinite(v))) {
      throw new Error('Informe os campos do registro como um objeto JSON com valores de texto ou números.');
    }
    out.data = input.data;
  } else {
    const text = typeof input.content === 'string' ? input.content.trim() : '';
    if (!text) throw new Error('Informe o conteúdo do registro.');
    if ((type === 'A' && isIP(text) !== 4) || (type === 'AAAA' && isIP(text) !== 6)) {
      throw new Error(`Informe um endereço ${type === 'A' ? 'IPv4' : 'IPv6'} válido.`);
    }
    out.content = type === 'TXT' && !text.startsWith('"') ? JSON.stringify(text) : text;
  }
  return out;
}

function cloudflare(token, fetcher = fetch) {
  const authorization = `Bearer ${tokenValue(token)}`;
  async function request(path, method = 'GET', body) {
    let response, data;
    try {
      response = await fetcher(`${origin}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: authorization, Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      data = await response.json().catch(() => null);
    } catch {
      const message = method === 'GET' ? 'Não foi possível consultar a Cloudflare.' :
        'A Cloudflare não confirmou a alteração. Atualize os registros antes de tentar novamente.';
      throw new Error(message);
    }
    if (!response.ok || data?.success !== true) {
      const advice = {
        401: 'Confira se o token está ativo e foi copiado por inteiro.',
        403: 'Confira Zona → Zona (Leitura), Zona → DNS (Edição) e os domínios liberados no token.',
        429: 'Limite de consultas atingido. Aguarde um pouco antes de tentar novamente.'
      }[response.status] || (method !== 'GET' && (response.ok || response.status >= 500) ?
        'A alteração não foi confirmada. Atualize os registros antes de tentar novamente.' : '');
      const details = (Array.isArray(data?.errors) ? data.errors : []).slice(0, 3)
        .map(e => `${e?.code ?? ''} ${e?.message ?? ''}`.trim()).filter(Boolean).join(' · ')
        .split(authorization.slice(7)).join('[token oculto]').slice(0, 600);
      throw new Error([`Cloudflare (HTTP ${response.status}).`, advice, details].filter(Boolean).join(' '));
    }
    return data;
  }

  async function list(path, size, query = {}) {
    const results = new Map();
    for (let page = 1; ; page++) {
      const params = new URLSearchParams({ ...query, page, per_page: size });
      const { result, result_info: info } = await request(`${path}?${params}`);
      if (!Array.isArray(result) || result.some(row => !row?.id)) throw new Error('Listagem inválida da Cloudflare.');
      const count = results.size;
      for (const item of result) results.set(item.id, item);
      const more = Number.isInteger(info?.total_pages) ? page < info.total_pages :
        Number.isInteger(info?.total_count) ? page * (info.per_page || size) < info.total_count :
          result.length >= size;
      if (!more) return [...results.values()];
      if (count === results.size || (info?.page != null && info.page !== page)) {
        throw new Error('A paginação da Cloudflare não avançou. Tente atualizar.');
      }
    }
  }

  const records = zone => `/zones/${id(zone)}/dns_records`;
  return {
    async zones() {
      const zones = await list('/zones', 50, { order: 'name', direction: 'asc', type: 'full,partial,secondary,internal' });
      return zones.map(z => ({ id: z.id, name: z.name, account: z.account?.name, status: z.status, nameServers: z.name_servers || [] }));
    },
    records: zone => list(records(zone), 100),
    async write(zone, record, body) {
      return (await request(record ? `${records(zone)}/${id(record)}` : records(zone), record ? 'PATCH' : 'POST', body)).result;
    },
    async remove(zone, record) {
      return (await request(`${records(zone)}/${id(record)}`, 'DELETE')).result;
    }
  };
}

module.exports = { cloudflare, payload, id, tokenValue };
