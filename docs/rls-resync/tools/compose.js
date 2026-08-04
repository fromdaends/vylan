// Generates resync.sql + audit.sql from state.json (the canonical RLS state
// replayed from supabase/migrations).
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
const state = JSON.parse(fs.readFileSync(path.join(OUT, 'state.json'), 'utf8'));

const REF_FNS = ['client_assigned_to_me','client_has_member','client_is_private','conversation_is_private','current_firm_allows_member_invites','current_firm_id','current_user_is_external','current_user_is_owner','engagement_has_member','engagement_is_private','on_an_engagement_for_client','series_is_private','shares_a_client_with_me'];
const FN_LIST_SQL = REF_FNS.map(f => `'${f}'`).join(',');

const alive = state.policies.filter(p => !p.dropped && p.createText);
const byTable = new Map();
for (const p of alive) {
  if (!byTable.has(p.table)) byTable.set(p.table, []);
  byTable.get(p.table).push(p);
}
// deny-all managed tables (RLS on, zero policies by design)
const DENY_ALL = ['public.jobs', 'public.demo_requests'];
const rlsSet = new Set(state.rlsTables.map(r => r.table.includes('.') ? r.table : 'public.' + r.table));

const fnDefs = state.functions.filter(f => REF_FNS.includes(f.name.replace('public.', '')));
if (fnDefs.length !== REF_FNS.length) { console.error('FN MISMATCH', fnDefs.map(f=>f.name)); process.exit(1); }

function stripSemi(s) { return s.replace(/;\s*$/, ''); }
function assertNoTag(s, tag) { if (s.includes(tag)) { console.error('TAG COLLISION ' + tag); process.exit(1); } return s; }
function sqlLit(s) { return `'${s.replace(/'/g, "''")}'`; }

// ---------------- resync.sql ----------------
let r = '';
r += `-- ════════════════════════════════════════════════════════════════════════\n`;
r += `-- VYLAN — PRODUCTION RLS RE-SYNC                        generated 2026-08-04\n`;
r += `-- Source of truth: supabase/migrations up to 1430_subtasks.sql (159 files),\n`;
r += `-- replayed in order; this file re-asserts the FINAL state of every row-level\n`;
r += `-- security policy (${alive.length} policies on ${byTable.size} tables) and the ${REF_FNS.length} helper functions\n`;
r += `-- those policies call. Written after prod was found running a years-old\n`;
r += `-- engagements_all (pre-0990 shape) while the ledger claimed 1220/1240/1320\n`;
r += `-- were applied.\n`;
r += `--\n`;
r += `-- HOW TO RUN: paste this WHOLE file into the Supabase SQL editor and press\n`;
r += `-- Run ONCE. It executes as a single transaction: if anything fails, NOTHING\n`;
r += `-- is changed and the error tells us what to fix. Safe to run twice (second\n`;
r += `-- run reports "already matched" everywhere). It never touches data rows.\n`;
r += `--\n`;
r += `-- WHAT IT DOES, per table (alphabetical):\n`;
r += `--   1. ensures row-level security is ON;\n`;
r += `--   2. drops + recreates each policy exactly as the migrations define it;\n`;
r += `--   3. drops any EXTRA policy on that table that the repo does not define\n`;
r += `--      (recorded in the report; storage.objects extras are only REPORTED).\n`;
r += `--   A table that errors (e.g. a column a pending migration adds is missing)\n`;
r += `--   is SKIPPED as a unit — its old policies stay — and shows in the report.\n`;
r += `--\n`;
r += `-- THE LAST STATEMENT PRINTS THE REPORT. Send me that output.\n`;
r += `-- ════════════════════════════════════════════════════════════════════════\n\n`;
r += `set search_path = public;\nset check_function_bodies = off;\n\n`;
r += `-- Snapshot the BEFORE state so the report can show what actually changed.\n`;
r += `create temp table _rls_before on commit drop as\n  select schemaname||'.'||tablename as tbl, policyname as pol, cmd, permissive,\n         array_to_string(roles, ',') as roles, qual, with_check\n    from pg_policies where schemaname in ('public','storage');\n`;
r += `create temp table _fns_before on commit drop as\n  select p.proname, pg_get_functiondef(p.oid) as def\n    from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n   where n.nspname = 'public' and p.proname in (${FN_LIST_SQL});\n`;
r += `create temp table _skipped (tbl text, reason text) on commit drop;\n`;
r += `create temp table _extras_dropped (tbl text, pol text, cmd text, roles text, qual text, with_check text) on commit drop;\n\n`;

