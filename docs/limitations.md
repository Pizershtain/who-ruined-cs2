# Limitations

- Only local `.dem` uploads are accepted. Links, `.dem.bz2`, Source 1, POV demos and nonstandard modes are unsupported.
- Real demos remain outside the repository. M0/M1 and M2 consistency have been
  exercised against three external demos; only K/D/A and score transitions have
  an independent `.dem.info` reference.
- M3-B exposes an experimental deterministic ranking API. It is not a causal
  blame model, probability of causing defeat, calibrated skill rating or proof
  of intent. Frontend integration remains owned by the separate frontend work.
- A `PARTIAL` result shows recovered facts and exact issues, never a Who Ruined verdict.
- Deaths alone are not described as tactical mistakes, blame or proof of intent.
- The service is localhost-only and has no public-hosting security posture.
- The local upload ceiling is finite and configurable. The M4.1 default is 512
  MiB with a 256 MiB free-space reserve, based on the measured local corpus;
  files below the ceiling are not guaranteed to fit every machine's parser
  memory or timeout budget.
- Multipart input is streamed to disk and bounded independently of
  `Content-Length`. The native parser remains synchronous inside its own child
  process, but M4.2 supervises it from a responsive process and forcibly kills
  it at the monotonic `PARSE_TIMEOUT_MS` wall-clock boundary. This is hard
  cancellation of the owned parser process, not cooperative cancellation of
  demoparser2 internals.
- SQLite and filesystem publication cannot share one atomic transaction.
  M4.2 therefore uses lease-token fencing, write/fsync/link publication,
  immutable content comparison and startup removal of abandoned provisional
  files. A matching final artifact is reused; a conflicting final artifact is
  rejected rather than overwritten.
- Recovery is deliberately finite (`MAX_JOB_ATTEMPTS`, default 3). Exhausted
  interrupted jobs end with `WORKER_RECOVERY_EXHAUSTED`; malformed input and
  deterministic parser timeout are not retried forever.
- `cash` is unavailable in demoparser2 0.42.0. `item_pickup` does not identify a
  donor or distinguish purchase from pickup, so exact spend/drop metrics remain
  unavailable. Molotov and Incendiary damage is combined as `inferno`.
- An authoritative game-mode field is absent from both the observed Source 2
  headers and the supported `.dem.info` schema. The validator reports mode as
  unavailable rather than inferring it from map or score.
- No real overtime demo was found in the nine-match validation batch. Overtime
  and side-switch logic is covered by an explicitly synthetic regression test,
  not claimed as real-demo validation.
- Independent `.dem.info` validation covers K/D/A and round score transitions.
  ADR, KAST, trades, clutches and utility aggregates have mathematical and
  cross-demo consistency checks but still lack an independent reference source.
- The 9-match M3-B comparison is an internal sensitivity sample, not a training
  corpus. Three matches changed successor leader under at least one predeclared
  coefficient/severity/support variant; this is surfaced rather than optimized
  away.
- `FRIENDLY_FIRE_COMBAT_CONTEXT` is a score-neutral heuristic. Aim direction,
  visibility, spatial obstruction, communication and intent are unavailable.
- Rescore requires a stored `m2-artifact-1`. Older M1 or match-only artifacts
  return 409 and require a real demo reparse; missing values are not fabricated.
- M4.3 stores one `match-result@1` gzip JSON per new completed match and removes
  the raw demo after verified publication by default. SQLite/filesystem are not
  one atomic transaction; immutable publication, SHA-256 binding, intent state
  and startup reconciliation close the tested crash windows but do not turn the
  pair into a transactional distributed filesystem.
- The policy-neutral H2/H1 recompute seed is intentionally retained inside the
  same canonical result. It is not a second rating, but it adds a measured
  median 154,504 uncompressed JSON bytes in the eight-result sample.
- Historical migration preserves all legacy files. Their deletion remains an
  explicit owner decision after inventory; M4.3 does not perform bulk cleanup.
- M4.4 bounds compressed and inflated canonical results, JSON depth, request
  sizes, concurrent uploads and queued jobs. These are local resource guards,
  not multi-user admission control; the in-memory upload semaphore is per API
  process and SQLite remains the shared queue authority.
- A GET that races an owner policy rebuild may observe the old complete report
  or a typed 409 while the old content-addressed file is retired. It never
  receives torn JSON, but SQLite and filesystem replacement are still not one
  transaction.
- The obsolete P2/C2+S2 HTTP rating route was retired in M4.5. Historical
  sidecars are not destructively removed; they are simply no longer reachable
  through the API.
