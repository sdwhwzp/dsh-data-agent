# DSH 0.2.0-rc.1 compatibility

Plugin **0.2.1** targets exactly **DSH 0.2.0-rc.1**. Plugin 0.2.0 declared the previous 0.1.7-rc.1 host and peers, so the new host correctly refused to activate it. This migration updates that contract and validates the existing implementation against the target; it does not bypass the host compatibility gate.

## Baseline and target

- Baseline: commit `3016f67`, plugin 0.2.0, DSH 0.1.7-rc.1. Typecheck, build and 443 tests passed; three optional external-database tests skipped.
- Target: all 278 installed official DSH packages resolve to 0.2.0-rc.1. Direct host/peer declarations and the lockfile are aligned; Web peers remain optional. Cordis remains 4.0.4.
- Environment: macOS arm64, Node 25.9.0, pnpm 11.20.0 and the local SQLite CLI. The RC is pinned explicitly, independent of npm's moving `latest` tag.
- Primary evidence: [0.1.7-rc.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2), [0.2.0-rc.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.1), and the installed exact-version implementations and declarations of consumed DSH packages. Intermediate releases were not each runtime-tested; compatibility claims apply only to the target.

## Contract review

| Boundary | Classification and impact | Regression evidence |
| --- | --- | --- |
| Host and peer compatibility | Breaking: the exact old host range rejects activation on 0.2.0-rc.1. | Package/manifest consistency and every official DSH dependency are checked; the packaged artifact cold-starts on the exact target. |
| Preset seat | Breaking/behavior: `showPresetPicker` / `useShowPresetPicker` becomes `developerTools` / `useDeveloperTools`; `showPicker` leaves seat state. | Update test doubles to the real target contract. The existing generic wrapper already forwards the host face. Tests assert hook identity and that the host preference hides its picker while a default data-mode connection action remains accessible. |
| Preset registry | Breaking: `modeSelectionEnabled` is removed. This plugin does not use it; public register/mount/select ownership remains intact. | Packaged CLI verifies eight scoped tools, blank-session selection, disposal, re-registration and resumed session history. |
| Session/controller and LLM | Additions include default model/fork hooks and tool-history projections; the consumed session selection and auxiliary `RequestUserInput` contracts remain supported. | Client typecheck, Catalog AI request assertions, workbench handoff tests and the real persisted tool turn pass. New host capabilities are not adopted. |
| UI primitives, commands and tools | Consumed icons, modal/tooltip, slots, tool registration and inherited restrictions remain supported. | Host/client typecheck, browser bundle purity, component, command, scope and tool tests pass. |

No plugin business source or SQL behavior needed changing. Rebuilt `lib/client.js` differs only in generated CSS-module map property order; generated artifacts were not edited by hand.

## Seven touchpoints

| Touchpoint | Finding and validation |
| --- | --- |
| Source patches | The two-row `cordis.patch.yml` is a host bundle, with no upstream monkey patch. The packaged CLI loads it normally. |
| Events | Shared storage, session projections and Catalog event handling remain unchanged. Persistence, report replay and workbench subscription tests pass; runtime resumes the same persisted session after preset reload. |
| Services / Remote | Shared connection/Catalog services, public registry registration and host Web routes retain their contracts. Service and route tests cover failures and cancellation; no private host maps are used. |
| Host filesystem | Preset customization and adjacent files are preserved by existing tests. The native CLI test owns a temporary home, profile, storage, session log and workspace. |
| UI / commands / tools | Target seat hooks are forwarded; component tests exercise both developer-tools settings. Real Loader registration, headless gating and disposal pass. Interactive TUI PTY is outside this validation. |
| Custom channels | No custom server or new transport is introduced. Existing HTTP routes use the host Web service; route validation and redaction tests pass. |
| Subprocess / output | Database execution stays shell-free. Tests cover argv/stdin, environment, output limits and aborts. The packaged test runs native Node and SQLite with a deadline, checks process completion and independently confirms unchanged fixture database bytes. |

## Completed checks

`pnpm install --no-frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm conformance`, `npm pack --dry-run --json --ignore-scripts` and `git diff --check` passed. The target suite has **444 passed / 3 skipped tests**, across 38 passing files and one skipped file. Conformance is the repository's fixture-backed **Parsed** level, not external attestation.

`tests/packaged-runtime.spec.ts` packs and extracts the artifact, links its dependencies to the repository's exact installed graph, and launches the target native CLI in an isolated profile. The LLM is scripted; the Loader, agent loop, registry, SQLite tool/subprocess and session persistence are real. It verifies message → SQL tool → reply (total 42), tool visibility, unload/reload, history restoration and an inline snapshot. This is not a second clean network installation or a real provider API test.

Not verified: real model/provider APIs, non-fixture databases (three optional tests skipped), interactive TUI PTY, Electron ASAR, Windows/Linux, Docker, or arbitrary prior user-session replay. No non-fixture database was accessed.

## Authorized local Web repair

After the isolated tests, the current Web profile was backed up and the artifact installed through the official DSH plugin manager. The four user-designated abnormal packages (`dsh-gomoku`, `dsh-museai-tavern`, `dsh-plugin-registry-bundle`, `dsh-ppt`) were removed from profile dependencies and bundles. Their source repositories and existing sessions were not deleted.

After a full service restart, the real browser showed exactly three installed plugins without abnormal badges: data-agent 0.2.1, official Agent Team and dsh-web-all 0.4.3. Data-agent's host and route entries both showed running. The new-session preset picker offered data mode, and selecting it rendered the database-workbench control; the previous standard-mode selection was then restored. No database connection was opened. The inspected browser error log was empty.

The local profile and packed 0.2.1 artifact are retained under `~/.dsh/upgrade-backups/20260928-231333-data-agent-0.2.1-repair`. This is a local install only; no registry publication, Git push or release was performed.
