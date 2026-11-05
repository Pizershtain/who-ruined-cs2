# Compatibility adapter audit

**Status:** final P6 audit. Repository consumers were rechecked before every
removal. Serialized identities, public HTTP contracts and package compatibility
exports were not renamed.

## Removed internal-only adapters

The P4 frontend implementation now has one source tree under `app/`, `pages/`,
`features/`, `entities/` and `shared/`. P6 removed old source paths after a
repository-wide import and documentation search found no consumer:

- root `App.tsx`, `api.ts` and `player.ts` adapters;
- the old `analytics/`, `hooks/`, `components/` and `replay/` trees;
- `shared/upload.ts` and the unused `entities/match/index.ts` barrel;
- the orphaned legacy `components/Decode.tsx` implementation.

Tests that still exercised behavior through an old path were moved beside the
owning feature/entity (`features/match-replay`, `features/upload-demo` and
`entities/match`). The frontend architecture check no longer needs the legacy
upload exception.

The API root `health.controller.ts` and `matches.controller.ts` re-export files
were also removed after the remaining API tests migrated to `modules/*` imports.
HTTP controllers, routes and responses were unchanged.

The test-only worker `scoreParticipationSidecar` helper was removed. Its fixture
now uses the same active participation projection and award selector as the
canonical and API paths. H2 exact-output assertions remain; historical H1
identity is covered only as persisted sidecar/canonical compatibility data.

## Retained compatibility surface

`@who-ruined/scoring` deliberately keeps historical C2S2 and P72 public
exports that do not reintroduce policy selection as aliases of the
domain-named participation implementation. `P72_POLICIES` and the selector
types were removed with executable H1. Internal production imports use
`Participation*` names where doing so is meaningful. The retained aliases
remain covered by `participation-compatibility-aliases.test.ts`.

The following compatibility identities also remain intentionally unchanged:

- versioned REST routes, response schemas and machine error codes;
- `match-result@1`, rating/explanation and replay schema versions;
- the active H2 ID/digest/arithmetic and tie/null/award behavior;
- the historical H1 selector/ID/digest only in persisted schemas and old
  sidecar fingerprint metadata;
- persisted artifact paths, fingerprints, bindings and database pointers;
- the parser-adapter package `index.ts` public barrel and other package root
  barrels used as supported package entry points;
- `normalizeSnapshot` as the parser-neutral match-domain entry point.

These are contracts, not cleanup candidates. A future removal needs an explicit
deprecation or version/migration decision.

## Removal rule

An adapter may be removed only when all of the following are true:

1. no production, test, script or documentation import remains;
2. the replacement public path is documented;
3. targeted package/type/compatibility checks pass;
4. serialized and HTTP identities are unchanged;
5. the removal is recorded as an intentional source-compatibility decision.

P6 found no remaining temporary internal adapter that meets the removal rule.
The retained items above are deliberate public or serialized compatibility
surface.
