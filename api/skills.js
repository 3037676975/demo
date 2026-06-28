const fs = require('fs');
const path = require('path');

function readJsonFallback() {
  try {
    const file = path.join(process.cwd(), 'skills.json');
    const text = fs.readFileSync(file, 'utf8');
    const skills = JSON.parse(text);
    return Array.isArray(skills) ? skills : [];
  } catch (error) {
    return [];
  }
}

function mapRows(data) {
  return Array.isArray(data) ? data.map(row => ({
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
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Only GET is allowed' });
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      const fallback = readJsonFallback();
      return res.status(200).json({
        ok: true,
        source: 'json-fallback',
        skills: fallback,
        message: 'Supabase is not configured, using skills.json fallback.'
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
      const fallback = readJsonFallback();
      if (fallback.length) {
        return res.status(200).json({
          ok: true,
          source: 'json-fallback',
          skills: fallback,
          message: 'Failed to read Supabase, using skills.json fallback.',
          detail: data
        });
      }
      return res.status(response.status).json({
        ok: false,
        message: 'Failed to read skills from Supabase',
        detail: data
      });
    }

    const skills = mapRows(data);
    if (!skills.length) {
      const fallback = readJsonFallback();
      return res.status(200).json({
        ok: true,
        source: 'json-fallback',
        skills: fallback,
        message: 'Supabase skills table is empty, using skills.json fallback.'
      });
    }

    return res.status(200).json({ ok: true, source: 'supabase', skills });
  } catch (error) {
    const fallback = readJsonFallback();
    if (fallback.length) {
      return res.status(200).json({
        ok: true,
        source: 'json-fallback',
        skills: fallback,
        message: 'Server error while reading Supabase, using skills.json fallback.',
        detail: error && error.message ? error.message : 'Unknown server error'
      });
    }
    return res.status(500).json({
      ok: false,
      message: error && error.message ? error.message : 'Unknown server error'
    });
  }
};
