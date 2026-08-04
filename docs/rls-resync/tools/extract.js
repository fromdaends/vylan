// Replays supabase/migrations in filename order and computes the FINAL
// (canonical) RLS state: policies, RLS-enabled tables, helper functions,
// grants/revokes, and comments on policies/functions. Emits state.json +
// a human summary with anomaly flags.
'use strict';
const fs = require('fs');
const path = require('path');

const MIG_DIR = process.argv[2];
const OUT_DIR = process.argv[3];
if (!MIG_DIR || !OUT_DIR) { console.error('usage: node extract.js <migdir> <outdir>'); process.exit(1); }

// ---------- statement splitter ----------
function splitStatements(sql) {
  const stmts = [];
  let i = 0, start = 0;
  const n = sql.length;
  let mode = 'normal'; // normal | line | block | squote | dquote | dollar
  let blockDepth = 0, dollarTag = null;
  while (i < n) {
    const c = sql[i], c2 = sql.substr(i, 2);
    if (mode === 'normal') {
      if (c2 === '--') { mode = 'line'; i += 2; continue; }
      if (c2 === '/*') { mode = 'block'; blockDepth = 1; i += 2; continue; }
      if (c === "'") { mode = 'squote'; i++; continue; }
      if (c === '"') { mode = 'dquote'; i++; continue; }
      if (c === '$') {
        const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i, i + 64));
        if (m) { mode = 'dollar'; dollarTag = m[0]; i += m[0].length; continue; }
      }
      if (c === ';') {
        const text = sql.slice(start, i + 1);
        if (text.trim().length > 1) stmts.push({ text, start });
        i++; start = i; continue;
      }
      i++; continue;
    }
    if (mode === 'line') { if (c === '\n') mode = 'normal'; i++; continue; }
    if (mode === 'block') {
      if (c2 === '/*') { blockDepth++; i += 2; continue; }
      if (c2 === '*/') { blockDepth--; i += 2; if (blockDepth === 0) mode = 'normal'; continue; }
      i++; continue;
    }
    if (mode === 'squote') {
      if (c === "'") { if (sql[i + 1] === "'") { i += 2; continue; } mode = 'normal'; i++; continue; }
      i++; continue;
    }
    if (mode === 'dquote') {
      if (c === '"') { if (sql[i + 1] === '"') { i += 2; continue; } mode = 'normal'; i++; continue; }
      i++; continue;
    }
    if (mode === 'dollar') {
      if (sql.startsWith(dollarTag, i)) { i += dollarTag.length; mode = 'normal'; dollarTag = null; continue; }
      i++; continue;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail.length > 0) stmts.push({ text: sql.slice(start), start, unterminated: true });
  return stmts;
}

// strip comments but keep everything else (incl. dollar bodies), preserve case
function stripComments(sql) {
  let out = '', i = 0, mode = 'normal', blockDepth = 0, dollarTag = null;
  const n = sql.length;
  while (i < n) {
    const c = sql[i], c2 = sql.substr(i, 2);
    if (mode === 'normal') {
      if (c2 === '--') { mode = 'line'; i += 2; continue; }
      if (c2 === '/*') { mode = 'block'; blockDepth = 1; i += 2; continue; }
      if (c === "'") { mode = 'squote'; out += c; i++; continue; }
      if (c === '"') { mode = 'dquote'; out += c; i++; continue; }
      if (c === '$') {
        const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i, i + 64));
        if (m) { mode = 'dollar'; dollarTag = m[0]; out += m[0]; i += m[0].length; continue; }
      }
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'normal'; out += '\n'; } i++; continue; }
    if (mode === 'block') {
      if (c2 === '/*') { blockDepth++; i += 2; continue; }
      if (c2 === '*/') { blockDepth--; i += 2; if (blockDepth === 0) { mode = 'normal'; out += ' '; } continue; }
      i++; continue;
    }
    if (mode === 'squote') { out += c; if (c === "'") { if (sql[i + 1] === "'") { out += "'"; i += 2; continue; } mode = 'normal'; } i++; continue; }
    if (mode === 'dquote') { out += c; if (c === '"') { if (sql[i + 1] === '"') { out += '"'; i += 2; continue; } mode = 'normal'; } i++; continue; }
    if (mode === 'dollar') {
      if (sql.startsWith(dollarTag, i)) { out += dollarTag; i += dollarTag.length; mode = 'normal'; dollarTag = null; continue; }
      out += c; i++; continue;
    }
  }
  return out;
}

