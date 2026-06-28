module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Only POST is allowed' });
  }

  try {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return res.status(500).json({ ok: false, message: 'ADMIN_PASSWORD is not configured' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.password !== adminPassword) {
      return res.status(401).json({ ok: false, message: '密码错误' });
    }

    const token = Buffer.from(JSON.stringify({ role: 'admin', time: Date.now() })).toString('base64');
    return res.status(200).json({ ok: true, token, message: '登录成功' });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error && error.message ? error.message : 'Unknown error' });
  }
};
