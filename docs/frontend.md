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
    auth/
    player-profile/
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
- `PlayerPage`: player report, rating explanation, important moments and replay links.
- `HomePage`/`JobPage`: upload and processing state.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | landing |
| `/analyze` | demo upload and recent matches |
| `/jobs/:jobId` | queued/processing/completed job |
| `/matches/:matchId` | match report, rating and replay |
| `/matches/:matchId/players/:playerId` | player report and explanation |
| `/players/:steamId` | persistent player profile and paginated match history |
| `/register` | account creation with an optional manual SteamID64 and immediate sign-in |
| `/profile` | signed-in player's selected profile, upload and About me |
| `/login` | local password sign-in |
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

The match and player pages accept the stored H2 and H3 rating and explanation contracts. H2 reports contain six families. H3 adds round impact with independent coverage. The player page displays the supplied reconstruction, observed and withheld rounds, and links to the recorded rounds and events. A missing contribution displays as unavailable, and a measured zero displays as zero.

The match report lists persisted EVP awards. The player radar displays seven of the eight supplied axes, with raw values, comparison pools and evidence. Geometry comes from the radar DTO. Award highlights use the supplied attributions. See [H3 response formats](h3-frontend-handoff.md).

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

`RESULT_READY` opens the saved report directly and shows a reuse notice. `ANALYSIS_IN_PROGRESS` opens the existing job. New and legacy responses poll the returned job normally. An explicit recovery conflict may link to the identified match for the operator.

## Account and persistent player profiles

Use the Docker Gateway at `http://127.0.0.1:5173` for same-origin Auth, Profiles and Core. The access JWT lives in memory. The browser sends the HttpOnly refresh cookie. Web Locks serialize cookie writes across tabs, and tabs share only non-sensitive coordination state. If a refresh outcome is uncertain, a fresh password login can establish a new session. Browsers without Web Locks use manual password sign-in and skip automatic rotation. [Auth integration](auth-frontend-handoff.md)

Persistent profiles use the validated SteamID64 and the supplied aggregate, revision string, freshness state and history cursor. They render H3 families per policy, awards and seven radar axes using the existing normalization caps. A retained summary remains visible during synchronization or a refresh failure. [Profiles integration](profiles-aggregation-frontend-handoff.md)

Successful sign-in opens `/profile`. The same player page renders public and personal routes. The personal route loads the current account's manual SteamID and in-game nickname from Auth. The user can edit the setting on About me if Profiles is unavailable. The compact uploader in the header uses the workspace upload form and its existing Smart Upload behavior.

The selected tab is reflected by `?tab=stats`, `?tab=matches` or `?tab=about`. Statistics requests three recent matches. Opening All matches starts a separate 20-match cursor query. Opened tabs keep their local state, and history keys include the SteamID64 and page size. Private account-link queries are keyed by user UUID and released when the personal screen unmounts.

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

## Removed compatibility paths

The former root `api.ts`, component/hook/analytics/player/replay trees and `shared/upload.ts` were removed after their consumers migrated. Active code must continue to use `app/`, `features/`, `entities/` and `shared/`; the architecture gate rejects package-entrypoint bypasses and upper-layer imports. See the [compatibility adapter audit](compatibility-adapters.md) for the retained serialized and package-level compatibility surface.
