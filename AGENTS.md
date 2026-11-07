# Repository instructions

- `SPEC.md` is normative. Current documentation starts at `docs/README.md`.
- Keep native parser, parser adapter, normalized domain, factual features, scoring, artifacts/database, API and UI as separate boundaries.
- Never infer stable team identity from T/CT; team IDs are roster-based and side is round-specific.
- Missing parser values stay `null`/unavailable. Never invent evidence, convert unknown to zero or call a synthetic fixture real-demo validation.
- Ordinary deaths are facts, not tactical blame. H2 is experimental, uncalibrated and non-causal.
- Do not run real `.dem`, golden real-demo tests, Docker, an owner database/data root, SQLite migration or mass archives without explicit owner permission. When the owner explicitly authorizes a disposable development environment, use only the named test database, data root and demo paths; that authorization does not extend to production or unrelated owner data.

## Architecture

- `packages/parser-adapter` owns demoparser2 calls, aliases and decoding. `packages/match-domain` accepts parser-neutral `NormalizationInput` and must not import the adapter.
- `packages/features` emits deterministic factual analytics only. Scoring/ranking/blame labels belong to `packages/scoring`.
- `packages/artifacts` owns bounded reads, binding/integrity checks and immutable publication. `packages/database` owns Prisma repositories and lease/fencing transactions.
- API controllers validate transport and delegate to application use cases. Use cases orchestrate; domain functions compute; infrastructure performs I/O. Do not put formulas in controllers/repositories or Prisma/filesystem/environment access in pure calculations.
- The worker owns parsing, normalization/features/scoring/replay pipelines, leases, publication and recovery. API GETs read stored artifacts and must not reopen demos.
- Frontend `apps/web` renders versioned DTOs. It must not import parser/database/features/scoring implementations or reproduce backend formulas.

## Design and compatibility rules

- Prefer an existing module and public entry point. Add a module/package only for a distinct responsibility, not to bypass an inconvenient API.
- New internal names describe domain roles. Do not introduce historical M3/M3C8/P72/C2S2 names except immutable schema/version IDs, policy IDs/digests and documented compatibility adapters.
- Use classes for stateful lifecycles/external dependencies; use pure functions for formulas, normalization and deterministic transformations. Do not add interfaces/abstract bases without a real substitution or lifecycle boundary.
- One module has one main reason to change. Keep side effects at composition roots and inject parser, repository, artifact store, clock or ID boundaries when replacement/testing is real.
- DRY applies to one domain policy/protocol. Do not merge semantically different code into generic managers. Duplicated formulas and magic fallbacks are forbidden.
- Endpoint, DTO, error code, serialized enum, schema/version ID, policy ID/digest, artifact path/binding and database semantics are external contracts. Changing one requires an explicit version/compatibility plan and contract fixtures.
- A compatibility adapter must state owner, reason and removal condition. Internal rename must not change serialized values.
- Preserve typed failures. Unknown errors are safely logged and mapped once without returning stack traces, private paths or raw parser data.
- Keep changes minimal and behaviorally scoped. Do not combine file moves, public renames and behavior changes without necessity.

## Checks by risk

Use the smallest evidence set covering the changed package, its direct consumers and touched compatibility contract.

- Documentation: validate Markdown links, commands, actual paths/scripts/endpoints, contradictions and `git diff`. Do not run code gates unless documentation changes a verified workflow or reveals a concrete risk.
- One package: its lint/typecheck/relevant tests, then only direct consumers. Filter Turbo with `npm.cmd run test:packages -- --filter=<package>`.
- Shared contracts, database, parser, scoring, worker or artifact lifecycle: check the changed package, immediate consumers and exact version/compatibility fixtures.
- Frontend: relevant Vitest/typecheck; add `i18n:check` for user strings/keys/locales and `design:contrast` for colors/tokens. Layout/interaction changes require representative narrow/wide, RTL, keyboard and `prefers-reduced-motion` checks.
- Persisted DTO/artifact changes require old/new fixtures and a migration/version plan.
- `npm.cmd run quality:fast` is the fresh, infrastructure-free repository gate: architecture guardrails and their negative tests, lint, typecheck, package/frontend tests, build, i18n and contrast. Use narrower package checks while iterating, then this gate for a repository-wide handoff.
- `npm.cmd run quality:integration` is fail-closed and requires `TEST_DATABASE_URL` to name a local PostgreSQL 17 test database with a standalone `test` segment. It applies/checks migrations and runs required database/API/worker integration tests with no availability SKIP. Never point it at production or an owner database.
- `npm.cmd run quality:golden` is the strict external-corpus gate. All manifest demo/info paths and exact demo SHA-256 values must be present; missing fixtures are `BLOCKED` (exit 2), not PASS. `npm.cmd run test:golden` remains the diagnostic partial runner that may report individual SKIP.
- `npm.cmd run quality:real-demo -- --demo=<approved.dem>` is a real API/worker/replay/H2/RESCORE smoke, not golden verification. It requires an already authorized running dev stack. `--match=<id>` rechecks persisted results after a restart without uploading or rescoring.
- Root `npm.cmd run test` runs workspace tests only. Real demos, golden fixtures, Docker and PostgreSQL remain separate explicit gates.

