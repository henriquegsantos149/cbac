export const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

// Os nomes canônicos têm prioridade quando o link também traz aliases.
export function readUTMs(entries) {
  const values = {};
  const priorities = {};
  for (const [name, value] of entries) {
    if (typeof value !== 'string') continue;
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = utmKeys.find(key => normalized.endsWith(key.replace('_', '')));
    if (!key) continue;
    const priority = name === key ? 3 : normalized === key.replace('_', '') ? 2 : 1;
    if (priority <= (priorities[key] || 0)) continue;
    priorities[key] = priority;
    values[key] = value.trim().slice(0, 254);
  }
  return values;
}
