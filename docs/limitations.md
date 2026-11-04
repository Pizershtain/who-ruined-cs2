# Current limitations

**Status:** current release boundary. Historical milestone-specific limits are retained in their stage reports but do not override this list.

## Input and parser evidence

- Input is a local Source 2 CS2 `.dem`. URLs, `.dem.bz2`, Source 1 and POV demos are unsupported.
- Parser values that are absent or ambiguous remain `null`/unavailable.
- Cash is unavailable in demoparser2 0.42.0. Item pickup does not prove purchase/donor intent. Molotov and Incendiary damage is represented through the available inferno facts.
- The observed headers do not provide an authoritative game-mode field. Mode/applicability is not inferred from a map name or final score.
- Independent external `.dem.info` evidence covers K/D/A and score transitions. ADR, KAST, trades, clutches, utility and replay have deterministic/cross-demo checks but not the same independent reference.
- No real overtime demo existed in the recorded validation set. Side-switch/overtime edge cases use clearly synthetic regression fixtures.
- Real demos are external to the repository. Synthetic fixtures do not count as real-demo validation.

## Rating and explanation

- H2 is experimental, uncalibrated and non-causal. It is not a probability, general skill rating, proof of intent or proof that a player caused a defeat.
- The active rating expects a supported two-team 5v5 roster and sufficient participation evidence. A player can have `rating: null`; award pools can be incomplete.
- H2 uses its frozen direct-harm multiplier. Absolute values are not guaranteed to be comparable across modes or future policies.
- A negative contribution is not necessarily an event-level mistake. CONTEXT can be negative because of centering; negative-mass softening is cross-family.
- Explanation links only resolvable anchors. Aggregate transforms and residual baselines are exposed as such rather than invented as events.
- “Who Ruined” is a deterministic label within the eligible pool and configured model, not a causal finding.
- The evaluation gate in `SPEC.md` and [eval](eval.md) has not been completed; no human-validated causal-quality claim is made.

## Important moments

- Important moments intentionally include only 2-5 kill multikills and confirmed one-to-one trades/fast trades.
- They exclude ordinary single kills, damage hits, technical friendly-damage rows and unverified tactical interpretations.
- Trade timing requires a known tick rate. The verified rule uses a five-second revenge window; “fast” is at most one second.
- The list is capped at eight moments, so it is a highlight selection rather than an event log.

## Replay

- Replay samples positions at 4 Hz; interpolation is a viewer aid, not additional parser evidence.
- Frames can have partial coordinate/player coverage and report warnings.
- Replay metadata v2 uses a bundled, versioned catalogue of 23 maps with real radar images and altitude layers where available. Unknown maps remain unsupported. The catalogue revision is not proof of the demo's historical map version; stored conflicting transforms are rejected. Legacy v1 remains Dust2-only. See [map assets and Workshop scope](replay-maps.md).
- Replay events currently expose kills, bomb plants and defuses; it is not a full GOTV playback.
- Replay publication is independent. A match can be complete while replay is unavailable or corrupt.

## Runtime and storage

- The native parser is synchronous but isolated in a directly owned child process. Timeout or lease-loss abort kills that child; cancellation is not cooperative inside demoparser2.
- Upload preflight reads a bounded Source 2 magic prefix and validates the native header in a short, time-bounded child. Event, tick, participation and replay parsing happens in the worker child.
- Gzip/JSON bounds limit artifact allocations but do not impose an OS-level native RSS ceiling. A container/job-object memory limit is still required for a hard memory guarantee against the native library.
- Upload, parser, gzip, JSON depth, replay and queue bounds protect a local process. They do not provide multi-user quotas.
- The upload semaphore is per API process; SQLite is the shared queue authority.
- SQLite and filesystem publication cannot be one transaction. Immutable create/reuse/conflict, checksums, lease fencing, conditional pointer updates and reconciliation cover tested crash windows but are not distributed transactional storage.
- Recovery is finite. Jobs that exhaust `MAX_JOB_ATTEMPTS` fail instead of retrying forever.
- With `RETAIN_SOURCE_DEMO=0`, the raw demo is removed after verified result binding and no competing job/reference. Historical artifacts are not bulk-deleted automatically.
- A GET racing a result pointer replacement can observe the previous valid result or a typed conflict, but should not receive torn JSON.

## Deployment and security

- The supported topology is a trusted local owner on loopback.
- Authentication, authorization, tenant isolation, CSRF policy for public origins, cross-process rate limiting, malware scanning, public object storage, backups and secret management are not implemented.
- `PUBLIC_MODE` is not an implemented security mode. Public release requires a separate threat model and deployment design.
- Docker resource limits are development safeguards, not production sizing evidence.
