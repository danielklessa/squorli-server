# CLAUDE.md

@AGENTS.md

The entire project description (structure, commands, conventions, definition of done, pitfalls, verified status) lives in `AGENTS.md` and is imported above. Only rules that apply specifically to Claude Code go here.

## Maintaining these files

- `AGENTS.md` is the single source of content. Changes to structure, scripts, environment variables, protocol, milestone status or known pitfalls are **updated there immediately**, in the same work step as the code change.
- Add only Claude-specific content to `CLAUDE.md`. Do not duplicate content, otherwise the files drift apart.
- After every complete test run (typecheck, test, smoke, build), update section 8 "Verified state" and the table in section 9 in `AGENTS.md` (date, result, fixed errors).
- Documentation, READMEs and AI instructions (this file, AGENTS.md, docs/, deploy READMEs, comments in env templates and deploy configs) are always written in English (decision of the user, 14 September 2026). Code comments and UI texts stay German.

## Working in this repo

- Before changing the server or the protocol, read `docs/PLAN.md` for the affected section; the plan is the basis for decisions, not the code.
- After every change run at least `pnpm typecheck` and `pnpm test`. For server/auth/protocol changes additionally start the server and run the smoke test.
- Use `pnpm dev` for testing (starts and stops the containers itself); create `apps/server/.env` from `.env.development` if it is missing. For pure container work `pnpm docker:dev`.
- Stop background processes after testing. On Windows, afterwards check `netstat -ano | grep ":3000 " | grep -E "ABH|LISTEN"` (German Windows prints `ABHÖREN`, never filter for `LISTEN` only) and remove leftovers with `taskkill //F //T //PID`; check the containers with `docker compose -f deploy/compose.dev.yml ps`. Never stop the user's dev server on :3000/:5173; run smoke tests against your own server on :3001 with the DB `chat_smoke`.
- On Windows the shell commands run in Git Bash; paths with forward slashes, log files go to the scratchpad directory, not into the repo.
- Keep the style of the existing code (German in comments, ae/oe/ue instead of umlauts in code, compact notation). Do not introduce linters/formatters unless the user asks for it.
- Reply to the user in German.
