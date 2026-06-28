const crypto = require('crypto');

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function verifyToken(token, secret) {
  try {
    if (!token || typeof token !== 'string' || !token.includes('.')) return false;
    const [payload, signature] = token.split('.');
    const expected = sign(payload, secret);
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'admin' && Number(data.exp || 0) > Date.now();
  } catch (error) {
    return false;
  }
}

function normalizeSkill(item, index) {
  const id = item.id || String(item.name || `skill-${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id,
    name: item.name || 'Untitled Skill',
    category: item.category || '前端',
    tag_zh: item.tagZh || item.tag_zh || '',
    tag_en: item.tagEn || item.tag_en || '',
    featured: Boolean(item.featured),
    enabled: item.enabled !== false,
    path: item.path || '',
    github: item.github || '',
    description_zh: item.descriptionZh || item.description_zh || '',
    description_en: item.descriptionEn || item.description_en || '',
    fit_zh: item.fitZh || item.fit_zh || '',
    fit_en: item.fitEn || item.fit_en || '',
    sort: Number(item.sort || index + 1),
    updated_at: new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Only POST is allowed' });
  }

  try {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!url || !serviceKey || !adminPassword) {
      return res.status(500).json({
        ok: false,
        message: 'Missing environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or ADMIN_PASSWORD'
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const headerToken = req.headers['x-admin-token'] || req.headers['authorization'];
    const token = String(body.token || headerToken || '').replace(/^Bearer\s+/i, '');
    const passwordOk = body.password && body.password === adminPassword;
    const tokenOk = verifyToken(token, adminPassword);

    if (!passwordOk && !tokenOk) {
      return res.status(401).json({ ok: false, message: 'Admin login expired or password is incorrect' });
    }

    if (!Array.isArray(body.skills)) {
      return res.status(400).json({ ok: false, message: 'skills must be an array' });
    }

    const rows = body.skills.map(normalizeSkill);
    for (const row of rows) {
      if (!row.name || !row.path || !row.github) {
        return res.status(400).json({ ok: false, message: 'Each skill must include name, path, and github' });
      }
    }

    const base = url.replace(/\/$/, '');
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates'
    };

    const upsertResp = await fetch(`${base}/rest/v1/skills?on_conflict=id`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rows)
    });

    const upsertText = await upsertResp.text();
    let upsertData;
    try { upsertData = JSON.parse(upsertText); } catch (error) { upsertData = upsertText; }

    if (!upsertResp.ok) {
      return res.status(upsertResp.status).json({
        ok: false,
        message: 'Failed to save skills to Supabase',
        detail: upsertData
      });
    }

    const ids = rows.map(row => row.id);
    if (ids.length) {
      const deleteResp = await fetch(`${base}/rest/v1/skills?id=not.in.(${ids.map(encodeURIComponent).join(',')})`, {
        method: 'DELETE',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'return=minimal'
        }
      });

      if (!deleteResp.ok) {
        const detail = await deleteResp.text();
        return res.status(deleteResp.status).json({
          ok: false,
          message: 'Saved skills, but failed to delete removed rows',
          detail
        });
      }
    }

    return res.status(200).json({
      ok: true,
      source: 'supabase',
      message: 'Skills saved to Supabase successfully',
      count: rows.length
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error && error.message ? error.message : 'Unknown server error'
    });
  }
};
