module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Only GET is allowed' });
  }

  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      return res.status(501).json({
        ok: false,
        message: 'Supabase is not configured. Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY.'
      });
    }

    const endpoint = `${url.replace(/\/$/, '')}/rest/v1/skills?select=*&order=sort.asc`;
    const response = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json'
      }
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch (error) { data = text; }

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: 'Failed to read skills from Supabase',
        detail: data
      });
    }

    const skills = Array.isArray(data) ? data.map(row => ({
      id: row.id,
      name: row.name,
      category: row.category,
      tagZh: row.tag_zh,
      tagEn: row.tag_en,
      featured: row.featured,
      enabled: row.enabled,
      path: row.path,
      github: row.github,
      descriptionZh: row.description_zh,
      descriptionEn: row.description_en,
      fitZh: row.fit_zh,
      fitEn: row.fit_en,
      sort: row.sort
    })) : [];

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, source: 'supabase', skills });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error && error.message ? error.message : 'Unknown server error'
    });
  }
};