const IDENT = `(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = `(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?`;
function unq(s) { return s == null ? s : (s.startsWith('"') ? s.slice(1, -1) : s.toLowerCase()); }
function tblKey(a, b) { // (schemaOrTable, maybeTable)
  const schema = b ? unq(a) : 'public';
  const table = b ? unq(b) : unq(a);
  return `${schema}.${table}`;
}

// ---------- state ----------
const policies = new Map();   // key table|name -> {table, name, createText, file, dropped, comment, commentFile, history:[]}
const rls = new Map();        // table -> {file}
const fns = new Map();        // sig -> {name, args, createText, file, comment}
const grants = [];            // {verbatim, target, file, kind}
const flags = [];
let createCount = 0, dropCount = 0;

const files = fs.readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();
for (const file of files) {
  const sql = fs.readFileSync(path.join(MIG_DIR, file), 'utf8');
  const stmts = splitStatements(sql);
  for (const st of stmts) {
    if (st.unterminated && st.text.trim().length > 0) {
      const t = st.text.trim();
      if (!/^--/.test(t) || /create\s+policy|drop\s+policy/i.test(stripComments(t)))
        if (stripComments(t).trim()) flags.push(`[${file}] UNTERMINATED tail statement: ${stripComments(t).trim().slice(0, 120)}`);
    }
    const cleanFull = stripComments(st.text).replace(/\s+/g, ' ').trim();
    if (!cleanFull) continue;
    const clean = cleanFull.toLowerCase();
    const verbatimClean = stripComments(st.text).trim(); // case-preserved, comments removed

    let m;
    if ((m = new RegExp(`^create\\s+policy\\s+(${IDENT})\\s+on\\s+${QNAME}`, 'i').exec(cleanFull))) {
      const name = unq(m[1].startsWith('"') ? m[1] : m[1].toLowerCase());
      const key = tblKey(m[2], m[3]) + '|' + name;
      const prev = policies.get(key);
      if (prev && !prev.dropped) flags.push(`[${file}] CREATE over existing non-dropped policy ${key} (replay would error)`);
      policies.set(key, { table: tblKey(m[2], m[3]), name, createText: verbatimClean, file, dropped: false, comment: (prev && prev.comment) || null, commentFile: (prev && prev.commentFile) || null, history: [...((prev && prev.history) || []), `create@${file}`] });
      createCount++;
      continue;
    }
    if ((m = new RegExp(`^drop\\s+policy\\s+(?:if\\s+exists\\s+)?(${IDENT})\\s+on\\s+${QNAME}`, 'i').exec(cleanFull))) {
      const name = unq(m[1].startsWith('"') ? m[1] : m[1].toLowerCase());
      const key = tblKey(m[2], m[3]) + '|' + name;
      const prev = policies.get(key);
      policies.set(key, { table: tblKey(m[2], m[3]), name, createText: prev ? prev.createText : null, file: prev ? prev.file : null, dropped: true, comment: null, commentFile: null, history: [...((prev && prev.history) || []), `drop@${file}`] });
      dropCount++;
      continue;
    }
    if ((m = new RegExp(`^alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?${QNAME}\\s+enable\\s+row\\s+level\\s+security\\s*;?$`, 'i').exec(cleanFull))) {
      rls.set(tblKey(m[1], m[2]), { file });
      continue;
    }
    if ((m = new RegExp(`^alter\\s+policy\\s`, 'i').exec(cleanFull))) {
      flags.push(`[${file}] ALTER POLICY found (unhandled): ${cleanFull.slice(0, 120)}`);
      continue;
    }
    if ((m = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?function\\s+${QNAME}\\s*\\(([^)]*)\\)`, 'i').exec(cleanFull))) {
      const fname = tblKey(m[1], m[2]);
      const args = (m[3] || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const sig = `${fname}(${args})`;
      const prev = fns.get(sig);
      fns.set(sig, { name: fname, args, createText: verbatimClean, file, comment: (prev && prev.comment) || null, history: [...((prev && prev.history) || []), file] });
      continue;
    }
    if (/^drop\s+function/i.test(clean)) { flags.push(`[${file}] DROP FUNCTION statement: ${cleanFull.slice(0, 120)}`); continue; }
    if (/^(grant|revoke)\s/i.test(clean)) {
      let target = null, kind = 'other';
      let g;
      if ((g = new RegExp(`\\bon\\s+table\\s+${QNAME}`, 'i').exec(cleanFull))) { target = tblKey(g[1], g[2]); kind = 'table'; }
      else if ((g = new RegExp(`\\bon\\s+(?:all\\s+tables|schema|function|sequence|all\\s+functions|all\\s+sequences)`, 'i').exec(cleanFull))) { kind = g[0].toLowerCase().replace(/\s+/g, ' '); }
      else if ((g = new RegExp(`\\bon\\s+${QNAME}`, 'i').exec(cleanFull))) { target = tblKey(g[1], g[2]); kind = 'table'; }
      grants.push({ verbatim: verbatimClean, target, kind, file });
      continue;
    }
    if ((m = new RegExp(`^comment\\s+on\\s+policy\\s+(${IDENT})\\s+on\\s+${QNAME}`, 'i').exec(cleanFull))) {
      const name = unq(m[1].startsWith('"') ? m[1] : m[1].toLowerCase());
      const key = tblKey(m[2], m[3]) + '|' + name;
      const prev = policies.get(key);
      if (prev) { prev.comment = verbatimClean; prev.commentFile = file; }
      else flags.push(`[${file}] comment on unknown policy ${key}`);
      continue;
    }
    if ((m = new RegExp(`^comment\\s+on\\s+function\\s+${QNAME}\\s*\\(([^)]*)\\)`, 'i').exec(cleanFull))) {
      const fname = tblKey(m[1], m[2]);
      const args = (m[3] || '').toLowerCase().replace(/\s+/g, ' ').trim();
      // match by name; arg spelling may differ (types only vs names)
      for (const [sig, f] of fns) if (f.name === fname) f.comment = verbatimClean;
      continue;
    }
    if (/^do\s/i.test(clean)) {
      if (/(create|drop|alter)\s+policy|row\s+level\s+security/i.test(clean))
        flags.push(`[${file}] DO block contains policy/RLS DDL — REVIEW MANUALLY: ${cleanFull.slice(0, 160)}`);
      continue;
    }
    // safety net
    if (/\bpolicy\b/i.test(clean) && !/^comment\s+on\s/i.test(clean) && !/^(create\s+(table|index|unique)|insert|update|delete|select)/i.test(clean)) {
      flags.push(`[${file}] UNCLASSIFIED statement mentioning policy: ${cleanFull.slice(0, 140)}`);
    }
  }
}

