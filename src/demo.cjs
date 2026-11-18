const { randomUUID } = require('node:crypto');

module.exports = function demo() {
  const zones = ['loja.example', 'estudio.example', 'dev.example'].map((name, i) => ({
    id: String(i + 1).repeat(32), name, account: 'Conta de demonstração', status: 'active',
    nameServers: ['ns1.example.net', 'ns2.example.net']
  }));
  const records = new Map(zones.map(zone => [zone.id, [
    { type: 'A', name: zone.name, content: '192.0.2.24', proxied: true, ttl: 1 },
    { type: 'AAAA', name: zone.name, content: '2001:db8::24', proxied: true, ttl: 1 },
    { type: 'CNAME', name: `www.${zone.name}`, content: zone.name, proxied: true, ttl: 1 },
    { type: 'CNAME', name: `blog.${zone.name}`, content: 'sites.example.net', proxied: false, ttl: 3600 },
    { type: 'MX', name: zone.name, content: 'mail.example.net', priority: 10, ttl: 1 },
    { type: 'TXT', name: zone.name, content: '"v=spf1 -all"', ttl: 1 },
    { type: 'TXT', name: `_dmarc.${zone.name}`, content: '"v=DMARC1; p=reject"', ttl: 3600 },
    { type: 'CAA', name: zone.name, content: '0 issue "letsencrypt.org"', ttl: 1,
      data: { flags: 0, tag: 'issue', value: 'letsencrypt.org' } }
  ].map(row => ({ proxied: false, proxiable: ['A','AAAA','CNAME'].includes(row.type), ...row,
    id: randomUUID().replaceAll('-', '') }))]));

  return {
    zones: async () => zones,
    records: async zone => records.get(zone),
    async write(zone, record, body) {
      const rows = records.get(zone);
      const index = rows.findIndex(row => row.id === record);
      if (record && index === -1) throw new Error('Registro de demonstração não encontrado.');
      const row = { ...rows[index], ...body, id: record || randomUUID().replaceAll('-', ''),
        proxiable: ['A','AAAA','CNAME'].includes(body.type), proxied: body.proxied ?? rows[index]?.proxied ?? false };
      if (body.data) row.content = Object.values(body.data).join(' ');
      if (index === -1) rows.push(row);
      else rows[index] = row;
      return row;
    },
    async remove(zone, record) {
      const rows = records.get(zone);
      const index = rows.findIndex(row => row.id === record);
      if (index === -1) throw new Error('Registro de demonstração não encontrado.');
      rows.splice(index, 1);
      return { id: record };
    }
  };
};
