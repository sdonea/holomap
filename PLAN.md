# Status and open items

## Done: currents moved off Open-Meteo
Currents now come from NOAA CoastWatch's blended near-real-time surface currents
(`app/api/currents/route.ts`), one global grid cached server-side for 6 h, same pattern as wind
(`app/api/wind/route.ts`). No per-point calls, no rate limits, no Open-Meteo code left, and the
top-bar credit reads "DATA: NOAA COASTWATCH".

This replaced the RTOFS + GitHub Actions idea. Trade-offs of what shipped: ~28 km resolution (RTOFS
would be ~8 km), daily updates, no tides, and no values within ~25 km of shore.

## Optional upgrade: sharper currents via NOAA Global RTOFS
Only worth doing if 28 km looks too coarse. Source: AWS bucket `noaa-nws-rtofs-pds`
(`rtofs.YYYYMMDD/`), 1/12° grid, hourly forecasts, public domain. Unconfirmed, verify before building:
1. Which file holds surface u/v (`rtofs_glo_2ds_fNNN_diag.nc`, ~194 MB, variable names unknown).
2. Whether HYCOM layer-1 `u-vel.` is total velocity or must be added to `u_btrop`.
3. The grid is curvilinear (tripolar above ~47°N): needs per-point lat/lon and vector rotation to
   true east/north, or Arctic and North Atlantic arrows point the wrong way.
Downloads run at ~60 KB/s on this machine, so it has to run as a scheduled GitHub Actions job
(`scripts/build_currents.py`), regrid to 0.25°, write Int16 u/v in the `/api/wind` layout, and publish
to a `data` branch or Release asset. Check against known currents (Gulf Stream NE, Agulhas SW,
Kuroshio NE) with `lib/currents.check.ts`.

## Open items
- **Ships on Vercel**: the aisstream connection lives in one long-running process
  (`app/api/ships/route.ts`). Serverless hosting won't keep it open. Either run the app on an
  always-on server, or add a small always-on worker writing to a shared store (Redis/KV) that the
  route reads. Needs a hosting decision; price not checked.
- **Ship types** fill in slowly (static data every ~6 min per ship); fine as is.
