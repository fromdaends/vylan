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
