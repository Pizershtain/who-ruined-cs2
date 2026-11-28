# Target architecture

**Status:** current. The [Gateway and service layout](../api-gateway-and-service-layout.md) owns deployable paths and HTTP routing. The [backend map](../backend-map.md) describes modules and workflows inside Core. [P0–P6 refactoring evidence](refactoring-roadmap.md) documents the earlier single-backend layout.

## Domain boundaries

- Core is one domain with two processes: HTTP API and worker. They own match data, scoring, replay, immutable artifacts and the publication outbox. Core can operate with only its database and artifact root.
- Profiles is a separately deployable product capability. It consumes versioned publications and snapshots from Core over private HTTP. Durable revisions, an idempotent projection and retryable pending work let it catch up after downtime. Profiles owns its database and login.
- Gateway is Nginx configured with an explicit public-route policy. Web and public API share a browser origin. Gateway has no database connection and forwards existing public responses, including partial data and typed errors.
- Auth owns accounts, credentials and revocable refresh sessions in a dedicated PostgreSQL cluster. Its signed JWTs allow later services to verify identity independently. Core and Profiles remain independent of Auth. [Auth service](../auth-service.md)
- Web renders versioned contracts and uses relative API paths. Each new backend service declares its own public routes at Gateway.

## Internal design

Transport validates HTTP inputs and delegates to use cases. Application code orchestrates. Domain functions compute deterministic results. Infrastructure owns persistence and external effects. Inject real I/O seams and use public package exports. The architecture check enforces import direction, including the separation between Core and Profiles.

The parser adapter owns native formats. The match domain reconstructs a parser-neutral model with roster-stable teams and round-specific sides. Features compute facts with provenance and explicit availability. Scoring owns versioned H3 mathematics and awards. The worker coordinates these stages through bounded native child processes and fenced jobs.

Publishing an artifact and committing its pointer are separate operations. Immutable files, SHA bindings, ownership checks and recovery bridge that gap. Core's outbox revision is committed with the pointer. Publishing and finishing jobs proceed independently of Profiles acknowledgements. [Storage lifecycle](../storage-lifecycle.md), [Profiles publication protocol](../player-profiles.md#publication-protocol).

## Compatibility and safety

Existing HTTP routes, DTO versions, policy identities, stored artifacts and migrations are compatibility surfaces. Preserve stable identifiers across source moves. Maintain exact rating fixtures, historical reads, PostgreSQL concurrency checks and a [partial-data policy](../player-profiles.md#measurement-boundaries) that keeps independently verified metrics. Source/schema moves preserve historical migration bytes and names.

The local deployment is for trusted users. Optional LAN access exposes the same Gateway origin on the local subnet. A production multi-user deployment requires an explicit auth, TLS, exposure and isolation design.
