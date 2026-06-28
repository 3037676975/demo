-- SkillHub Supabase database schema
-- 使用方法：打开 Supabase → SQL Editor → New query → 粘贴并运行。

create table if not exists public.skills (
  id text primary key,
  name text not null,
  category text not null default '前端',
  tag_zh text default '',
  tag_en text default '',
  featured boolean not null default false,
  enabled boolean not null default true,
  path text not null,
  github text not null,
  description_zh text default '',
  description_en text default '',
  fit_zh text default '',
  fit_en text default '',
  sort integer not null default 999,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.skills enable row level security;

drop policy if exists "Public can read enabled skills" on public.skills;
create policy "Public can read enabled skills"
  on public.skills
  for select
  using (enabled = true);

create index if not exists skills_sort_idx on public.skills(sort);
create index if not exists skills_category_idx on public.skills(category);
create index if not exists skills_enabled_idx on public.skills(enabled);

-- 初始数据可以从当前 skills.json 手动导入，或者在后台打开后点击“发布到 Supabase”。
