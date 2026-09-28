# Next session: move ocean currents off Open-Meteo

Wind already runs on NOAA GFS grids (`app/api/wind/route.ts`, no rate limits). Ocean currents still
use Open-Meteo's per-point API (`app/api/currents/route.ts`), which bills **every map point as one
call** (free tier: 600/min, 5,000/hour, 10,000/day, non-commercial). Normal browsing burns through
that, and the map shows "API LIMIT · MORE IN N MIN". Goal: currents from one global grid, like wind.

## Chosen approach: NOAA Global RTOFS via a scheduled GitHub Actions job

Why: free, public domain ("can be used as desired"), no account, 1/12° (~8 km, same as now),
daily run with hourly forecasts. Source: AWS Open Data bucket `noaa-nws-rtofs-pds`
(e.g. `https://noaa-nws-rtofs-pds.s3.amazonaws.com/rtofs.YYYYMMDD/`).

### Verified so far (2026-09-28)
- Daily folders exist and are current (`rtofs.20260928/`).
- Candidate files per forecast hour:
  - `rtofs_glo_2ds_fNNN_diag.nc` (~194 MB, netCDF) and `rtofs_glo_2ds_nNNN_diag.nc` (nowcast)
  - `rtofs_glo.t00z.fNN.archs.a.tgz` (~437 MB HYCOM surface archive) + tiny text header `.archs.b`
- The `.archs.b` header lists `u-vel.` / `v-vel.` at layer 1 (range about ±2.3 m/s) plus
  `u_btrop` / `v_btrop`, on a 4500 × 3298 grid (`idm`/`jdm`).
- No live global current grid exists on any ERDDAP server (the HYCOM ones there ended 2013–2018),
  so there's no JSON shortcut like PacIOOS gave us for wind.

### Still to confirm before building (don't guess these)
1. Which file to use: does `2ds_diag.nc` contain surface u/v, and under what variable names? Open it
   with xarray in the Action and print the variables.
2. In HYCOM archives, is layer-1 `u-vel.` total velocity, or baroclinic that must be added to
   `u_btrop`? Getting this wrong halves or distorts speeds.
3. Grid: GLBb0.08 is curvilinear (tripolar north of ~47°N). Need the per-point lat/lon (netCDF
   `Latitude`/`Longitude` 2D arrays, or `regional.grid`) and whether velocities are grid-relative
   there, meaning they must be rotated to true east/north. Wrong rotation = wrong arrow directions
   in the Arctic/North Atlantic, which is the thing that matters most.

### Build steps
1. Push-to-GitHub is done (this repo). Add `.github/workflows/currents.yml` on a cron (after the
   00z run lands, e.g. 06:30 UTC, plus a manual trigger).
2. Python job (`scripts/build_currents.py`, numpy + xarray/netCDF4): download the needed forecast
   hours, regrid to a regular 0.25° (or 0.1°) lat/lon grid, rotate vectors if needed, mask land as
   NaN, write Int16 u/v (0.01 m/s) in the same layout as `/api/wind` (rows south→north, lon
   -180..180 with a wrap column) — one file per few hours so the map can pick the nearest time.
3. Publish the files (options: commit to a `data` branch served via raw GitHub/jsDelivr, a GitHub
   Release asset, or Vercel Blob). Pick the one with the least setup.
4. Client: `loadWindField` pattern → `loadCurrentField`; drop the per-point path and the
   Open-Meteo route once verified. Keep the land mask.
5. Verify like wind: spot-check against known currents (Gulf Stream NE off Hatteras ~2–4 kn,
   Florida Current north, Agulhas SW along South Africa, Kuroshio NE off Japan), add a
   `lib/currents.check.ts` physics test, and compare a few points against Open-Meteo.

Local testing is impractical: this machine downloads NOAA files at ~60 KB/s (~1 h per file).
Run the job on GitHub's servers instead.

## Other open items
- **Ships on Vercel**: the aisstream connection lives in one long-running process
  (`app/api/ships/route.ts`). Serverless hosting won't keep it open. Needs a small always-on worker
  (price not checked yet) writing to a shared store, or keep ships local-only.
- **Ship types** fill in slowly (static data every ~6 min per ship); fine as is.
- Open-Meteo attribution link in the top bar should switch to NOAA RTOFS once currents move.