// ---------- derived checks ----------
const alive = [...policies.values()].filter(p => !p.dropped && p.createText);
const droppedForever = [...policies.values()].filter(p => p.dropped);
const tables = new Map();
for (const p of alive) {
  if (!tables.has(p.table)) tables.set(p.table, []);
  tables.get(p.table).push(p);
}
for (const t of tables.keys()) {
  if (t.startsWith('public.') && !rls.has(t) && !rls.has(t.replace('public.', ''))) flags.push(`TABLE ${t} has policies but no ENABLE RLS seen in migrations`);
}
for (const [t] of rls) {
  const key = t.startsWith('public.') || t.includes('.') ? t : `public.${t}`;
  if (!tables.has(key) && !tables.has(t)) flags.push(`TABLE ${t} RLS-enabled but ZERO alive policies (deny-all by design?)`);
}
// functions referenced by alive policies
const fnNames = new Set([...fns.values()].map(f => f.name));
const referenced = new Set();
for (const p of alive) {
  for (const g of p.createText.matchAll(/\b(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
    const cand = 'public.' + g[1].toLowerCase();
    if (fnNames.has(cand)) referenced.add(cand);
  }
}

const state = {
  generatedFrom: files.length + ' migrations, last: ' + files[files.length - 1],
  counts: { createStatements: createCount, dropStatements: dropCount, alivePolicies: alive.length, droppedForever: droppedForever.length, tables: tables.size, functions: fns.size, grants: grants.length, rlsEnables: rls.size },
  policies: [...policies.entries()].map(([k, v]) => ({ key: k, ...v })),
  rlsTables: [...rls.entries()].map(([t, v]) => ({ table: t, file: v.file })),
  functions: [...fns.entries()].map(([sig, v]) => ({ sig, ...v, referencedByPolicies: referenced.has(v.name) })),
  grants,
  flags,
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'state.json'), JSON.stringify(state, null, 2));

let sum = '';
sum += `files: ${files.length}  creates: ${createCount}  drops: ${dropCount}  alive: ${alive.length}  dropped-forever: ${droppedForever.length}\n`;
sum += `tables with policies: ${tables.size}  rls-enables: ${rls.size}  functions: ${fns.size} (${referenced.size} referenced by policies)  grants: ${grants.length}\n\n`;
sum += `== FLAGS (${flags.length}) ==\n${flags.join('\n')}\n\n`;
sum += `== DROPPED FOREVER ==\n${droppedForever.map(p => `${p.table}|${p.name}  [${p.history.join(' ')}]`).join('\n')}\n\n`;
sum += `== TABLES ==\n`;
for (const [t, ps] of [...tables.entries()].sort()) sum += `${t}: ${ps.map(p => `${p.name}@${p.file.split('_')[0]}`).join(', ')}\n`;
sum += `\n== FUNCTIONS referenced by policies ==\n`;
for (const f of [...fns.values()].filter(f => referenced.has(f.name)).sort((a, b) => a.name.localeCompare(b.name))) sum += `${f.name}(${f.args})  last@${f.file}\n`;
fs.writeFileSync(path.join(OUT_DIR, 'summary.txt'), sum);
console.log(sum.slice(0, 6000));
