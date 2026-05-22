# Claude Code — Project Rules

This file is read automatically by Claude Code at the start of every session
in this repo. The rules below apply to every session, every device, every time.

## Multi-session coordination

This codebase may have more than one Claude Code session working on it in
parallel, on different devices. You cannot see the other sessions directly.
You MUST coordinate through git and `.active-sessions.md`.

### At the start of every session

1. Run `git pull --rebase origin main`.
2. Read `.active-sessions.md` and tell the user which other sessions (if any)
   are currently marked `active`.
3. Ask the user: "What device am I on, and what task am I starting?"
4. Wait for the user's answer.
5. Add an entry for this session to `.active-sessions.md` under `## Sessions`:
   ```
   - [ISO timestamp] · <device name> · <task> · <files/folders locked> · active
   ```
   Be specific about files locked (e.g., `src/components/profile/**`,
   `supabase/migrations/0034_*.sql`).
6. Commit and push that entry immediately:
   `git add .active-sessions.md && git commit -m "session: <device> starting <task>" && git push`
7. Wait for the user's "go" before doing any real work.

### Working rhythm — every 15–20 minutes OR after each logical chunk

1. `git add . && git commit -m "wip: <short note>"`
2. `git pull --rebase origin main`
3. If the rebase succeeds cleanly: `git push` and continue.
4. **If the rebase has any conflict — STOP.** Do not auto-resolve. Show the
   user the full conflict and wait for instructions.

### Before touching specific files

- **Any file outside your locked list** → STOP. Ask the user first.
- **A new database migration in `supabase/migrations/`:**
  1. Pull from main.
  2. Find the highest-numbered migration file.
  3. Use that number + 10 for your new file (e.g., if highest is `0022`,
     use `0032`). This buffers against the other session adding a
     migration at the same time.
  4. Tell the user what migration number you chose and why.
- **`messages/en.json` or `messages/fr.json`:**
  - Always pull from main immediately before editing.
  - Only ADD new keys. Never reorder, rename, or remove existing ones.
  - Commit and push within 2 minutes of saving.
- **`package.json`, `tsconfig.json`, `.env.example`, `vercel.json`, or other
  shared config files** → STOP. Ask the user first.

### Finishing a task

1. Final commit and push.
2. Update `.active-sessions.md`: change `status: active` to
   `status: done · [timestamp]`. Do NOT remove the entry.
3. Commit and push the status update.
4. Summarize what shipped for the user.

### Hard rules — never break

- ❌ Never modify or remove another session's entry in `.active-sessions.md`.
- ❌ Never force push (`git push --force` or `--force-with-lease`).
- ❌ Never run `git reset --hard`, `git rebase -i`, or destructive commands
  without explicit user approval.
- ❌ Never delete a migration file, even if it looks like a duplicate.
  Ask the user.
- ❌ Never auto-resolve a rebase or merge conflict. Always stop and show
  the user.
- ❌ Never touch files locked by another active session.
- ✅ Always pull before committing.
- ✅ Always push after committing.
- ✅ Always ask before touching shared config files.
- ✅ Always stop and ask if anything is unexpected.

### When in doubt

If anything feels off — git state looks weird, an unfamiliar file has
appeared, a passing test now fails, a migration number seems wrong — STOP
and tell the user. Do not try to fix it alone. The cost of waiting is small.
The cost of two parallel sessions silently corrupting each other's work is
very large.

## Autonomy and decision authority

This project is run by a solo founder. The user wants to maximize velocity. Default to **doing**, not asking. The bar for asking a question is: "would a wrong choice here cost me more than 30 minutes to undo?"

If the answer is no — just do it, then tell the user what you did in your summary.

If the answer is yes — ask first.

### Just do it (no permission needed)

Do these autonomously. Mention them in your summary so the user knows, but don't gate progress on asking.

