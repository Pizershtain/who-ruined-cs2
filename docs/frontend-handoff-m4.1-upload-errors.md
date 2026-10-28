# Frontend handoff: M4.1 backend upload errors

No frontend implementation is included. The upload endpoint and successful
202 response are unchanged:

```http
POST /api/v1/matches
Content-Type: multipart/form-data
field: demo
```

The backend's local default maximum is now 512 MiB (`536870912` bytes). The UI
must obtain product approval before changing its displayed copy; it must not
claim that every file below the upload cap will parse successfully.

Machine-readable failures:

| HTTP | `error.code` | Suggested UI category |
|---:|---|---|
| 413 | `SIZE_LIMIT` | File exceeds configured server limit. |
| 415 | `INVALID_DEMO` | Unsupported extension. |
| 422 | `INVALID_DEMO` | Missing, malformed, truncated or unsupported demo. |
| 503 | `INGESTION_PERSISTENCE_FAILED` | Server could not persist the upload. Retry only after checking local storage. |
| 507 | `STORAGE_UNAVAILABLE` | Insufficient or unavailable local storage. |

The response keeps the existing safe envelope:

```json
{
  "error": { "code": "SIZE_LIMIT", "message": "..." },
  "requestId": "opaque"
}
```

Do not display raw server paths or infer parser progress percentages. A client
abort stops only the HTTP transfer; it does not cancel a job already committed
after a complete upload.
