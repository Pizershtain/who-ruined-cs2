# Frontend handoff for profile freshness and duplicate uploads

All requests keep their current relative paths through Gateway.

## Profiles

`GET /api/v1/players/:steamId/profile` keeps the `player-profile@1` body. Read these response headers if the UI shows freshness.

| Header | Meaning |
| --- | --- |
| `X-Profile-Revision` | Decimal string for the latest revision reflected in this stored summary. This may stay fixed across unrelated matches and revisions that did not change the summary. Keep as a string. |
| `X-Profile-Sync-State: CURRENT` | Profiles caught up at its latest successful feed check. |
| `X-Profile-Sync-State: STALE` | The stored summary is available while arrivals or a source outage prevent confirming freshness. Show it with a freshness note. |
| `X-Profile-Sync-State: REBUILDING` | The service is rebuilding projections or replaying publications. Retain the last usable summary and show that it is updating. |

For a missing summary while the feed or rebuild is incomplete, handle `503 PROFILE_NOT_READY` as pending. A synchronized service returns `404 PROFILE_NOT_FOUND` for a profile with no matches. Gateway may independently return `503 UPSTREAM_UNAVAILABLE`; provide retry and keep the Core match page usable. Continue rendering verified zeros, scope and availability from the DTO. Preserve the existing seven visible Radar axes. History retains its opaque cursor and unchanged response.

## Upload

`POST /api/v1/matches` still returns HTTP 202 and the existing `matchId`, `jobId` and `duplicate`. Add optional `reuseStatus` using `matchUploadResultSchema` from `@who-ruined/contracts`.

| Status | Frontend action |
| --- | --- |
| `RESULT_READY` | Open `/matches/:matchId` directly. Suggested localized message in Russian is «Эту демку уже анализировали. Открываем готовый отчёт». |
| `ANALYSIS_IN_PROGRESS` | Navigate to the existing `/jobs/:jobId` and report its real stages. |
| `ACCEPTED` | Continue the existing job flow. |
| Absent, for an older server | Continue polling the supplied `jobId`. `duplicate: true` alone does not establish readiness. |

For `REPORT_NOT_READY`, `REPORT_CORRUPT` or `REPORT_POLICY_MISMATCH` with recovery details, show that the saved result cannot currently be opened. Support a user-initiated recovery flow based on the supplied details. When deletion is already active, show that the upload can be retried later. Do not infer an uploader's identity from the match, player list or filename. Continue showing XHR upload progress and mapping machine codes through the existing locale workflow.
