# Documentation index

This index separates the current system contract from milestone evidence. A document listed as historical is retained for traceability; it is not a source of current runtime behavior.

## Current documentation

| Topic | Canonical document | Scope |
| --- | --- | --- |
| Product and quick start | [root README](../README.md) | Capabilities, limitations, architecture summary and entry points |
| System boundaries | [backend map](backend-map.md) | Apps, packages, dependency direction and data flow |
| Development | [development guide](development.md) | Windows setup, isolated native/Docker runs, targeted checks and troubleshooting |
| API | [API reference](api.md) | Routes, versioned DTOs and public error envelope |
| Storage and jobs | [storage lifecycle](storage-lifecycle.md) | Artifacts, checksums, leases, publication, recovery and retention |
| Frontend | [frontend architecture](frontend.md) | Feature modules, routes, data ownership, i18n and browser checks |
| Replay maps | [radar assets](replay-maps.md) | Catalogue updates, rollback, map layers and future Workshop acquisition |
| Rating and reports | [scoring](scoring.md) | H2 semantics, explanation, important moments and historical compatibility |
| Constraints | [limitations](limitations.md) | Known data, model, runtime and deployment limits |
| Parser evidence | [compatibility](compatibility.md) | Verified parser capability mapping and external-demo evidence |
| Decisions | [decision log](decisions.md) | Current architectural decisions and superseded context |
| Compatibility surface | [compatibility adapters](compatibility-adapters.md) | Removed internal adapters and deliberately retained public compatibility |
| Refactoring status | [roadmap](architecture/refactoring-roadmap.md) | P0-P6 implementation status and gates |
| Final verification | [P6 quality report](architecture/final-quality-report.md) | Full gate, clean checkout, compatibility evidence and limitations |

Detailed current contracts remain in [M2 analytics](api-m2.md) and [participation rating](api-participation-rating.md). [Local Docker operations](local-dev.md) is the runbook for the isolated Compose profile. [Evaluation gate](eval.md) defines the evidence required before causal or public-quality claims.

## Historical milestone evidence

These files describe the repository at a named point in time. Their paths are stable so old reviews and links remain useful.

- Architecture baselines: [refactoring audit](architecture/refactoring-audit.md), [P3 compatibility matrix](architecture/p3-compatibility-matrix.md), [P4 frontend modules](architecture/p4-frontend-modules.md).
- Backend and integration snapshots: [backend cleanup report](backend-cleanup-report.md), [frontend/backend contract](frontend-backend-contract.md), [integration evidence](integration-e2e.md).
- Frontend handoffs and design baseline: [design composition](design-composition.md), [upload error handoff](frontend-handoff-m4.1-upload-errors.md), [rating handoff](frontend-handoff-participation-rating.md).
- M3 research and implementation notes: [decisions](m3-decisions.md), [P7.2G closure](m3-p72g-backend-e2e-closure.md), [real comparison](m3-real-comparison.md), [research observations](m3-research-observations.md), [examples](m3-scoring-examples.md), [inputs](m3-scoring-inputs.md), [proposal](m3-scoring-proposal.md), [validation plan](m3-validation-plan.md).
- M4 stage reports: [M4.1 upload/Docker](m4.1-upload-and-docker.md), [M4.2 worker recovery](m4.2-worker-recovery.md), [M4.3 canonical lifecycle](m4.3-compact-result-and-lifecycle.md), [M4.4 hardening](m4.4-backend-hardening.md), [M4.4 threat model](m4.4-backend-threat-model.md), [M4.4 compatibility](m4.4-compatibility-matrix.md), [M4.5 closure](m4.5-backend-closure.md).
- Older planning: [milestones](milestones.md), [retired experimental rating API](retired-experimental-rating-api.md).

When a historical statement conflicts with current code or a current document above, the current document and versioned contract win. `SPEC.md` remains normative for domain semantics.
