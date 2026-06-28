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

function parseGitHubFile(input) {
  const u = new URL(input);
  if (u.hostname === 'raw.githubusercontent.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 4) throw new Error('raw 链接格式不完整');
    return { owner: parts[0], repo: parts[1], ref: parts[2], filePath: parts.slice(3).join('/'), inputType: 'raw' };
  }
  if (u.hostname !== 'github.com') throw new Error('只支持 github.com 或 raw.githubusercontent.com 链接');
  const parts = u.pathname.split('/').filter(Boolean);
  const blobIndex = parts.indexOf('blob');
  if (parts.length >= 5 && blobIndex === 2) {
    return { owner: parts[0], repo: parts[1], ref: parts[3], filePath: parts.slice(4).join('/'), inputType: 'blob' };
  }
  throw new Error('请粘贴具体的 GitHub 文件链接，例如 SKILL.md 的 blob 链接');
}

function isCommitSha(ref) {
  return /^[a-f0-9]{40}$/i.test(String(ref || ''));
}

async function resolveRefToCommitSha(info) {
  if (isCommitSha(info.ref)) return info.ref;
  const api = `https://api.github.com/repos/${info.owner}/${info.repo}/commits/${encodeURIComponent(info.ref)}`;
  const r = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error('无法把分支/标签解析为固定版本，请检查 GitHub 链接是否公开可访问');
  const data = await r.json();
  if (!data || !data.sha) throw new Error('无法获取 GitHub commit SHA');
  return data.sha;
}

function rawUrl(info, ref) {
  return `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${ref}/${info.filePath}`;
}

function blobUrl(info, ref) {
  return `https://github.com/${info.owner}/${info.repo}/blob/${ref}/${info.filePath}`;
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

function detectFit(category, hay) {
  if (/mcp|server|api|token|key|环境变量/i.test(hay)) return '需要注意外部工具、API 或环境变量依赖';
  if (category === '前端') return '网页、组件、界面优化';
  if (category === '设计') return '视觉设计、页面美化、设计规范';
  if (category === '总结') return '文章总结、会议纪要、资料提炼';
  return 'AI 工作流、任务处理';
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

    const info = parseGitHubFile(sourceUrl);
    const pinnedRef = await resolveRefToCommitSha(info);
    const pinnedRawUrl = rawUrl(info, pinnedRef);
    const pinnedGithubUrl = blobUrl(info, pinnedRef);
    const originalRawUrl = rawUrl(info, info.ref);

    const r = await fetch(pinnedRawUrl, { headers: { Accept: 'text/plain' } });
    if (!r.ok) return res.status(r.status).json({ ok: false, message: '无法读取固定版本的 GitHub 原始文件' });
    const md = await r.text();

    const titleMatch = md.match(/^#\s+(.+)$/m);
    const name = cleanText(titleMatch ? titleMatch[1] : info.filePath.split('/').slice(-2, -1)[0] || 'GitHub Skill');
    const paragraphs = md.split(/\n\s*\n/).map(cleanText).filter(Boolean).filter(p => !p.toLowerCase().startsWith('name '));
    const descBase = paragraphs.find(p => p.length > 20 && !p.startsWith(name)) || `${name} Skill 调用入口。`;
    const hay = `${name} ${descBase} ${md.slice(0, 1600)}`;
    const category = detectCategory(hay);
    const id = slugify(name);
    const isGlass = /glass|liquid|玻璃/i.test(hay);
    const isReact = /react|next/i.test(hay);
    const hasReferences = /\.md|\.json|\.ts|\.js|\.py|examples?|templates?|assets?|scripts?/i.test(md);
    const hasDeps = /mcp|api key|token|npm|pip|package\.json|环境变量|依赖/i.test(md);

    const skill = {
      id,
      name,
      category,
      tagZh: isGlass ? '液态玻璃' : (category === 'MCP' ? 'MCP' : category),
      tagEn: isReact ? 'React' : (isGlass ? 'Liquid Glass' : category),
      featured: false,
      enabled: true,
      path: pinnedRawUrl,
      github: pinnedGithubUrl,
      descriptionZh: descBase.slice(0, 120),
      descriptionEn: descBase.slice(0, 120),
      fitZh: detectFit(category, hay),
      fitEn: hasDeps ? 'Check external tools, API keys or environment dependencies' : 'Stable pinned GitHub Skill rule link',
      sort: Number(body.sort || 999)
    };

    return res.status(200).json({
      ok: true,
      source: 'github-pinned',
      message: '已生成固定版本 Skill 调用入口，不复制仓库内容。',
      rawUrl: pinnedRawUrl,
      githubUrl: pinnedGithubUrl,
      originalRawUrl,
      pinnedRef,
      directory: info.filePath.split('/').slice(0, -1).join('/'),
      report: {
        importType: '调用入口，不是完整仓库镜像',
        pinned: true,
        hasReferences,
        hasPossibleDependencies: hasDeps,
        warning: hasReferences || hasDeps ? '该 Skill 可能引用其他文件或依赖，导入后建议人工检查说明。' : '未发现明显外部依赖，适合作为稳定规则入口。'
      },
      skill
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error && error.message ? error.message : '导入失败' });
  }
};
