'use strict';
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];

async function main() {
  let parse, parsePlPgSQL = null;
  try {
    const m = require('pgsql-parser');
    parse = m.parse || (m.default && m.default.parse);
  } catch (e) {
    const m = await import('pgsql-parser');
    parse = m.parse || (m.default && m.default.parse);
  }
  try {
    const lq = require('libpg-query');
    parsePlPgSQL = lq.parsePlPgSQL || lq.parsePlPgSQLSync || null;
  } catch (e) { /* optional */ }

  let fails = 0;
  async function check(label, sql) {
    try { const r = parse(sql); const res = r && r.then ? await r : r; return true; }
    catch (e) { fails++; console.log(`FAIL ${label}: ${String(e.message).slice(0, 200)}`); return false; }
  }

  // 1. whole files
  for (const f of ['resync.sql', 'audit.sql']) {
    const sql = fs.readFileSync(path.join(OUT, f), 'utf8');
    const ok = await check(f, sql);
    console.log(`${f}: whole-file parse ${ok ? 'OK' : 'FAILED'}`);
  }

  // 2. every DO body as plpgsql
  const resync = fs.readFileSync(path.join(OUT, 'resync.sql'), 'utf8');
  const doBlocks = [...resync.matchAll(/do \$sync\$([\s\S]*?)\$sync\$;/g)];
  console.log(`DO blocks found: ${doBlocks.length}`);
  if (parsePlPgSQL) {
    let plfails = 0;
    for (let i = 0; i < doBlocks.length; i++) {
      const stmt = `do $sync$${doBlocks[i][1]}$sync$;`;
      try { const r = parsePlPgSQL(stmt); if (r && r.then) await r; }
      catch (e) { plfails++; console.log(`PLPGSQL FAIL block ${i}: ${String(e.message).slice(0, 300)}\n--- ${doBlocks[i][1].slice(0, 200)}`); }
    }
    console.log(`plpgsql: ${doBlocks.length - plfails}/${doBlocks.length} OK`);
    fails += plfails;
  } else console.log('plpgsql parser NOT available — DO bodies not machine-checked');

  // 3. every embedded EXECUTE payload from canon state
  const state = JSON.parse(fs.readFileSync(path.join(OUT, 'state.json'), 'utf8'));
  const alive = state.policies.filter(p => !p.dropped && p.createText);
  let n = 0;
  for (const p of alive) {
    if (await check(`policy ${p.key}`, p.createText)) n++;
    if (p.comment) await check(`comment ${p.key}`, p.comment);
  }
  console.log(`canon policy DDL: ${n}/${alive.length} parse OK`);
  const REF = ['client_assigned_to_me','client_has_member','client_is_private','conversation_is_private','current_firm_allows_member_invites','current_firm_id','current_user_is_external','current_user_is_owner','engagement_has_member','engagement_is_private','on_an_engagement_for_client','series_is_private','shares_a_client_with_me'];
  let fn = 0, fntot = 0;
  for (const f of state.functions.filter(f => REF.includes(f.name.replace('public.', '')))) {
    fntot++;
    if (await check(`function ${f.sig}`, f.createText)) fn++;
    if (f.comment) await check(`fncomment ${f.sig}`, f.comment);
  }
  console.log(`canon function DDL: ${fn}/${fntot} parse OK`);
  console.log(fails === 0 ? 'ALL VALIDATION PASSED' : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(e => { console.error('validator crashed:', e); process.exit(2); });
