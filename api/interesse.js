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
  const makeWebhook = process.env.CBAC_MAKE_WEBHOOK_URL || process.env.MAKE_WEBHOOK_URL
    || 'https://hook.us1.make.com/yynnd0mqxexv255ke7fz28xprvettvoj';
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
}
