# Backend readability cleanup report

## 1. Renamed, moved and removed

| Before | After | Scope |
| --- | --- | --- |
| `packages/scoring/src/c2s2-rating.ts` | `packages/scoring/src/participation-family-kernel.ts` | Active six-family calculation kernel; exports and persisted identifiers are unchanged. |
| `packages/scoring/src/p72-participation-rating.ts` | `packages/scoring/src/participation-rating.ts` | Active H2/H1 policy projection; formula and policy IDs/digests are unchanged. |
| Matching `c2s2-rating` and `p72-participation-rating` scoring tests | `participation-family-kernel.test.ts`, `participation-rating.test.ts` | Test names now follow the active modules. |
| `apps/worker/src/c2s2-sidecar.ts` | `apps/worker/src/prepared-participation-input.ts` | Active raw-event-to-prepared-input builder; sidecar schema/version strings are unchanged. |
| `buildC2S2PreparedSidecar` | `buildPreparedParticipationInput` | Internal worker symbol only. |
| Three `m3c8`-named participation API/handoff/integration documents | `api-participation-rating.md`, `frontend-handoff-participation-rating.md`, `retired-experimental-rating-api.md` | Current documents no longer look like an unfinished research branch. |

Imports, exports, README links and active documentation references were updated. Six obsolete generated files for the two former scoring filenames were removed from ignored `packages/scoring/dist`; a clean build generated the new names. `docs/backend-map.md` was added and README links to it. No frontend source, formula, DTO, HTTP route, database schema or persisted identifier was changed.

## 2. Root cleanup

Twenty-four untracked research/task-kit items were moved without content changes to ignored `_local-archive/research-and-task-kits/`: 203 files, 2,966,749 bytes. `.gitignore` now excludes `_local-archive/`. Active source, tests, `docs/research`, `documentation`, demos and private data were not moved or deleted.

`Developer Readability Cleanup/` remains in the repository root. Windows reports that the current task files are in use, including on a final retry after verification, so this one kit cannot be moved safely during its own run. It should be moved to the same local archive after the process holding it releases the handle.

## 3. Verification matrix

| Change area | Evidence | Result |
| --- | --- | --- |
| Scoring module/test renames | Scoring typecheck; 35/35 scoring tests; clean scoring build | PASS |
| Worker prepared-input rename | Worker typecheck; 37/37 worker tests; clean worker build | PASS |
| API use through package exports | Participation HTTP/API suite, 15/15 | PASS |
| H2/H1 real-data behavior | One permitted Dust2 demo: 10 profiles, both policies calculated; stable policy IDs; H2 digest `6b1fd564e413da8c120cf8f4c1c594ecc9fd9ccbeca7a9a5f5b654ae0eec9635`, H1 digest `62f350860fc8fcc2e0391d337b464d145547b42e078e878d88f77aadf7675262`; policy delta invariant true | PASS |
| Owner CLI entrypoint | `rating:rebuild --dry-run` against disposable current-schema SQLite: zero matches, zero blocked, zero reconstruction/policy error | PASS |
| Documentation and backend map | New paths exist; no active references to former filenames outside the local archive | PASS |
| Root archive | 24 items present; 203 files and byte total verified; archive is ignored | PASS for moved items; PARTIAL for current locked kit |
| Final repository gate | `lint` 11/11; `typecheck` 18/18; tests 191 package + 3 real golden = 194/194, 0 skipped; `build` 11/11; `git diff --check` clean | PASS |

Baseline before cleanup was also green: typecheck 18/18 and tests 194/194. An initial worker run exposed stale sourcemaps from the former generated filenames; rebuilding and removing only those six ignored artifacts resolved the warning. Docker and the full corpus were intentionally not run because no Docker/runtime entrypoint or mathematical behavior changed.

## 4. Owner decisions and remaining boundaries

- Move `Developer Readability Cleanup/` after its Windows handle is released; no forced deletion or lock-breaking was attempted.
- Historical names remain where they are compatibility data: schema/version strings, error codes, H2/H1 policy IDs and digests. Renaming them would require a separate migration decision.
- The owner SQLite database predates the current `Match.resultFilePath` column and was left untouched. CLI resolution was verified against a disposable current-schema database instead of migrating owner data.
- Dense research-derived worker calculations were not reformatted beyond the requested internal naming. A formatting-only pass can be reviewed separately if desired.
- The working tree already contained substantial M4 changes before this cleanup. No staging, commit, reset, merge or push was performed.
