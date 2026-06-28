module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Only POST is allowed' });
  }

  try {
    const token = process.env.GITHUB_TOKEN;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const repo = process.env.GITHUB_REPO || '3037676975/demo';
    const branch = process.env.GITHUB_BRANCH || 'main';
    const filePath = process.env.SKILLS_FILE_PATH || 'skills.json';

    if (!token || !adminPassword) {
      return res.status(500).json({
        ok: false,
        message: 'Missing environment variables: GITHUB_TOKEN or ADMIN_PASSWORD'
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const password = body.password;
    const skills = body.skills;

    if (password !== adminPassword) {
      return res.status(401).json({ ok: false, message: 'Admin password is incorrect' });
    }

    if (!Array.isArray(skills)) {
      return res.status(400).json({ ok: false, message: 'skills must be an array' });
    }

    for (const item of skills) {
      if (!item || typeof item !== 'object' || !item.name || !item.path || !item.github) {
        return res.status(400).json({
          ok: false,
          message: 'Each skill must include at least name, path, and github'
        });
      }
    }

    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'skillhub-admin'
    };

    const currentResp = await fetch(apiUrl, { headers });
    if (!currentResp.ok) {
      const text = await currentResp.text();
      return res.status(currentResp.status).json({
        ok: false,
        message: 'Failed to read current skills.json from GitHub',
        detail: text
      });
    }

    const current = await currentResp.json();
    const content = JSON.stringify(skills, null, 2) + '\n';
    const encoded = Buffer.from(content, 'utf8').toString('base64');

    const updateResp = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Update skills from SkillHub Admin',
        content: encoded,
        sha: current.sha,
        branch
      })
    });

    const updateData = await updateResp.json();
    if (!updateResp.ok) {
      return res.status(updateResp.status).json({
        ok: false,
        message: 'Failed to update skills.json on GitHub',
        detail: updateData
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'skills.json updated successfully',
      commit: updateData.commit && updateData.commit.sha,
      path: filePath
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error && error.message ? error.message : 'Unknown server error'
    });
  }
};
