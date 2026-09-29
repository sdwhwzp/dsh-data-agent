# DSH 0.2.0-rc.2 compatibility

Plugin **0.2.2** is developed and runtime-tested against **DSH 0.2.0-rc.2**. Following the requested compatibility-range change, `dsh.engines.dsh` and official DSH peers declare **`>=0.2.0-rc.1`**, while development dependencies remain pinned to rc.2. This range is an activation declaration, not evidence that every admitted version has been runtime-tested. The previous plugin 0.2.1 pins the rc.1 host and peers, so rc.2 rejects its activation. This migration updates the declared compatibility boundary and verifies the existing shared implementation on rc.2.

## Baseline and target

- Baseline: commit `9f052d9c17501a91507f445adb3278a95f6edfdb`, plugin 0.2.1, repository dependencies on DSH 0.2.0-rc.1. Typecheck, build and 444 tests passed; three optional external-database tests skipped. No pre-existing test failure was found.
- Target: all 278 installed official DSH packages resolve to 0.2.0-rc.2. Development declarations and the full lockfile agree on this exact baseline; host and peer declarations admit `>=0.2.0-rc.1`, and Web peers remain optional. Cordis stays at 4.0.4. Existing release-age exceptions are retained and the exact rc.2 cohort is added.
- Environment: macOS arm64, Node 25.9.0, pnpm 11.20.0 and the local SQLite CLI.
- Primary evidence: the [rc.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2), the [exact tag comparison](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.0-rc.1...dsh-v0.2.0-rc.2), and installed rc.1/rc.2 package implementations and declarations. Tag commits are `4878cdabd87d4041bdaff61d04c966883b9fd07a` and `639ed015397290b3745d163aafe02ffee4aa3f84`. The comparison API caps its file list at 300; it was not treated as a complete source diff. The skill's historical version cards do not cover this edge, so conclusions use exact-version packages and runtime checks.

## Contract and regression ledger

| Boundary | Classification and impact | Evidence |
| --- | --- | --- |
| Host and peer compatibility | Breaking: the exact rc.1 gate rejects rc.2. | Updated package assertions, coherent lockfile and a packaged-artifact cold start on rc.2. Plugin SemVer advances independently to 0.2.2 in both manifests. |
| Human questions | Behavior: `UserQuestionService` becomes a Typert remote service; `ask` now requires a supplied agent to be the exact live root. Timed questions are an added capability. | The packaged database command runs against the real rc.2 question service with a live agent. No answerer returns the actionable fallback, an aborted request never reaches the answerer or establishes a connection, and two blocking question rounds establish a real read-only SQLite connection. Timed questions are not adopted. |
| Preset settings and new-session seat | Settings remove their developer-tools dependency; the seat contract consumed by this plugin is unchanged. | Exact published declarations, host/client typecheck, existing seat-hook forwarding tests, and the actual Web data-mode workbench entry. No settings integration is added. |
| Tool views and UI primitives | New question panels and optional primitive capabilities are additive. The consumed tool-view, modal, tooltip and slot contracts remain supported. | Typecheck, browser-bundle purity, component tests, and actual Web workbench rendering. |
| Preset registry, session, LLM, storage and subprocess | Consumed declarations remain unchanged. | Real registry selection, scoped tools, SQLite execution, persisted message → tool → reply, unload/reload and session restoration. |

No plugin business source, SQL behavior, presets, storage schema or user-data migration needed changing. `lib/**` was rebuilt; the browser artifact changes only generated CSS-module map property order.

## Seven touchpoints

| Touchpoint | Finding and validation |
| --- | --- |
| Source patches | `cordis.patch.yml` remains a two-row composition, not an upstream source patch. Real Loader activation passes. |
| Events | Existing command notifications, plugin lifecycle observers and session projections keep their contracts. The new runtime fixture uses the real scoped `user-questions/request` waterfall; model history and preset lifecycle checks pass. |
| Services / Remote | Shared connection/Catalog services retain ownership. The changed question service is covered through the exact product entry; missing providers and cancellation remain safe. |
| Host filesystem | The preset customization tests pass. Runtime tests own a temporary home, profile, workspace, connection records and session logs. The SQLite fixture is checked byte-for-byte after execution. |
| UI / commands / tools | Eight preset tools remain visible; human database commands remain absent without the TUI runtime. Existing component tests pass, and a real isolated Web host opens the data-mode database workbench. |
| Custom channels | Routes continue using the host Web service; no new server or authentication path is introduced in the plugin. Existing route validation/redaction tests and actual Web loading pass. |
| Subprocess / output | Execution stays shell-free, with argv/stdin, cancellation and output-budget regressions. The packaged native CLI must exit successfully within its timeout after a SQLite sum of 42. |

## Completed validation and limits

- `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm conformance`, package inspection and `git diff --check` pass. The final suite has **444 passed / 3 skipped tests**, across 38 passing files and one skipped file. Conformance remains fixture-backed **Parsed**, not external attestation.
- `tests/packaged-runtime.spec.ts` packs and extracts the artifact, links it to the exact repository dependency graph and starts the real native DSH CLI. Only the model and human answerer are scripted; the Loader, agent loop, question service, connection validation, SQL tool, subprocess and persistence are real. Its inline snapshot includes the two successful connection-question rounds.
- An independently extracted 0.2.2 artifact was loaded in a temporary Web profile on an OS-assigned loopback port. Chrome rendered data mode and opened the database workbench. No database connection or model request was made in that browser check; the temporary service was stopped afterward.
- Not verified: real model/provider APIs, non-fixture databases, interactive TUI PTY, Desktop/Electron ASAR, Windows/Linux, Docker, a clean network installation of the artifact, or arbitrary prior user-session replay. Browser validation covers the entry and workbench opening, not every UI interaction.

## Scope and recovery

The repository's pre-existing uncommitted files are preserved. This change does not install into a real DSH profile, publish a package, push Git commits, or create a release. To revert this migration, restore only its package/lock/workspace files, version manifest, README changes, runtime-test changes and this record to the baseline, reinstall the baseline lockfile and rebuild generated files. Preserve unrelated work and align the AOCI records afterward. This does not promise reversal of arbitrary package-manager cache or third-party installation side effects.
