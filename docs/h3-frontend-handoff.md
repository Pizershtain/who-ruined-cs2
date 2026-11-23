# H3 frontend handoff

Read the existing routes under `/api/v1/matches/:id` and discriminate on the response's `schemaVersion`. The backend serves both versions on the same routes.

| Route suffix | Production H3 | Historical H2 | Contract export |
| --- | --- | --- | --- |
| `/experimental-participation-rating` | `m4.3-participation-rating@2` | `m4.3-participation-rating@1` | `storedParticipationRatingSchema` |
| `/experimental-participation-explanation` | `m4.6-participation-explanation@2` | `m4.6-participation-explanation@1` | `storedParticipationExplanationSchema` |
| `/radar` | `player-radar@2` | `player-radar@1` | `storedPlayerRadarReportSchema` |
| `/evp` | `evp-report@1`, bound to `match-result@2` | `evp-report@1`, bound to `match-result@1` | `evpReportSchema` |

All schema exports come from `@who-ruined/contracts`. H3 rating and explanation include `policy: { id, digest }` and `reportVersion: "match-result@2"`. The public policy ID is `h3-seven-family@1`. Use returned values and awards. The private recompute seed and equipment observations never appear in these DTOs.

## Rating and explanation

- Render the exact families returned by the explanation. H2 has six families. H3 adds `ROUND_IMPACT` to both `rawFamilyInputs` and `finalAttribution`, and to the explanation's family list.
- For `ROUND_IMPACT`, `null` means no verified basis. Show unavailable instead of a zero. A measured `0` means the model scored no qualifying sequence from the available rounds. `coverage.availability` distinguishes available, partial and unavailable. `observedRoundIds` and `withheldRoundIds` carry the underlying coverage.
- `ROUND_IMPACT_CLUTCH`, `ROUND_IMPACT_RECOVERY` and `ROUND_IMPACT_POSTPLANT` refer to confirmed sequences. Use `sources[].roundIds` and `evidenceEventIds` to link to match facts. `ROUND_IMPACT_CAP` applies to the entire family, so individual source contributions can be `null` even when the family total is available. `VERIFIED_UTILITY_USE` and `TRADED_DEATH_NEUTRALIZED` are H3 support and death-related evidence.
- If a player's whole `rating` is `null`, show their typed availability and coverage. Display `arithmetic.reconstructed` as supplied. The backend verifies the sum to `1e-12` and retains unrounded contributions. The rating's MVP and Who Ruined are authoritative.

## Radar and EVP

The eight axes and `radar-normalization@1` are common to both versions. In Radar v2, use `ratingExplanation`, `relatedRatingFamilies` and `sourceBinding.ratingPolicy`. In v1, use `h2Explanation`, `relatedH2Families` and `sourceBinding.h2ReportSchemaVersion`. `mvpAttribution` in v2 uses `CONFIRMED_POSITIVE_H3_EVIDENCE`. The axis highlight is optional even for MVP. EVP uses the persisted MVP exclusion, and `sourceBinding.evpInputDigest` matches `evp.binding.inputDigest` when an EVP report exists.

Show a missing axis value as unavailable. Use `rawValue` for numbers and the stored `geometryValue` for layout. Display `matchAverage` together with pool size and incomplete coverage where relevant. [Radar metrics](player-radar.md).

## Fixtures for frontend tests

- The HTTP test named **serves bound synthetic H3 rating, explanation, Radar and EVP** builds a complete 10-player synthetic case. It includes all four response shapes, a valid MVP/EVP binding and an unavailable `ROUND_IMPACT`. The historical H2 HTTP tests in the same file cover the six-family DTOs and Radar v1. [HTTP fixture source](../apps/api/test/participation-rating.test.ts).
- Use the synthetic sequence fixtures for positive clutch, deficit recovery and post-plant contributions. They also cover rejected events and no qualifying awards. [H3 scoring fixtures](../apps/worker/test/h2-e8-policy.test.ts).
- Exercise a rated H3 player with unavailable impact, a rated H3 player with available zero or positive impact, a player with `rating: null`, and a historical H2 player. Include Radar cases with a valid MVP highlight and with all MVP highlights absent. Keep these fixtures labelled synthetic.
