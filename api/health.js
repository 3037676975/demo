module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Only GET is allowed' });
  }

  const url = process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const missing = [];

  if (!url) missing.push('SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!adminPassword) missing.push('ADMIN_PASSWORD');

  const result = {
    ok: true,
    mode: missing.length ? 'json-fallback' : 'supabase-ready',
    supabaseConfigured: missing.length === 0,
    canReadSupabase: false,
    missing,
    projectHost: url ? url.replace(/^https?:\/\//, '').replace(/\/$/, '') : null,
    message: missing.length ? 'Supabase environment variables are incomplete.' : 'Supabase environment variables exist.'
  };

  if (url && (serviceKey || anonKey)) {
    try {
      const key = serviceKey || anonKey;
      const endpoint = `${url.replace(/\/$/, '')}/rest/v1/skills?select=id&limit=1`;
      const response = await fetch(endpoint, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json'
        }
      });
      result.canReadSupabase = response.ok;
      if (!response.ok) {
        result.message = 'Supabase variables exist, but reading the skills table failed. Check the SQL table and RLS policy.';
        result.status = response.status;
      }
    } catch (error) {
      result.message = error && error.message ? error.message : 'Supabase check failed.';
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(result);
};
