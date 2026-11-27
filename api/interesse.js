export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { nome, email, telefone, graduacao, area } = req.body || {};
  if (![nome, email, telefone].every(value => typeof value === 'string' && value.trim() && value.length <= 254)
      || !['sim', 'nao'].includes(graduacao)
      || (graduacao === 'sim' && (typeof area !== 'string' || !area.trim() || area.length > 150))
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      || !/^\d{10,11}$/.test(telefone.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Confira os dados informados.' });
  }
  const key = process.env.API_KEY_ACTIVE || process.env.ACTIVE_API_KEY;
  if (!key) return res.status(503).json({ error: 'Cadastro temporariamente indisponível.' });
  const base = process.env.API_URL_ACTIVE || 'https://ambientalpro.api-us1.com';
  async function post(path, payload) {
    const response = await fetch(base + '/api/3/' + path, {
      method: 'POST', headers: { 'Api-Token': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Falha no cadastro');
    return response.json();
  }
  try {
    async function list(collection, query = '') {
      const items = [];
      for (let offset = 0; ; offset += 100) {
        const response = await fetch(base + '/api/3/' + collection + '?limit=100&offset=' + offset + query, {
          headers: { 'Api-Token': key }
        });
        if (!response.ok) throw new Error('Falha na configuração');
        const data = await response.json();
        const page = data[collection];
        if (!Array.isArray(page)) throw new Error('Resposta inválida');
        items.push(...page);
        if (items.length >= Number(data.meta?.total) || page.length < 100) return items;
      }
    }
    const tagName = '[C2][CBAC] Leads Trackeamento';
    const [fields, tags] = await Promise.all([
      list('fields'), list('tags', '&search=' + encodeURIComponent(tagName))
    ]);
    const matchedTags = tags.filter(item => item.tag === tagName);
    if (matchedTags.length !== 1) throw new Error('Tag não encontrada ou ambígua');
    const tag = matchedTags[0].id;
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const values = {
      'UTM Data de Inscrição': date,
      'UTM Possui Graduação': graduacao === 'sim' ? 'Sim' : 'Não',
      'UTM Área de Formação': graduacao === 'sim' ? area.trim() : ''
    };
    for (const suffix of ['Term', 'Campaign', 'Source', 'Medium', 'Content']) {
      const value = req.body['utm_' + suffix.toLowerCase()];
      if (typeof value === 'string' && value.trim()) values['UTM ' + suffix] = value.trim().slice(0, 254);
    }
    // Resolve all eight fields before writing a contact, including absent UTMs.
    const fieldIds = {};
    for (const suffix of ['UTM Term', 'UTM Data de Inscrição', 'UTM Possui Graduação', 'UTM Área de Formação', 'UTM Campaign', 'UTM Source', 'UTM Medium', 'UTM Content']) {
      const matches = fields.filter(field => field.title === '[C2][CBAC] ' + suffix);
      if (matches.length !== 1) throw new Error('Campo não encontrado ou ambíguo');
      fieldIds[suffix] = matches[0].id;
    }
    const [firstName, ...rest] = nome.trim().split(/\s+/);
    const { contact } = await post('contact/sync', { contact: {
      firstName, lastName: rest.join(' '), email: email.trim(), phone: telefone.trim(),
      fieldValues: Object.entries(values).map(([name, value]) => ({ field: fieldIds[name], value }))
    } });
    await post('contactTags', { contactTag: { contact: contact.id, tag } });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(502).json({ error: 'Não foi possível concluir o cadastro.' });
  }
}
