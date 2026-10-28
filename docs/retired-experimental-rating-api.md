# Retired M3-C8 P2/C2+S2 HTTP integration

The owner retired the obsolete experimental P2/C2+S2 rating API in M4.5.

The following route is no longer registered and receives ordinary safe
route-not-found handling, regardless of obsolete environment variables:

```http
GET /api/v1/matches/{matchId}/experimental-rating
GET /api/v1/matches/{matchId}/experimental-rating?model=c2-s2
```

The old response DTOs, OpenAPI schemas, feature flag and sidecar preparation
CLI were removed. Existing historical sidecars and databases are not rewritten
or deleted.

The C2/S2 prepared-profile kernel, context extraction and factual inputs remain
internal dependencies of the active H2/H1 participation model. Their retention
does not make the retired rating reachable over HTTP.

The only user-visible participation rating endpoint is documented in
`docs/api-participation-rating.md`:

```http
GET /api/v1/matches/{matchId}/experimental-participation-rating
```

It returns one backend-selected, policy-neutral result. H2/H1 selection remains
owner-only through `ACTIVE_RATING_POLICY` and `rating:rebuild`; every HTTP
`policy` selector is rejected with `422 INVALID_POLICY_SELECTOR`.