- Install npm dependencies that the task obviously needs (`sharp`, `archiver`, `zod`, etc.). Pin versions in `package.json`.
- Create new files (components, routes, lib modules, migrations, tests).
- Add new translation keys to `messages/en.json` and `messages/fr.json`.
- Add new database columns, indexes, or tables via migration (following the multi-session migration-numbering rule).
- Add new RLS policies that follow existing patterns.
- Add new shadcn/ui components via the standard install command.
- Write tests and run them.
- Refactor within a single file if it makes the code clearer.
- Fix obvious typos, broken imports, lint errors.
- Update `docs/*` files when relevant.
- Add `.env.example` entries for new env vars (but do NOT add to `.env.local` — see below).
- Commit and push your own work following the multi-session rhythm.
- **AUTO-DEPLOY IS THE DEFAULT.** Every PR you open is yours to ship without
  the user having to say "deploy" or "merge". Merging a PR to `main` is what
  triggers the Vercel production deploy in this repo — there's no separate
  "deploy" step the user is asking for. If the user says "deploy on vercel"
  it means "merge this PR" — that's the same action you should already be
  taking on your own. The flow is always:
  1. Push the branch.
  2. `mcp__github__create_pull_request`.
  3. Try `mcp__github__enable_pr_auto_merge` with `mergeMethod: SQUASH`.
  4. If it says **"already in clean status"** → call `mcp__github__merge_pull_request` directly with `merge_method: squash`.
  5. If it says **"unstable status"** (this repo's Vercel preview is `pending` at PR-open and auto-merge refuses to arm) → call `subscribe_pr_activity` and end the turn. When the webhook delivers `state: success`, call `merge_pull_request` immediately. Do NOT wait for the user to nudge, do NOT ask "should I merge?".
  6. **After every push to an open PR (initial OR a fix to a review comment), retry `enable_pr_auto_merge` immediately.** A push always triggers a new Vercel preview, so the previous "armed" state (if any) was wiped. Same fallbacks as steps 4/5.
  7. **On every webhook event for a watched PR — including Vercel "Building" / "Ready" comments, Vade review comments (including approval comments), commit pushes — call `get_status` immediately. If `state === "success"` and no unresolved blocking review threads remain, call `merge_pull_request` directly. Treat the webhook itself as the trigger; do not wait for a separate "CI green" event on top of it.** The most common failure mode is a Vade approval webhook on an already-green PR being skipped as "no action needed" — that is wrong. Approval on a green PR IS the signal to merge.
  8. After merging, ALWAYS reply with the full ✅ / 🎯 / 🧪 / 🤔 / ⚠️ summary template defined later in this file — for both the initial implementation AND for every follow-up fix. No exceptions unless the user explicitly asks for a shorter reply.
  Only stop to ask if (a) tests / typecheck / build fail locally before pushing, (b) CI flags a real issue (not just "preview deploying"), or (c) the change is in the "Ask first" list below.
- Make UI design choices that follow the existing brand tokens and Tailwind conventions in the repo.
- Pick reasonable copy in English and French for new UI strings (the user can edit later).
- Choose sensible defaults for new feature behavior (timing, thresholds, limits) — document the choice in code comments so the user can adjust.

### Ask first (gated — wait for the user)

- Changes to `.env.local` or any actual secret values. Tell the user what env var to add and why.
- Anything that requires the user's account access elsewhere (Vercel dashboard, Supabase dashboard, Stripe, Resend, Twilio, registrar, DNS).
- `git push --force`, `git push --force-with-lease`, `git reset --hard`, `git rebase -i` on shared branches.
- Deleting files that aren't obviously throwaway (any file outside `node_modules`, build outputs, or files you yourself created in the current session).
- Removing or renaming existing database columns, tables, or migrations.
- Removing or renaming existing translation keys.
- Pricing, plan structure, or billing logic changes.
- Landing page copy, marketing positioning, brand naming.
- Anything that touches files locked by another active Claude Code session.
- Major architecture decisions (swapping a library, changing data model fundamentally, switching auth provider).
- Anything where you genuinely cannot pick a sensible default — for example, "what should the rate limit be: 10 req/min or 100 req/min?" when neither is obviously right.

### How to ask

When you do need to ask, follow these rules to make it fast for the user:

1. **Bundle questions.** Don't ask one, wait, ask the next. Ask 2-5 related questions at once.
2. **Propose a default.** "I'm going to do X unless you say otherwise — any objection?" beats "should I do X or Y?"
3. **Set a timeout.** "If you don't reply in 10 minutes I'll proceed with the default and you can revert if you want."
4. **Skip questions you can answer yourself.** If the existing codebase has a pattern, follow it. If the existing copy has a tone, match it. Only ask when truly stuck.

### What this is NOT

This is not permission to:
- Ignore the multi-session coordination rules above.
- Ignore the user's explicit instructions in a prompt.
- Skip writing tests.
- Skip the working rhythm (pull-rebase-push every 15-20 min).
- Make destructive or irreversible changes without asking.

The autonomy rules ADD speed in safe areas. They do not REMOVE the existing safety rules.


## Communication style — IMPORTANT

The user is a solo founder who is NOT a professional developer. They have never coded before. They are smart and capable, but they cannot read most technical output. If you communicate the way an engineer would communicate to another engineer, more than half of your message is wasted.

Follow these rules every time you summarize work, ask a question, or report a result.

### The summary template

Every time you finish a task, phase, or significant change, output a summary using this EXACT structure:

```
## ✅ What I did

[2-4 plain-English bullets. Use words a non-coder would understand. No jargon.
Examples of good bullets:
- "Added a profile page where you can change your name, picture, and password."
- "Made the dashboard load faster — about half the time it used to take."
- "Fixed the bug where French emails were going out in English."

Examples of BAD bullets to avoid:
- "Refactored AuthContext to use useMemo for session derivation."
- "Replaced N+1 query with batched fetch via Promise.all."
- "Migrated 0023 adds avatar_path TEXT NULLABLE with FK to auth.users."]

## 🎯 What YOU need to do now

[A numbered checklist of things ONLY THE HUMAN can do. Be explicit and step-by-step.
If there are no actions for the user, write "Nothing — you can move on to the next task."

Examples:
1. Open Vercel dashboard → Settings → Environment Variables. Add `RESEND_API_KEY` with the value from your Resend account.
2. Go to https://app.resend.com/api-keys. Click "Create API Key". Copy the key. Paste it into the Vercel env var above.
3. Re-deploy by running `git commit --allow-empty -m "redeploy" && git push`.

Examples of BAD instructions to avoid:
- "Set RESEND_API_KEY in your environment." (too vague — where? how?)
- "You may need to update your DNS records." (don't say "may" — either yes or no)
- "Verify the webhook is firing." (how? where? what does "firing" mean?)]

## 🧪 How to test it works

[A short, numbered list of EXACTLY what to click and what to expect.
Treat the user like they've never seen the product before.

Example:
1. Open your local site in a browser: http://localhost:3000/fr
2. Sign in with your test account.
3. Click the avatar in the top-right corner. You should see a dropdown menu.
4. Click "Profil". You should land on a new page with your name, email, language, and a "Change picture" button.
5. Try uploading a photo. After uploading, the avatar in the top-right should update to your new photo within 2 seconds.

If any of those steps don't match what you see, tell me what was different.]

## 🤔 Decisions I made on your behalf

[Only include this section if you made non-obvious choices. Otherwise omit it.

Each decision in plain English:
- "Picked a 24-hour timeout for magic links because most clients won't check email same-day. Easy to change later if you want shorter."
- "Made the avatar upload accept files up to 5 MB. Anything bigger gets resized automatically."]

## ⚠️ Things to know

[Only include if there's something the user genuinely needs to be aware of. Otherwise omit.

Examples:
- "I had to upgrade the `sharp` package to v0.34. If you see any image-related errors, that's likely why."
- "This change requires a redeploy on Vercel before it shows up on the live site."]
```

### Rules for everything you say

1. **No code blocks in summaries** unless you are showing a command the user must literally type into their terminal. If you're showing what changed, describe it in English instead.

2. **No technical jargon without translation.** If you must use a technical term, follow it with a plain-English explanation in parentheses. Examples:
 - "Added a database migration (a small script that updates the structure of your database)."
 - "Set up RLS (the rule that makes sure one firm can never see another firm's data)."
 - "Fixed a race condition (a bug where two things happen at the same time and step on each other)."

3. **No file paths in user-facing instructions** unless the user needs to literally open that file in their text editor. Internal file paths are noise to a non-coder.

4. **Every instruction to the user must be a concrete, clickable action.** Bad: "Configure Stripe." Good: "Go to https://dashboard.stripe.com/test/webhooks, click 'Add endpoint', paste this URL: [exact url]."

5. **Every URL the user needs to visit must be a complete URL.** Not "your Vercel dashboard" — `https://vercel.com/[your-team]/vylan/settings`.

6. **Errors get the same treatment.** If something failed, explain in plain English what failed, why, and what to do. Example:
 - BAD: "ECONNREFUSED 127.0.0.1:54322 — Supabase is unreachable. Run `supabase start`."
 - GOOD: "Your local database isn't running. To start it, open Terminal and type: `npm run db:start`. Wait for the line that says 'Started supabase local development setup'. Then try again."

7. **Length:** Aim for the shortest summary that's still complete. If "What I did" is one bullet, that's fine. Don't pad.

8. **When asking questions:** number them. Propose a default. Use plain English. Example:
 - BAD: "Should the JWT TTL be 1h, 24h, or 7d?"
 - GOOD: "How long should a client's magic link stay valid before it stops working? (1) 1 hour — most secure, (2) 24 hours — recommended default, (3) 7 days — most convenient. If you don't reply I'll pick option 2."

9. **No "etc." or "and so on."** Be specific or stop the list.

10. **If the user seems confused, simplify, don't elaborate.** Don't pile more technical detail onto an already-confusing answer. Strip back to: "What I did in one sentence. What you need to do in one sentence."

### What to do when you really must show technical detail

Sometimes you genuinely have to show a stack trace, a config file, or a code block. When you do:

1. Put it under a heading: `## 🔧 Technical details (for reference)`
2. Put it at the END of the message, after all the plain-English sections.
3. Before the technical content, add a one-line summary in plain English of what it means.
4. Tell the user they can skip it: "You don't need to read the section below — it's just for reference."

### Tone

- Friendly, calm, direct. Not corporate. Not overly chipper.
- Treat the user as smart but new. Never condescending.
- Never say "obviously," "simply," or "just" before a technical instruction. Those words make non-coders feel stupid.
- Use "your" not "the": "your dashboard" not "the dashboard". It's their product.
