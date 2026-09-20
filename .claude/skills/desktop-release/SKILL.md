---
name: desktop-release
description: Prepare a release of the Squorli desktop app - work out what changed since the last desktop tag, propose sensible version numbers, set the chosen version in apps/desktop/package.json and write the release notes that the GitHub release is filled with. Use when the user wants a new desktop app version, release notes or a changelog for the app.
---

# Desktop release: version and release notes

Run from the `squorli-server` repository. Read `apps/desktop/AGENTS.md` (section "Packaging and releases") first; it owns the
release procedure, this skill only prepares it. Replies to the user are in German; everything written into the repository is
English.

**This skill never tags, pushes, publishes or deploys.** It edits files and stops. Commit only if the user asks.

An optional argument is the version to set (`/desktop-release 0.2.0`); then skip the proposal in step 3 and only check it.

## 1. Find the last release

- `git tag --list "desktop-v*" --sort=-v:refname | head -5` and the `version` in `apps/desktop/package.json`.
- The base is the newest `desktop-v*` tag. If `package.json` already names a version that has no tag yet, that version is
  being prepared: keep it unless the user wants another, and write or update its notes.
- If the tag for the version in `package.json` exists already, a new number is needed. If that tag is already pushed
  (`git ls-remote --tags origin "desktop-v<version>"`), say that its release was built without these notes and that the
  notes file can only be pasted into that release by hand.

## 2. Collect what changed for the app

The app is an Electron shell around the web client, so a change counts when it touches `apps/web/`, `apps/desktop/` or
`packages/protocol/`. Server-only changes (`apps/server/`, `deploy/`) ship with the server image, not with the app.

- `git log <base>..HEAD --format="%h %ad %s" --date=short -- apps/web apps/desktop packages/protocol`, and
  `git diff --stat <base>..HEAD -- apps/web apps/desktop packages/protocol`. Include uncommitted work (`git status --short`):
  it will be part of the release once committed.
- Commit subjects in this repository are terse. **The real source is `docs/MILESTONE-LOG.md`**: every row dated after the
  row of the last desktop version, plus the entries of the same dates in `docs/features/*.md` for anything unclear.
  Read them; do not guess from file names.
- Drop what no app user can notice: phone and tablet layout (the app never runs there), refactoring, tests, docs, tooling.
  Keep what needs a newer server to work and say so in the note.

## 3. Propose version numbers

Semantic versioning, with the project still below 1.0. Offer the realistic candidates with one line of reasoning each and
recommend one:

- **Patch** (`0.1.8` -> `0.1.9`): only fixes and small improvements; nothing a user has to learn.
- **Minor** (`0.1.8` -> `0.2.0`): new features or settings a user can see, a new bridge member or IPC channel
  (`IPC` in `apps/web/src/platform/bridge.ts`), a change of `PROTOCOL_VERSION`, or anything that needs a newer server.
- **Major** (`1.0.0`): never proposed on its own. Only if the user says the app leaves its preview state.

Check before proposing: the number is greater than every existing `desktop-v*` tag, and its tag does not exist yet. Note
that the history so far raised only the patch number even for features; say which rule the recommendation follows and let the
user decide. Ask with AskUserQuestion (recommended option first) unless a version was passed as the argument.

## 4. Set the version

- `apps/desktop/package.json`: `"version"`. Nothing else carries the app's version (the lock file does not).
- `docs/MILESTONE-LOG.md`: one new row at the top of the table, in the style of the earlier "Desktop app version …" rows:
  what the version carries, what ships with the server image instead, and "Not tagged yet.".

## 5. Write the release notes

File: `apps/desktop/release-notes/<version>.md`. The release workflow (`.github/workflows/desktop-release.yml`) puts this
file into the GitHub draft release, followed by its standing text about the installers, so do not repeat that text and do
not add a title (the release is titled "Squorli Desktop <version>").

Written for people who use the app, not for developers:

- English, plain words, what the user can now do or no longer suffers from. No file names, function names, IPC channels,
  issue history or internal reasons.
- Sections `## New`, `## Improved`, `## Fixed`, in that order; leave out an empty one. One bullet per change, the most
  noticeable first. A new feature starts with a short bold name, then one or two sentences, with the place in the settings
  where it lives.
- Say when something needs an up-to-date server, or only applies to Windows or Linux.
- Only what is in the milestone log and the code. Nothing planned, nothing unverified presented as working: if the feature
  note lists a platform under "not checked", do not promise it for that platform.
- Short. A release with ten changes fits on one screen.

Use `apps/desktop/release-notes/0.1.8.md` as the model.

## 6. Check and hand over

- `pnpm typecheck` is not needed for these files; do run `git status --short` and show which files changed.
- Show the user the notes in the reply (in German: a short summary plus the English text as written).
- End with what remains for them, in order: commit, tag `desktop-v<version>` on that commit and push it, test and publish
  the draft on GitHub, then `pnpm desktop:release` and the deployment in `squorli-website`. If the changes need the server
  image too, say that it goes out before the app.
