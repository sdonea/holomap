# Holomap

> A Carrier Command 2 style holotable showing live, real-world ocean currents.

## What it is
One full-screen page: a glowing tactical map of the real ocean, drawn like the CC2 holomap.
Opens on the Gulf Stream off the US East Coast. Coastlines glow cyan with inland contour
rings; blue lines offshore are real depth contours (200 m, 1000 m … 4000 m). The drifting
pixel streaks are the live surface current: each streak moves the way the water is going,
and brighter/longer means faster.

## Controls
- **Drag** or **W A S D** — pan
- **Scroll** or **↑ / ↓** — zoom
- **Hold E** — bearing tool: drops a mark at the cursor; move the cursor and an arrow shows the compass bearing (0° = north, clockwise, with the arc drawn from north) plus distance in km and nautical miles. Lines and arc are chunky pixels to match the current streaks; the numbers sit on a dark plate in the HUD pixel font so they stay readable. On this map a straight line is a constant-heading course, so the number is the heading to steer. Release E to clear it.
- **T** — switch between the tilted table and a flat full-screen map
- **Layer picker** (top-left of the table): click **OCEAN CURRENT** or **WIND** — the glowing square next to the chosen one fills in. Wind is measured 10 m above the surface. Wind streaks are pale white-blue and also flow over land. The top bar reads "WIND: 12 KN FROM 225°" (wind is quoted by where it comes from; currents by where they go).
- **P** — pause the current animation
- Hover anywhere to read the current there (knots + heading) in the top bar; bottom-left shows the cursor's latitude/longitude.

## Brand identity
- Personality: in-game tactical console, not a website
- Colours: deep navy ocean `#0f3257`→`#061425`, cyan glow `#9ff0ff`, teal current streaks, steel-grey table bezel
- Font: VT323 (pixel font, slanted for HUD numbers)

## Where the data comes from
- **Currents:** Open-Meteo Marine API (free, no key, *non-commercial use only*, must credit Open-Meteo — the link is in the top bar). About 8 km resolution, includes tides, updated through the day.
  - The free tier counts **every map point as one call**: 600/minute, 5,000/hour, 10,000/day. The site fetches each point once as a 2-day hourly forecast, caches it on the server, and skips points on land. If the limit is hit, the top bar says "RATE LIMITED" and the rest fills in about a minute later.
- **Coastlines + depth contours:** Natural Earth (public domain), pre-shrunk into `public/geo.json` by `scripts/build_geo.py`.

## Files
- `components/Holomap.tsx` — the whole map: drawing, streaks, controls, HUD, table frame
- `lib/geo.ts` — map maths (projection, current direction → arrow, interpolation)
- `lib/currents.ts` — asks the server for the current grid for whatever you're looking at
- `app/api/currents/route.ts` — server proxy + cache in front of Open-Meteo
- `lib/geo.check.ts` — run `node lib/geo.check.ts` to prove current directions are still correct
- `app/api/wind/route.ts` + `lib/grib2.ts` — global wind grid from NOAA GFS
- `lib/wind.check.ts` — physics sanity checks on the live wind grid (trade winds, westerlies, no garbage)

## How to customise
- Streak speed / length / density: `FLOW`, `TRAIL`, and the `/ 40` particle divisor at the top of `Holomap.tsx`
- Starting spot: `START` in `Holomap.tsx`
- Sharper current grid (costs more API calls): raise `target` in `pickStep` in `lib/geo.ts`

- **Wind:** NOAA GFS global model (free, public domain, updated every 6 h, hourly forecasts) from AWS Open Data. The server downloads only the two 10 m wind layers (~2 MB), decodes them itself (`lib/grib2.ts`), and serves one global 0.5° grid that every visitor and every pan/zoom reuses, so there are no API limits for wind. Cached for an hour. Check it with `node lib/wind.check.ts http://localhost:<port>`.

- **Ships:** live AIS positions from aisstream.io (free, worldwide). Needs a free API key:
  1. Go to aisstream.io, sign in with GitHub, open **Account**, create an API key (it's shown once).
  2. Create a file called `.env.local` in the project folder containing `AISSTREAM_API_KEY=your-key-here`.
  3. Restart the preview (Projects button, then reopen the project).
  Until then the top bar says "SHIPS: NO API KEY". The key stays on the server (aisstream forbids browser connections). The server keeps one live connection and only streams areas someone viewed in the last minute. Caveat: on Vercel's serverless hosting that connection won't stay alive between requests, so ships would be patchy there; it works fully when run as one always-on server.
  - Marker colours: cyan cargo, amber tanker, violet passenger, green fishing, red military, blue-grey everything else. Arrow = direction of travel, line length = speed, square = stopped. Hover a ship for name, type, speed and course. Names show when 60 or fewer ships are in view.

## Recent changes
- 2026-09-28: Added the hold-E bearing tool (pixel-art style; label always sits opposite the arrow).
- 2026-09-28: Wind moved to NOAA GFS global grids (whole world, sharper, no rate limits). Removed fake straight lines across the oceans (artificial polygon seams in the depth-contour data). Fixed ocean currents failing at world zoom.
- 2026-09-28: Added live ships (AIS) with a SHIPS toggle. Ship types arrive every ~6 min per ship, so markers start blue-grey and gain colour over the first few minutes.
- 2026-09-28: Current/wind data now honours Open-Meteo's hourly and daily limits (waits for the right window and shows "API LIMIT · MORE IN N MIN" instead of retrying every minute).
- 2026-09-28: Fixed ocean streaks drifting inland (pixel-accurate land mask) and over-dense streaks when the view is mostly land. Fixed layer buttons not responding in Safari/WebKit (the map's drag handler was grabbing the click).
- 2026-09-28: Wind/current now chosen with clickable holo radio squares on the table (M key removed).
- 2026-09-28: Added wind mode.
- 2026-09-28: Built the holomap — real coastlines + depth contours, live Open-Meteo currents as CC2 pixel streaks, tilt/flat toggle, HUD, server-side caching for the free-tier limit.