r += `-- ── 1. Helper functions the policies call (verbatim last definitions) ────\n`;
r += `-- current_user_is_owner stays the 0190 rank-based body ON PURPOSE: 1290 made\n`;
r += `-- the Owner ROLE real but kept RLS on users.role — permissions never moved.\n\n`;
for (const f of fnDefs.sort((a, b) => a.name.localeCompare(b.name))) {
  const body = assertNoTag(assertNoTag(stripSemi(f.createText), '$fnddl$'), '$sync$');
  r += `do $sync$\nbegin\n  execute $fnddl$\n${body}\n$fnddl$;\n`;
  if (f.comment) r += `  execute $fnddl$\n${assertNoTag(stripSemi(f.comment), '$fnddl$')}\n$fnddl$;\n`;
  r += `exception when others then\n  insert into _skipped values ('function ${f.name}', sqlerrm);\nend $sync$;\n\n`;
}

r += `-- ── 2. Tables, alphabetical ──────────────────────────────────────────────\n\n`;
const allTables = [...new Set([...byTable.keys(), ...DENY_ALL])].filter(t => t !== 'storage.objects').sort();
for (const tbl of allTables) {
  const pols = (byTable.get(tbl) || []).sort((a, b) => a.name.localeCompare(b.name));
  const [schema, table] = tbl.split('.');
  const canonNames = pols.map(p => sqlLit(p.name)).join(', ');
  r += `-- ═══ ${tbl} ═══ ${pols.length ? 'expected: ' + pols.map(p => `${p.name} (${p.file})`).join(', ') : 'deny-all by design: RLS on, ZERO policies (service-role access only)'}\n`;
  r += `do $sync$\nbegin\n`;
  r += `  if to_regclass('${tbl}') is null then\n    insert into _skipped values ('${tbl}', 'table does not exist — a pending migration creates it; run db push, then re-run this file');\n    return;\n  end if;\n`;
  r += `  execute 'alter table ${tbl} enable row level security';\n`;
  for (const p of pols) {
    const ddl = assertNoTag(assertNoTag(stripSemi(p.createText), '$ddl$'), '$sync$');
    r += `  execute 'drop policy if exists "${p.name}" on ${tbl}';\n`;
    r += `  execute $ddl$\n${ddl}\n$ddl$;\n`;
    if (p.comment) r += `  execute $ddl$\n${assertNoTag(stripSemi(p.comment), '$ddl$')}\n$ddl$;\n`;
  }
  r += `  -- anything else on this table is not in the repo: record it, drop it\n`;
  r += `  declare rec record;\n  begin\n    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check\n                 from pg_policies where schemaname = '${schema}' and tablename = '${table}'\n                  ${pols.length ? `and policyname not in (${canonNames})` : ''} loop\n      insert into _extras_dropped values ('${tbl}', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);\n      execute format('drop policy %I on ${tbl}', rec.policyname);\n    end loop;\n  end;\n`;
  r += `exception when others then\n  insert into _skipped values ('${tbl}', sqlerrm);\nend $sync$;\n\n`;
}

