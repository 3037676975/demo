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

function parseGitHubInput(input) {
  const u = new URL(input);
  if (u.hostname === 'raw.githubusercontent.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 4) throw new Error('raw 链接格式不完整');
    return { owner: parts[0], repo: parts[1], ref: parts[2], filePath: parts.slice(3).join('/'), inputType: 'raw-file' };
  }
  if (u.hostname !== 'github.com') throw new Error('只支持 github.com 或 raw.githubusercontent.com 链接');
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('GitHub 仓库链接格式不完整');
  const blobIndex = parts.indexOf('blob');
  if (parts.length >= 5 && blobIndex === 2) {
    return { owner: parts[0], repo: parts[1], ref: parts[3], filePath: parts.slice(4).join('/'), inputType: 'blob-file' };
  }
  return { owner: parts[0], repo: parts[1], inputType: 'repo' };
}

function isCommitSha(ref) {
  return /^[a-f0-9]{40}$/i.test(String(ref || ''));
}

async function githubJson(url, message) {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(message || '无法读取 GitHub 数据');
  return r.json();
}

async function getRepoInfo(info) {
  return githubJson(`https://api.github.com/repos/${info.owner}/${info.repo}`, '无法读取 GitHub 仓库信息');
}

async function resolveRefToCommitSha(info) {
  if (isCommitSha(info.ref)) return info.ref;
  const api = `https://api.github.com/repos/${info.owner}/${info.repo}/commits/${encodeURIComponent(info.ref)}`;
  const data = await githubJson(api, '无法把分支/标签解析为固定版本，请检查 GitHub 链接是否公开可访问');
  if (!data || !data.sha) throw new Error('无法获取 GitHub commit SHA');
  return data.sha;
}

function scorePath(path) {
  const p = path.toLowerCase();
  if (p === 'skill.md') return 100;
  if (p.endsWith('/skill.md') && p.includes('.claude/skills/')) return 95;
  if (p.endsWith('/skill.md') && p.includes('skills/')) return 90;
  if (p.endsWith('/skill.md')) return 80;
  if (p === 'claude.md') return 70;
  if (p === 'agents.md') return 65;
  if (p === 'readme.md') return 50;
  if (p.endsWith('/readme.md')) return 30;
  return 0;
}

