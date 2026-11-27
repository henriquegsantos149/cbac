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
  const makeWebhook = process.env.CBAC_MAKE_WEBHOOK_URL || process.env.MAKE_WEBHOOK_URL;
  if (makeWebhook) {
    try {
      const url = new URL(makeWebhook);
      if (url.protocol !== 'https:') throw new Error('Webhook inválido');
      const payload = {
        nome: nome.trim(), email: email.trim(), telefone: telefone.replace(/\D/g, ''),
        graduacao, area: graduacao === 'sim' ? area.trim() : '',
        data_inscricao: new Date().toISOString(),
        tag: '[C2][CBAC] Leads Trackeamento'
      };
      for (const name of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
        payload[name] = typeof req.body[name] === 'string' ? req.body[name].trim().slice(0, 254) : '';
      }
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000), redirect: 'error'
      });
      if (!response.ok) throw new Error('Webhook recusou o cadastro');
      return res.status(200).json({ ok: true });
    } catch {
      console.error('CBAC registration failed', { code: 'MAKE_WEBHOOK_FAILED' });
      return res.status(502).json({ error: 'Não foi possível concluir o cadastro.', code: 'MAKE_WEBHOOK_FAILED' });
    }
  }
  const key = process.env.API_KEY_ACTIVE || process.env.ACTIVE_API_KEY;
  if (!key) return res.status(503).json({ error: 'Cadastro temporariamente indisponível.' });
  const base = (process.env.API_URL_ACTIVE || 'https://ambientalpro.api-us1.com').trim().replace(/\/+$/, '').replace(/\/api\/3$/, '');
  function failure(code, message) {
    return Object.assign(new Error(message), { code });
  }
  function upstreamFailure(status, stage) {
    if (status === 401 || status === 403) return failure('ACTIVE_AUTH', 'A conexão com o ActiveCampaign não foi autorizada.');
    return failure('ACTIVE_' + stage + '_' + status, 'Não foi possível concluir o cadastro.');
  }
  async function post(path, payload) {
    const response = await fetch(base + '/api/3/' + path, {
      method: 'POST', headers: { 'Api-Token': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw upstreamFailure(response.status, path === 'contact/sync' ? 'CONTACT' : 'TAG');
    return response.json();
  }
  try {
    async function list(collection, query = '') {
      const items = [];
      for (let offset = 0; ; offset += 100) {
        const response = await fetch(base + '/api/3/' + collection + '?limit=100&offset=' + offset + query, {
          headers: { 'Api-Token': key }
        });
        if (!response.ok) throw upstreamFailure(response.status, collection.toUpperCase());
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
    const normalize = value => String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
    const matchedTags = tags.filter(item => normalize(item.tag) === normalize(tagName));
    if (matchedTags.length !== 1) throw failure('ACTIVE_TAG_CONFIG', 'Confira no ActiveCampaign a tag: ' + tagName);
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
      const matches = fields.filter(field => normalize(field.title) === normalize('[C2][CBAC] ' + suffix));
      if (matches.length !== 1) throw failure('ACTIVE_FIELD_CONFIG', 'Confira no ActiveCampaign o campo: [C2][CBAC] ' + suffix);
      fieldIds[suffix] = matches[0].id;
    }
    const [firstName, ...rest] = nome.trim().split(/\s+/);
    const { contact } = await post('contact/sync', { contact: {
      firstName, lastName: rest.join(' '), email: email.trim(), phone: telefone.trim(),
      fieldValues: Object.entries(values).map(([name, value]) => ({ field: fieldIds[name], value }))
    } });
    await post('contactTags', { contactTag: { contact: contact.id, tag } });
    return res.status(200).json({ ok: true });
  } catch (error) {
    const code = error.code?.startsWith('ACTIVE_') ? error.code : 'ACTIVE_CONNECTION';
    console.error('CBAC registration failed', { code });
    return res.status(502).json({ error: error.code?.startsWith('ACTIVE_') ? error.message : 'Não foi possível concluir o cadastro.', code });
  }
}
