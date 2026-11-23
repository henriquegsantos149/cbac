export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { nome, email, telefone, graduacao, area } = req.body || {};
  if (![nome, email, telefone].every(value => typeof value === 'string' && value.trim() && value.length <= 254)
      || !['sim', 'nao'].includes(graduacao)
      || (graduacao === 'sim' && (typeof area !== 'string' || !area.trim() || area.length > 150))
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      || !/^\d{10,13}$/.test(telefone.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Confira os dados informados.' });
  }
  const key = process.env.API_KEY_ACTIVE || process.env.ACTIVE_API_KEY;
  const tag = process.env.CBAC_TAG_ID;
  const gradField = process.env.CBAC_GRADUACAO_FIELD_ID;
  const areaField = process.env.CBAC_AREA_FIELD_ID;
  if (!key || !tag || !gradField || !areaField) return res.status(503).json({ error: 'Cadastro temporariamente indisponível.' });
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
    const [firstName, ...rest] = nome.trim().split(/\s+/);
    const { contact } = await post('contact/sync', { contact: {
      firstName, lastName: rest.join(' '), email: email.trim(), phone: telefone.trim(),
      fieldValues: [
        { field: gradField, value: graduacao },
        { field: areaField, value: graduacao === 'sim' ? area.trim() : '' }
      ]
    } });
    await post('contactTags', { contactTag: { contact: contact.id, tag } });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(502).json({ error: 'Não foi possível concluir o cadastro.' });
  }
}