// storage.objects — create-only, never drop extras, no ALTER TABLE (platform-owned)
const stor = byTable.get('storage.objects') || [];
r += `-- ═══ storage.objects ═══ platform-owned table: canon policy re-asserted, extras only REPORTED\n`;
r += `do $sync$\nbegin\n`;
for (const p of stor) {
  const ddl = assertNoTag(assertNoTag(stripSemi(p.createText), '$ddl$'), '$sync$');
  r += `  execute 'drop policy if exists "${p.name}" on storage.objects';\n`;
  r += `  execute $ddl$\n${ddl}\n$ddl$;\n`;
}
r += `exception when others then\n  insert into _skipped values ('storage.objects', sqlerrm);\nend $sync$;\n\n`;

// report
const canonValues = alive.map(p => `(${sqlLit(p.table)}, ${sqlLit(p.name)})`).join(',\n  ');
const storCanonNames = stor.map(p => sqlLit(p.name)).join(', ') || `''`;
r += `-- ── 3. THE REPORT — this is the output to send back ──────────────────────\n`;
r += `with canon(tbl, pol) as (values\n  ${canonValues}\n),\n`;
r += `after as (\n  select schemaname||'.'||tablename as tbl, policyname as pol, cmd, permissive,\n         array_to_string(roles, ',') as roles, qual, with_check\n    from pg_policies where schemaname in ('public','storage')\n),\n`;
r += `fns_after as (\n  select p.proname, pg_get_functiondef(p.oid) as def\n    from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n   where n.nspname = 'public' and p.proname in (${FN_LIST_SQL})\n),\n`;
r += `lines as (\n`;
r += `  select case when a.pol is null then 0 else 2 end as sev, c.tbl, c.pol as item,\n         case\n           when a.pol is null then 'STILL MISSING — see SKIPPED row for this table'\n           when b.pol is null then 'CREATED (prod was missing this policy)'\n           when (b.qual is distinct from a.qual) or (b.with_check is distinct from a.with_check)\n                or b.cmd is distinct from a.cmd or b.roles is distinct from a.roles\n                or b.permissive is distinct from a.permissive\n             then 'FIXED — prod had drifted (old md5 '||md5(coalesce(b.qual,'')||'|'||coalesce(b.with_check,''))||')'\n           else 'ok — already matched the repo'\n         end as status,\n         case when b.pol is not null and (b.qual is distinct from a.qual or b.with_check is distinct from a.with_check)\n              then 'old USING: '||left(coalesce(b.qual,'—'),160) else '' end as detail\n    from canon c\n    left join after a on a.tbl = c.tbl and a.pol = c.pol\n    left join _rls_before b on b.tbl = c.tbl and b.pol = c.pol\n`;
r += `  union all\n  select 1, tbl, pol, 'DROPPED extra policy (not in repo) — was '||cmd||' to '||coalesce(roles,'?')||', md5 '||md5(coalesce(qual,'')||'|'||coalesce(with_check,'')),\n         'was USING: '||left(coalesce(qual,'—'),160)\n    from _extras_dropped\n`;
r += `  union all\n  select 0, tbl, '—', 'SKIPPED: '||reason, '' from _skipped\n`;
r += `  union all\n  select 1, 'storage.objects', pol, 'REVIEW — extra storage policy left untouched (repo does not define it)', left(coalesce(qual, with_check),160)\n    from after where tbl = 'storage.objects' and pol not in (${storCanonNames})\n`;
r += `  union all\n  select 2, 'function', f.proname,\n         case when b.def is null then 'function CREATED (was missing)'\n              when b.def <> f.def then 'function REPLACED — body differed (old md5 '||md5(b.def)||')'\n              else 'function ok — already matched' end, ''\n    from fns_after f left join _fns_before b on b.proname = f.proname\n)\n`;
r += `select * from (\n  select -1 as sev, 'REPORT' as tbl,\n         to_char(now(), 'YYYY-MM-DD HH24:MI') as item,\n         (select count(*) filter (where status like 'FIXED%') from lines)||' fixed, '||\n         (select count(*) filter (where status like 'CREATED%') from lines)||' created, '||\n         (select count(*) filter (where status like 'DROPPED%') from lines)||' extras dropped, '||\n         (select count(*) filter (where status like 'function REPLACED%' or status like 'function CREATED%') from lines)||' functions changed, '||\n         (select count(*) filter (where status like 'ok%' or status like 'function ok%') from lines)||' already ok, '||\n         (select count(*) filter (where status like 'SKIPPED%') from lines)||' skipped' as status,\n         'send this whole table back' as detail\n  union all\n  select sev, tbl, item, status, detail from lines\n) rep\norder by sev, tbl, item;\n`;
fs.writeFileSync(path.join(OUT, 'resync.sql'), r);

