# CLAUDE.md

@AGENTS.md

The project description is split by area so that it does not fill the context (17 September 2026, user's wish): the root `AGENTS.md` imported above holds what every task needs (commands, definition of done, cross-cutting conventions, the map in its section 0); each area has its own `AGENTS.md` (`apps/server/`, `apps/web/`, `apps/web/src/voice/`, `packages/protocol/`, `deploy/`, `tools/`) with a `CLAUDE.md` next to it that only imports it, so Claude Code loads it when it works in that folder; feature notes live in `docs/features/`, the history in `docs/VERIFIED-STATE.md` and `docs/MILESTONE-LOG.md`. Only rules that apply specifically to Claude Code go here.

## Maintaining these files

- The `AGENTS.md` files and `docs/features/` are the single source of content. Changes to structure, scripts, environment variables, protocol, milestone status or known pitfalls are **updated there immediately**, in the same work step as the code change, in the file the root `AGENTS.md` section 0 names. Do not grow the root `AGENTS.md`: feature entries go to `docs/features/<feature>.md`, area rules to the area's `AGENTS.md`.
- Before changing a feature, read its notes in `docs/features/` (they are not loaded automatically); for a task that spans areas, read each area's `AGENTS.md`.
- Add only Claude-specific content to `CLAUDE.md`. The `CLAUDE.md` files in subfolders contain nothing but `@AGENTS.md`. Do not duplicate content, otherwise the files drift apart.
- After every complete test run (typecheck, test, smoke, build), add an entry at the top of `docs/VERIFIED-STATE.md` and a row at the top of the table in `docs/MILESTONE-LOG.md` (date, result, fixed errors).
- Documentation, READMEs and AI instructions (this file, AGENTS.md, docs/, deploy READMEs, comments in env templates and deploy configs) are always written in English (decision of the user, 14 September 2026). Code comments are English too (confirmed by the user, 17 September 2026). UI texts are bilingual German/English and come from the i18n catalogs (`apps/web/AGENTS.md`).

## Working in this repo

- Before changing the server or the protocol, read `docs/PLAN.md` for the affected section; the plan is the basis for decisions, not the code.
- After every change run at least `pnpm typecheck` and `pnpm test`. For server/auth/protocol changes additionally start the server and run the smoke test.
- Use `pnpm dev` for testing (starts and stops the containers itself); create `apps/server/.env` from `.env.development` if it is missing. For pure container work `pnpm docker:dev`.
- Stop background processes after testing. On Windows, afterwards check `netstat -ano | grep ":3000 " | grep -E "ABH|LISTEN"` (German Windows prints `ABHÖREN`, never filter for `LISTEN` only) and remove leftovers with `taskkill //F //T //PID`; check the containers with `docker compose -f deploy/compose.dev.yml ps`. Never stop the user's dev server on :3000/:5173; run smoke tests against your own server on :3001 with the DB `chat_smoke`.
- On Windows the shell commands run in Git Bash; paths with forward slashes, log files go to the scratchpad directory, not into the repo.
- Keep the style of the existing code (compact notation; comments in English; ae/oe/ue instead of umlauts in identifiers and developer log lines, real umlauts in everything a user sees). Do not introduce linters/formatters unless the user asks for it.
- Reply to the user in German.
