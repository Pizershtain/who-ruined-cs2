# Golden demos

The three real `.dem` files and their `.dem.info` sidecars stay outside Git.
The committed manifest contains only SHA-256 values and anonymous expected
counts, score sequences, sorted K/D/A tuples and non-identifying M2 aggregates—
never names, SteamID64 values or local fixture paths.

Set the paths that are available and run:

```powershell
$env:GOLDEN_OFFICE_DEMO_PATH = 'C:\external\office.dem'
$env:GOLDEN_OFFICE_INFO_PATH = 'C:\external\office.dem.info'
$env:GOLDEN_DUST2_DEMO_PATH = 'C:\external\dust2.dem'
$env:GOLDEN_DUST2_INFO_PATH = 'C:\external\dust2.dem.info'
$env:GOLDEN_TRAIN_DEMO_PATH = 'C:\external\train.dem'
$env:GOLDEN_TRAIN_INFO_PATH = 'C:\external\train.dem.info'
pnpm test:golden
```

For repeatable local runs, the spec also loads `tests/golden/.env.local` when
present. The file is Git-ignored and uses the same six variable names. Explicit
environment variables take precedence because Node does not overwrite values
that already exist in `process.env`.

Each configured fixture is checked independently for SHA-256, Source 2
normalization, map, tick rate, stable 5v5 teams, side swap, all valid rounds,
every score transition, live/non-live death coverage, unique event IDs and all
ten K/D/A rows. M2 additionally checks exact normalized event totals, actual
HP-capped enemy/team damage, openings, one-to-one trades, bomb facts and grenade
throw counts. These derived M2 aggregates are regression baselines from the
demo itself, not independent external truth. Names and SteamID64 values are
validated in memory but never written into snapshots or reports.

If a fixture's demo or info variable is missing, Vitest reports that fixture as
`SKIPPED`. It is not counted as a successful golden reconciliation. The legacy
`GOLDEN_DEMO_PATH`/`GOLDEN_INFO_PATH` aliases remain accepted for Office only.

Office, Dust2 and Train currently pass. The minimum three-real-demo count is
met. Overtime/expected-`PARTIAL` remains open; team kills are positively
covered by the separate nine-demo M2.5 batch. Corrupt/truncated inputs have an
isolated synthetic regression but no real corrupt golden fixture.

The M2.5 batch validator supplements, but does not replace, these pinned golden
fixtures. It discovers every external demo dynamically and never rewrites this
manifest. Corrupt/truncated inputs are tested synthetically in an isolated
child process so a native parser panic cannot terminate the remaining batch.