## Frontend structure

- Active imports use `app/`, `features/`, `entities/` and `shared/`. Old root `components/`, `hooks/`, `analytics/`, `replay/`, `api.ts`, `player.ts` and `shared/upload.ts` are compatibility paths only; do not add consumers.
- Server DTOs come from `@who-ruined/contracts`. View adapters preserve match/player/team IDs, `null`, availability and partial coverage.
- API errors map by machine code in `shared/messages.ts`; unknown codes get a generic localized message while raw backend diagnostics remain explicitly labeled.
- Upload percentage comes only from XHR. Processing uses real job stages, never invented percentage or ETA. Refresh errors do not hide already received data.
- Rating, explanation, important moments and replay come only from their versioned backend DTOs. No fallback to legacy ratings and no invented events/positions.
- Synthetic preview routes are development/demo-build fixtures and must remain labeled synthetic.
- Current frontend details: `docs/frontend.md`. Native Vite default is `http://localhost:5174`; Docker web is 5173.
- Replay radar assets: `docs/replay-maps.md`. Use `npm.cmd run maps:check`, stage with `maps:sync -- --revision <commit>`, then explicitly activate with `maps:activate -- <commit>`. Keep old asset revisions; never draw approximate geometry or fetch arbitrary map URLs during report GETs.

## Localization

- Every user-facing string, error, aria label and empty state uses `react-i18next`. Do not translate nicknames, SteamIDs, map names or raw backend diagnostics.
- WRC Locale Kit lives at `apps/web/src/shared/i18n`. It has 37 supported locales in `locale-catalog.ts`, English fallback and namespaces `translation`, `home`, `job`, `match`, `player`, `about`, `preview`.
- Current switcher path is `shared/i18n/LanguageSwitcher.tsx`; shared states are in `shared/ui`. Preserve keyboard navigation, focus return, RTL and browser-language detection/manual preference behavior.
- Use literal namespaces/keys and English `defaultValue` in code, for example `t('round-label', 'Round {{round}}', { round: ordinal })`. No dynamic/concatenated/user-provided keys.
- Use `Intl` with the active locale and i18next CLDR `count` forms. Do not assemble translated sentences from fragments.
- Runtime bundles locale URLs and loads JSON on demand. A failed language load must be retryable without losing the working language.

Localization workflow on Windows:

~~~text
npm.cmd run gettext
npm.cmd run i18n:sync
# translate apps/web/src/shared/i18n/translation-tasks.json using prompt.md
npm.cmd run i18n:sync
npm.cmd run i18n:check
~~~

`--acknowledge` is allowed only after a human verifies unchanged translations; never use it to force a pass. Do not use external translation services or add dependencies.

## Local development

- Windows setup: `npm.cmd run setup:windows`; use `npm.cmd`, not `npm.ps1`.
- Each worktree uses a unique `DATA_DIR`, PostgreSQL database/schema, `DATABASE_URL`, Compose project and ports. Never attach a refactor process to owner data.
- An explicitly owner-authorized dev verification may recreate its named Compose containers/database, run migrations and process only the approved demo corpus. Keep production credentials, production volumes and unapproved demos out of that workflow.
- Recommended isolated run: `scripts/dev-up.ps1`; full instructions and runtime variables are in `docs/development.md`.
- Do not stage, commit, push, merge, reset, clean, checkout branches or modify another worktree unless the owner explicitly requests it.
