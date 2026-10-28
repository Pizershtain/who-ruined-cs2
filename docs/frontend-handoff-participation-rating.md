# Frontend handoff: active participation rating

This is documentation only; M4.3 does not change React, CSS, pages or frontend
state. The shared DTO and OpenAPI output are authoritative.

## Request and contract

```http
GET /api/v1/matches/{matchId}/experimental-participation-rating
```

Schema: `m4.3-participation-rating@1`; canonical report identity:
`match-result@1`. The backend exposes exactly one active rating. Do not send a
`policy` query: all such selectors return `422 INVALID_POLICY_SELECTOR`.
Neither H1/H2 identity nor the internal recompute seed is a public field.

The route is default-off and requires
`ENABLE_EXPERIMENTAL_PARTICIPATION_RATING=1`. It never parses or backfills on
GET. After a match is complete, normal reads require only SQLite and its one
canonical gzip result.

## Rendering rules

- Use `playerId` and roster-based `teamId`; never infer a team from T/CT.
- `steamId` stays a string. `steamProfileUrl` is separate from the internal
  player-details navigation.
- Render a number only when `availability.status` is
  `CALCULATED_RESEARCH_ONLY` and `rating` is non-null. Never substitute 0 or 1.
- `rating.value` is dimensionless and experimental. Preserve the
  `experimental=true`, `calibrated=false` and `causalBlame=false` meaning.
- Show six `rawFamilyInputs` and six `finalAttribution` values with their
  distinct labels. Final attribution reconstructs the score; it is not a
  second measurement of each event.
- K/D/A are counts, ADR is HP per verified played round, KAST is percent,
  blind time is seconds and grenade damage is HP. Full factual M2 analytics and
  availability are already supplied; do not recompute them in UI.
- MVP uses the reported all-player pool. Who Ruined normally uses the losing
  stable roster; `DRAW_ALL_ELIGIBLE` means a genuine draw. Honor
  `awardPoolSize`, `incompletePool`, `tied` and nullable award IDs.
- A low value, death, missing trade or product label is not proof of tactical
  blame or intent.

## Null statuses

Handle `PARTICIPATION_ABSENT_GT_2_ROUNDS`,
`PARTICIPATION_EVIDENCE_UNKNOWN`, `PARTIAL_COVERAGE_INSUFFICIENT`,
`WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE` and `UNKNOWN_APPLICABILITY` as typed
unavailability. `ROUND_GLOBAL_EVIDENCE_MISSING` is a coverage cause, not a
player absence. Partial rounds may be excluded while enough evidence remains
for a rating.

## Error mapping

Map by `error.code`, not backend diagnostic text:

| Code | Client action |
| --- | --- |
| `EXPERIMENTAL_PARTICIPATION_RATING_DISABLED` | Feature unavailable. |
| `MATCH_NOT_FOUND` | Match absent/deleted. |
| `REPORT_NOT_READY` | Processing or migration not finished. |
| `REPORT_CORRUPT` | Do not display partial/guessed numbers; operator action. |
| `REPORT_POLICY_MISMATCH` | Do not retry with a query selector; owner CLI/restart required. |
| `INVALID_POLICY_SELECTOR` | Remove the forbidden client selector. |

Legacy P2/C2+S2 HTTP fallback was retired in M4.5. Do not silently replace a
failed active rating with any locally reconstructed alternative.

OpenAPI: `http://127.0.0.1:3000/api/docs`. Backend lifecycle and owner commands:
`docs/m4.3-compact-result-and-lifecycle.md`.
