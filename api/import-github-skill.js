function cleanText(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_>#\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text) {
  return String(text || 'skill')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || `skill-${Date.now()}`;
}

function toRawUrl(input) {
  const u = new URL(input);
  if (u.hostname === 'raw.githubusercontent.com') return u.toString();
  if (u.hostname !== 'github.com') throw new Error('只支持 github.com 或 raw.githubusercontent.com 链接');
  const parts = u.pathname.split('/').filter(Boolean);
  const blobIndex = parts.indexOf('blob');
  if (parts.length >= 5 && blobIndex === 2) {
    const owner = parts[0];
    const repo = parts[1];
    const ref = parts[3];
    const filePath = parts.slice(4).join('/');
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
  }
  throw new Error('请粘贴具体的 GitHub 文件链接，例如 SKILL.md 的 blob 链接');
}

function detectCategory(text) {
  const s = text.toLowerCase();
  if (s.includes('mcp')) return 'MCP';
  if (s.includes('test') || s.includes('测试')) return '测试';
  if (s.includes('brand') || s.includes('品牌')) return '品牌';
  if (s.includes('summary') || s.includes('summarize') || s.includes('总结')) return '总结';
  if (s.includes('design') || s.includes('canvas') || s.includes('视觉') || s.includes('设计')) return '设计';
  return '前端';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Only POST is allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const sourceUrl = String(body.url || '').trim();
    if (!sourceUrl) return res.status(400).json({ ok: false, message: '请填写 GitHub Skill 链接' });

    const rawUrl = toRawUrl(sourceUrl);
    const r = await fetch(rawUrl, { headers: { Accept: 'text/plain' } });
    if (!r.ok) return res.status(r.status).json({ ok: false, message: '无法读取 GitHub 原始文件' });
    const md = await r.text();

    const titleMatch = md.match(/^#\s+(.+)$/m);
    const name = cleanText(titleMatch ? titleMatch[1] : rawUrl.split('/').slice(-2, -1)[0] || 'GitHub Skill');
    const paragraphs = md.split(/\n\s*\n/).map(cleanText).filter(Boolean).filter(p => !p.toLowerCase().startsWith('name '));
    const desc = paragraphs.find(p => p.length > 20 && !p.startsWith(name)) || `${name} Skill 工作流。`;
    const hay = `${name} ${desc} ${md.slice(0, 1000)}`;
    const category = detectCategory(hay);
    const id = slugify(name);
    const isGlass = /glass|liquid|玻璃/i.test(hay);
    const isReact = /react|next/i.test(hay);

    const skill = {
      id,
      name,
      category,
      tagZh: isGlass ? '液态玻璃' : (category === 'MCP' ? 'MCP' : category),
      tagEn: isReact ? 'React' : (isGlass ? 'Liquid Glass' : category),
      featured: false,
      enabled: true,
      path: rawUrl,
      github: sourceUrl,
      descriptionZh: desc.slice(0, 120),
      descriptionEn: desc.slice(0, 120),
      fitZh: category === '前端' ? '网页、组件、界面优化' : 'AI 工作流、任务处理',
      fitEn: category === '前端' ? 'Web UI, components, interface polish' : 'AI workflow and task execution',
      sort: Number(body.sort || 999)
    };

    return res.status(200).json({ ok: true, source: 'github', rawUrl, skill });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error && error.message ? error.message : '导入失败' });
  }
};
