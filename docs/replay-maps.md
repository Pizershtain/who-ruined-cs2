# Replay map assets

The replay uses real CS2 radar textures, not a hand-drawn approximation. Images are downloaded during asset preparation, served by the web app, and loaded by the browser only for the selected map/level. No upload or report GET downloads game content.

## Catalogue and coordinates

- `scripts/radar-catalog.json` pins the active source commit.
- `scripts/sync-radar-assets.mjs` downloads the catalogue, radar images and overview files from [CS2 Map Icons](https://github.com/MurkyYT/cs2-map-icons). Images and overview data belong to Valve Corporation.
- `apps/web/public/maps/<revision>/manifest.json` records each image's source URL, SHA-256, dimensions, byte length, calibration and floor intervals. The directory is immutable: changing bytes under the same revision fails.
- `apps/api/src/application/replay-map-catalog.generated.ts` is the activated registry. `replay-maps.ts` resolves exact map names and rejects conflicts with a stored calibration. Unknown names are not matched by substring or guessed Workshop basenames.
- The initial snapshot has 23 maps and 28 radar images. Maps without a usable image/overview pair and segmented training maps remain unsupported; the manifest lists exclusions. This is not a claim to support every Workshop map.

Valve overview scale is measured against a 1024-unit square even when the exported texture is 2048 pixels. The UI displays the entire image without cropping and projects coordinates with the supplied origin and scale. `rotate` is overview metadata, not a request to rotate this north-up texture. Multi-level maps use half-open altitude ranges `[minZ, maxZ)`; unknown height is never assigned to a floor. Floors are numbered from bottom to top.

The source snapshot is **not a verified demo map build**. A map name alone cannot identify a historical layout. The UI explicitly states this limitation; no matching version is inferred from upload time. Existing stored transforms that conflict with the catalogue fail closed.

## Update and rollback on Windows

Check for a source revision without changing application files:

~~~powershell
npm.cmd run maps:check
~~~

Stage an explicitly selected full commit (replace `COMMIT` with the 40-character SHA printed by the check):

~~~powershell
npm.cmd run maps:sync -- --revision COMMIT
~~~

Without arguments, `maps:sync` verifies/downloads the currently pinned revision. It never switches the active catalogue. Staging validates image dimensions and overview transforms, limits downloads, and rejects ambiguous filenames or missing floor images. A failed staging operation leaves the active catalogue alone; rerun it to finish the immutable directory.

Review the staged manifest, compare origins/scales/floors against the active revision, and visually verify the changed maps. Then activate:

~~~powershell
npm.cmd run maps:activate -- COMMIT
~~~

Activation builds the contracts, validates every calibration and checks each image's SHA-256, size and dimensions before replacing the generated registry. Rebuild/deploy API and web together; serve the new assets before switching API traffic. Retain previous asset directories so already-open reports can finish loading their selected revision. Rollback uses the same activation command with the previous commit, followed by rebuild/deployment. This switches the default catalogue, not the immutable replay artifacts.

The checker can run in CI or an owner-managed schedule; automatic activation is deliberately separate. An upstream commit may concern unrelated thumbnails, so `updateAvailable` means a new source revision, not necessarily changed geometry. No schedule is installed by these scripts.

## HTTP and artifact compatibility

- `GET /api/v1/matches/:id/replay` and `?version=1` retain `m4.7-replay-metadata@1` and its Dust2-only behavior.
- `?version=2` returns `m4.7-replay-metadata@2` with map-specific calibration, local immutable image URLs and altitude layers. Other versions, duplicate parameters and unknown query keys are rejected.
- The frontend accepts both DTO versions and requests version 2. A v1 response without usable images is shown as unavailable rather than drawing a fake radar.
- Stored `m4.7-replay-index@1` and `m4.7-replay-round@1` schemas, paths, fingerprints and contents are unchanged. API v2 adds presentation metadata after reading and validating an existing index. Existing non-Dust2 coordinates can therefore be displayed without reopening the demo. An absent index remains unavailable.

Compatibility owner: replay API. Keep v1 until external clients have migrated; remove it only with an explicitly announced API compatibility change. Deploy the API supporting version 2 before a frontend that requests it. There is no database migration or worker pipeline change in this release.

## Future Workshop source

Keep source acquisition outside `ReplayQueries` and `ReplayCanvas`. A future background asset job can produce the same manifest/calibration/layer structure; the frontend already consumes URLs and transforms from the DTO rather than a hardcoded map list. `resolveReplayRadar` is the existing resolution point to extend once a persistent asset registry is justified.

Required before enabling Workshop downloads:

1. Preserve a proven Workshop item ID and, when available, package/version identity at the parser-adapter boundary. Current normalized data only carries `map_name`. A Steam URL supplied by an owner is a separate explicit source, not evidence extracted from a demo.
2. Deduplicate bounded download/extraction jobs by item ID and content version/hash; verify the Steam app ID. Download using Steam UGC, then extract only radar textures and overview metadata from the package. Do not run the map or its scripts. See [Steam UGC](https://partner.steamgames.com/doc/api/isteamugc#DownloadItem) and [Source2Viewer CLI](https://s2v.app/ValveResourceFormat/guides/command-line.html).
3. Publish a validated immutable asset bundle, then bind the selected bundle to the match via a versioned artifact/registry record. Add contract fixtures and a compatibility plan for this new persisted binding. Never replace a historical match's map silently when Workshop updates.
4. Return explicit pending/unavailable/ambiguous-version states. Missing IDs, inaccessible/deleted/private packages, missing radars and unverified historical versions must remain distinguishable. A private tournament package needs an explicit owner import path.

There is no Steam session, automatic Workshop downloader, arbitrary remote URL fetch or generated map-geometry fallback in the current implementation.