// ---------------- audit.sql ----------------
let a = '';
a += `-- ════════════════════════════════════════════════════════════════════════\n`;
a += `-- VYLAN — PROD RLS AUDIT (read-only)                     generated 2026-08-04\n`;
a += `-- Dumps everything about row-level security so drift is visible and we keep\n`;
a += `-- a record: migration ledger, RLS flags, every policy (in 160-char chunks —\n`;
a += `-- the SQL editor truncates wide cells, chunks survive), helper-function\n`;
a += `-- bodies, and a per-table policy-count check against the repo.\n`;
a += `-- Paste the WHOLE file, Run once, send back the output (Export CSV if long).\n`;
a += `-- Changes NOTHING. Run it before resync.sql (the "before" record) and after\n`;
a += `-- (the proof).\n`;
a += `-- ════════════════════════════════════════════════════════════════════════\n`;
const expectedCounts = [...allTables, 'storage.objects'].map(t => {
  const n = (byTable.get(t) || []).length;
  return `(${sqlLit(t)}, ${n})`;
}).join(',\n  ');
a += `with expected(tbl, n) as (values\n  ${expectedCounts}\n),\n`;
a += `pol as (\n  select schemaname||'.'||tablename as tbl, policyname as pol,\n         cmd||' | to '||array_to_string(roles, ',')||' | '||permissive||' | USING: '||coalesce(qual, '—')||' | CHECK: '||coalesce(with_check, '—') as body\n    from pg_policies where schemaname in ('public','storage')\n),\n`;
a += `fn as (\n  select p.proname, pg_get_functiondef(p.oid) as body\n    from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n   where n.nspname = 'public' and p.proname in (${FN_LIST_SQL})\n)\n`;
a += `select * from (\n`;
a += `  select '1-ledger' as section, lpad(version, 12) as a, '' as b, 1 as seq,\n         'migration recorded as applied' as content\n    from supabase_migrations.schema_migrations\n`;
a += `  union all\n  select '2-rls-flag', n.nspname||'.'||c.relname, '', 1,\n         case when c.relrowsecurity then 'RLS ENABLED' else 'RLS *** OFF ***' end\n    from pg_class c join pg_namespace n on n.oid = c.relnamespace\n   where n.nspname in ('public','storage') and c.relkind = 'r'\n`;
a += `  union all\n  select '3-policy', tbl, pol, seg,\n         substr(body, (seg-1)*160+1, 160)\n    from pol, generate_series(1, (length(body)+159)/160) as seg\n`;
a += `  union all\n  select '4-function', proname, md5(body), seg,\n         substr(body, (seg-1)*160+1, 160)\n    from fn, generate_series(1, (length(body)+159)/160) as seg\n`;
a += `  union all\n  select '5-count-check', e.tbl, '', 1,\n         'expected '||e.n||' policies, prod has '||count(p.pol)||\n         case when count(p.pol) = e.n then ' — ok' else ' — *** MISMATCH ***' end\n    from expected e left join pol p on p.tbl = e.tbl\n   group by e.tbl, e.n\n`;
a += `) dump\norder by section, a, b, seq;\n`;
fs.writeFileSync(path.join(OUT, 'audit.sql'), a);

console.log('resync.sql', r.length, 'chars,', r.split('\n').length, 'lines');
console.log('audit.sql', a.length, 'chars,', a.split('\n').length, 'lines');
