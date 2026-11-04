# Frontend architecture and integration

**Status:** canonical frontend reference after P4 modularization. The active application is `apps/web`; historical handoff documents are indexed in [docs/README](README.md).

## Responsibilities

The frontend owns routing, interaction, accessibility, localization, responsive layout and presentation adapters. It does not parse demos, compute M2 features, calculate H2, select awards or infer missing events.

Server DTOs come from `@who-ruined/contracts`. A view adapter may reorganize a DTO for rendering, but it must preserve roster `teamId`, `null`, availability, coverage and typed errors.

## Module layout

~~~text
src/
  app/                 providers, router, shell and route error boundary
  pages/               thin route composition
  features/
    upload-demo/
    match-report/
    player-report/
    participation-rating/
    rating-explanation/
    important-moments/
    match-replay/
  entities/match/      shared match view model and adapters
  shared/
    api/                HTTP transport only
    i18n/               locale runtime, switcher, tooling and 37 locales
    lib/                generic hooks/utilities
    ui/                 reusable visual primitives and states
  preview/             dev/demo-only synthetic scenarios
~~~

Feature public APIs are their `index.ts` files. Cross-feature imports should use those entry points or a deliberately shared entity/UI primitive, not another feature's internal file.

Thin pages compose capabilities:

- `MatchPage`: match report, active rating/awards and replay.
- `PlayerPage`: player report, six-family explanation, important moments and replay links.
- `HomePage`/`JobPage`: upload and processing state.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | landing |
| `/analyze` | demo upload and recent matches |
| `/jobs/:jobId` | queued/processing/completed job |
| `/matches/:matchId` | match report, rating and replay |
| `/matches/:matchId/players/:playerId` | player report and explanation |
| `/about` | product/method overview |
| `/preview/:scenario?` | development or demo-build synthetic states only |

Normal builds use browser history. The self-contained demo build uses hash routing and does not call the API.

## Data access

`shared/api/transport.ts` owns fetch/error envelope handling. Each feature owns:

- endpoint-specific API parsing;
- React Query keys and hooks;
- DTO-to-view mapping where needed;
- loading/error/empty rendering for its capability.

Query keys are centralized per capability and tested for invalidation compatibility. React Query retries once and does not refetch merely because the browser window regains focus.

Vite proxies same-origin `/api` requests to `API_URL` and removes the development Origin header. Direct API clients still obey the configured CORS allow-list.

## Rating and explanation

`participation-rating` consumes only `m4.3-participation-rating@1`. It renders:

- the real backend-calculated H2 value;
- `null` and typed unavailability without a legacy fallback;
- coverage and incomplete award pools;
- deterministic ties, draw scope and roster-based teams;
- six raw family inputs and final attribution values already calculated by the backend.

`rating-explanation` consumes `m4.6-participation-explanation@1`. It renders human-readable family descriptions, confirmed evidence, rounds, aggregate/base adjustments and nonlinear transformations. It never distributes an aggregate transform across events on its own.

`important-moments` renders the backend's deterministic multikill/trade selection. Internal event codes, anchor IDs and diagnostic field names are not user-facing labels.

## Replay

`match-replay` loads replay metadata first and the selected round separately. Playback/interpolation/geometry are UI concerns; event and position facts come from the versioned replay DTO.

Playback starts paused. After an explicit Play action, position interpolation and short aim transitions remain enabled even with `prefers-reduced-motion`: they convey replay movement, rather than decorative animation. Missing samples and large gaps are not interpolated. Hovering a visible player marker shows its nickname; keyboard users can highlight the player through the roster or player selector.

The client requests replay metadata version 2, loads the selected map's real radar image, and offers altitude layers when supplied. Failed image loads have a retry action; no player markers are shown over an absent or invented map. See [map assets, updates and Workshop extension](replay-maps.md) for the catalogue workflow and version limitations.

The component handles:

- unavailable/corrupt replay independently of the match report;
- round selection and deterministic playback;
- missing map geometry/assets;
- responsive canvas sizing and reduced motion;
- keyboard-operable controls and localized labels.

The browser does not reopen the demo or synthesize unseen player positions.

## Upload and job progress

Upload percentage comes only from XHR transfer events. Once the file is accepted, the UI shows named job stages rather than invented processing percentages or completion times.

Cancellation stops the local transfer; it does not claim to cancel an already accepted server job. A refresh restores state from `GET /jobs/:id`.

## Errors and retained data

Machine error codes map to localized messages in `shared/messages.ts`. Unknown codes receive a generic message, while the original backend diagnostic is clearly labeled and not translated.

A background refresh error must not hide already-rendered successful data. Loading, empty, offline, retry and partial states reuse primitives from `shared/ui`.

## Localization

The WRC Locale Kit is in `shared/i18n`:

- 37 supported languages in `locale-catalog.ts`;
- English fallback and `translation` common namespace;
- page namespaces `home`, `job`, `match`, `player`, `about`; `preview` for synthetic examples;
- browser-language detection unless a manual preference marker exists;
- JSON resources loaded by URL on demand;
- self-name/code search, keyboard navigation and RTL in `LanguageSwitcher.tsx`.

All user-facing text, aria labels, errors and empty states use static `react-i18next` keys. Nicknames, SteamIDs, map names and raw backend diagnostics are not translated.

Use the repository workflow:

~~~powershell
npm.cmd run gettext
npm.cmd run i18n:sync
# translate tasks manually using shared/i18n/prompt.md
npm.cmd run i18n:sync
npm.cmd run i18n:check
~~~

Do not use acknowledgement to hide an unreviewed translation.

## Accessibility and responsive behavior

At widths up to 760px, the scoreboard uses player cards with K/D/A, the selected group's first metric and the rating. The group's remaining metrics are available in each card's disclosure. Wider layouts use the table; both views share metric formatting and sorting. Group selection resets sorting to rating descending.

The upload workspace keeps the file picker near the page heading, followed by recent matches. Decorative landing-page sizing does not apply to this route.

Interactive controls must remain keyboard reachable, visibly focused and correctly labeled. Layouts must tolerate long localized labels and narrow intermediate widths, not only named device breakpoints. Arabic is right-to-left; identifiers and numeric data can keep their appropriate direction.

Animations, skeletons, replay playback decorations and reveals must respect `prefers-reduced-motion`. Color use must preserve the project contrast gate.

## Preview and tests

Preview routes exist only in Vite development or the demo build. They include loading, error, partial and unavailable states and make no API claims. Synthetic preview data is labeled synthetic.

Targeted frontend checks:

~~~powershell
npm.cmd --prefix apps/web run test
npm.cmd --prefix apps/web run typecheck
npm.cmd run i18n:check
npm.cmd run design:contrast
~~~

Use browser checks for representative narrow/intermediate/wide widths, Arabic RTL, keyboard flow and reduced motion when the touched UI creates that risk.

## Compatibility adapters

Root-level `api.ts`, legacy component/hook/analytics/player/replay files and `shared/upload.ts` re-export the P4 feature-first modules. They are retained temporarily for source compatibility and are not the preferred import surface. See [compatibility adapter audit](compatibility-adapters.md) before removing any of them.