async function discoverSkillFile(info) {
  const repoInfo = await getRepoInfo(info);
  const ref = repoInfo.default_branch || 'main';
  const commitInfo = await resolveRefToCommitSha({ ...info, ref });
  const tree = await githubJson(`https://api.github.com/repos/${info.owner}/${info.repo}/git/trees/${commitInfo}?recursive=1`, '无法扫描仓库文件结构');
  const files = Array.isArray(tree.tree) ? tree.tree.filter(x => x.type === 'blob').map(x => x.path) : [];
  const candidates = files
    .map(path => ({ path, score: scorePath(path) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  if (!candidates.length) throw new Error('这个仓库里没有找到 SKILL.md / CLAUDE.md / AGENTS.md / README.md');
  return {
    owner: info.owner,
    repo: info.repo,
    ref,
    filePath: candidates[0].path,
    inputType: 'repo-discovered',
    discoveredFiles: files.length,
    candidates: candidates.slice(0, 8).map(x => x.path)
  };
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
  if (s.includes('benchmark') || s.includes('leaderboard') || s.includes('evaluate')) return '测试';
  if (s.includes('test') || s.includes('测试')) return '测试';
  if (s.includes('brand') || s.includes('品牌')) return '品牌';
  if (s.includes('summary') || s.includes('summarize') || s.includes('总结')) return '总结';
  if (s.includes('design') || s.includes('canvas') || s.includes('视觉') || s.includes('设计')) return '设计';
  return '前端';
}

function detectFit(category, hay) {
  if (/benchmark|leaderboard|evaluate|评测|测试/i.test(hay)) return '模型评测、Agent 能力测试、Benchmark 对比';
  if (/mcp|server|api|token|key|环境变量/i.test(hay)) return '需要注意外部工具、API 或环境变量依赖';
  if (category === '前端') return '网页、组件、界面优化';
  if (category === '设计') return '视觉设计、页面美化、设计规范';
  if (category === '总结') return '文章总结、会议纪要、资料提炼';
  return 'AI 工作流、任务处理';
}

function frontMatterValue(md, key) {
  const match = md.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
  return match ? cleanText(match[1].replace(/^['"]|['"]$/g, '')) : '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Only POST is allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const sourceUrl = String(body.url || '').trim();
    if (!sourceUrl) return res.status(400).json({ ok: false, message: '请填写 GitHub 仓库或 Skill 文件链接' });

    let info = parseGitHubInput(sourceUrl);
    if (info.inputType === 'repo') info = await discoverSkillFile(info);

    const pinnedRef = await resolveRefToCommitSha(info);
    const pinnedRawUrl = rawUrl(info, pinnedRef);
    const pinnedGithubUrl = blobUrl(info, pinnedRef);
    const originalRawUrl = rawUrl(info, info.ref);

    const r = await fetch(pinnedRawUrl, { headers: { Accept: 'text/plain' } });
    if (!r.ok) return res.status(r.status).json({ ok: false, message: '无法读取固定版本的 GitHub 原始文件' });
    const md = await r.text();

    const fmName = frontMatterValue(md, 'name');
    const fmDesc = frontMatterValue(md, 'description');
    const titleMatch = md.match(/^#\s+(.+)$/m);
    const name = cleanText(fmName || (titleMatch ? titleMatch[1] : info.filePath.split('/').slice(-2, -1)[0] || info.repo));
    const paragraphs = md.split(/\n\s*\n/).map(cleanText).filter(Boolean).filter(p => !p.toLowerCase().startsWith('name '));
    const descBase = fmDesc || paragraphs.find(p => p.length > 20 && !p.startsWith(name)) || `${name} Skill 调用入口。`;
    const hay = `${name} ${descBase} ${md.slice(0, 1800)}`;
    const category = detectCategory(hay);
    const id = slugify(name);
    const isGlass = /glass|liquid|玻璃/i.test(hay);
    const isReact = /react|next/i.test(hay);
    const hasReferences = /\.md|\.json|\.ts|\.js|\.py|examples?|templates?|assets?|scripts?|tasks?/i.test(md) || Boolean(info.discoveredFiles && info.discoveredFiles > 3);
    const hasDeps = /mcp|api key|token|npm|pip|package\.json|python|uv|docker|环境变量|依赖/i.test(md);

    const skill = {
      id,
      name,
      category,
      tagZh: isGlass ? '液态玻璃' : (category === '测试' ? '评测' : category),
      tagEn: isReact ? 'React' : (category === '测试' ? 'Benchmark' : (isGlass ? 'Liquid Glass' : category)),
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
      source: info.inputType === 'repo-discovered' ? 'github-repo-discovered' : 'github-pinned',
      message: '已生成固定版本 Skill 调用入口，不复制仓库内容。',
      rawUrl: pinnedRawUrl,
      githubUrl: pinnedGithubUrl,
      originalRawUrl,
      pinnedRef,
      directory: info.filePath.split('/').slice(0, -1).join('/') || '/',
      report: {
        importType: '调用入口，不是完整仓库镜像',
        inputType: info.inputType,
        selectedFile: info.filePath,
        candidates: info.candidates || [info.filePath],
        discoveredFiles: info.discoveredFiles || null,
        pinned: true,
        hasReferences,
        hasPossibleDependencies: hasDeps,
        warning: hasReferences || hasDeps ? '该仓库可能包含任务、脚本或依赖；本站只保存固定版本规则入口，复杂运行请查看 GitHub 原仓库。' : '未发现明显外部依赖，适合作为稳定规则入口。'
      },
      skill
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error && error.message ? error.message : '导入失败' });
  }
};
