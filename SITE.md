# Holomap

> A Carrier Command 2 style holotable showing live, real-world ocean currents.

## What it is
One full-screen page: a glowing tactical map of the real ocean, drawn like the CC2 holomap.
Opens on the Gulf Stream off the US East Coast. Coastlines glow cyan with inland contour
rings; blue lines offshore are real depth contours (200 m, 1000 m … 4000 m). The drifting
pixel streaks are the live surface current: each streak moves the way the water is going,
and brighter/longer means faster.

## Controls
- **Drag** or **W A S D** — pan. Going east or west never ends: you loop around the globe. North and south stop at the top and bottom of the map. Zooming out stops at one whole world across the screen.
- **Scroll** or **↑ / ↓** — zoom (about 1.8× per mouse-wheel notch; roughly 12 notches from the whole world to the closest zoom, ~20 km across)
- **Hold E** — bearing tool: drops a mark at the cursor; move the cursor and an arrow shows the compass bearing (0° = north, clockwise, with the arc drawn from north) plus distance in km and nautical miles. Lines and arc are chunky pixels to match the current streaks; the numbers sit on a dark plate in the HUD pixel font so they stay readable. On this map a straight line is a constant-heading course, so the number is the heading to steer. Release E to clear it.
- **T** — switch between the tilted table and a flat full-screen map. The switch is animated like dipping your head over the table: the table pitches down to face you and grows until the bezel slides off-screen, and back again. Both views are the same table with the same layout: flat is just the table leveled and scaled up to fill the screen, so the top bar, buttons and scale bar keep their exact proportions. The table is always the same shape as your browser window. Skipped if your system has "reduce motion" turned on.
- **Layer picker** (top-left of the table): click **OCEAN CURRENT** or **WIND** — the glowing square next to the chosen one fills in. Wind is measured 10 m above the surface. Wind streaks are pale white-blue and also flow over land. The top bar reads "WIND: 12 KN FROM 225°" (wind is quoted by where it comes from; currents by where they go).
- **P** — pause the current animation
- Hover anywhere to read the current there (knots + heading) in the top bar; bottom-left shows the cursor's latitude/longitude.

## Depth look
The map reads in layers, lit from the upper left:
- **Land is a layer up:** a dark side wall and drop shadow on its south-east edges, and a thin lit rim on its north-west edges.
- **Land has real terrain:** shaded relief from real elevation data (mountains lit from the upper left), stepped into height bands (200 m, 500 m, 1000 m, 2000 m, 3000 m, 4500 m) that get a shade lighter going up, with thin lines where one band meets the next (real elevation contours). Hills are exaggerated when zoomed out so they still show.
- **The sea steps down:** shallow water near the coast is lightest; each deeper band (200 m, 1000 m, 2000 m, 3000 m, 4000 m) is a shade darker, and the edge of each shelf casts a soft shadow onto the deeper water beside it.
- To tune it: the sea shade per step is `rgba(1,6,18,0.2)`; the land shadow/wall are in `drawBase`; terrain bands, brightness and exaggeration are in `bakeTile` (all in `components/Holomap.tsx`).

## Brand identity
- Personality: in-game tactical console, not a website
- Colours: deep navy ocean `#0f3257`→`#061425` (darker in deep water), land `#0d3b50`, cyan glow `#9ff0ff`, teal current streaks, steel-grey table bezel
- Font: VT323 (pixel font, slanted for HUD numbers)

## Where the data comes from
- **Currents:** NOAA CoastWatch blended near-real-time surface currents (free, public, no key; the credit link is in the top bar). Worked out from satellite sea-height measurements, so it shows the big currents and eddies (Gulf Stream, Kuroshio) very well. Updated once a day, about 28 km resolution, **no tides** and no wind-driven surface drift. The server downloads the whole world once every 6 hours (~17 MB, ~10 s) and every visitor and every pan/zoom reuses it, so there is **no rate limit** to hit. Streaks stop about 25 km from shore (the data has no values that close to land).
- **Terrain (land height):** AWS Terrain Tiles (free public dataset, no key, no rate limit). Loaded straight from AWS by the browser, only for the part of the map on screen, sharper as you zoom in. Blurry for a moment while new tiles load.
- **Coastlines + depth contours:** Natural Earth (public domain), pre-shrunk into `public/geo.json` by `scripts/build_geo.py` (run it on the Natural Earth GeoJSON files from github.com/nvkelso/natural-earth-vector). It also stores the depth areas as filled shapes, which is what shades deeper water darker. Lakes (the Great Lakes and ~460 others) are cut out of the land as water with a single glowing shoreline (the inland contour rings and sea halo only follow the ocean coast), and rivers are drawn as faint glowing lines on the land: big rivers always, smaller ones appearing as you zoom in. This is why ships on the Great Lakes, the St. Lawrence, the Hudson, the Mississippi and so on sit on water instead of floating over land.

## Files
- `components/Holomap.tsx` — the whole map: drawing, streaks, controls, HUD, table frame
- `lib/geo.ts` — map maths (projection, current direction → arrow, interpolation)
- `lib/currents.ts` — fetches the global current or wind grid from the server (once per hour per visitor)
- `app/api/currents/route.ts` — downloads + decodes the global NOAA current grid, caches it for 6 h
- `lib/currents.check.ts` — run `node lib/currents.check.ts http://localhost:<port>` to sanity-check the live current grid (Gulf Stream runs north-east, Southern Ocean flows east, land is empty)
- `lib/geo.check.ts` — run `node lib/geo.check.ts` to prove map maths, flow interpolation and bearings are still correct
- `app/api/wind/route.ts` + `lib/grib2.ts` — global wind grid from NOAA GFS
- `lib/wind.check.ts` — physics sanity checks on the live wind grid (trade winds, westerlies, no garbage)

## How to customise
- Streak speed / length / density: `FLOW`, `TRAIL`, and the `/ 40` particle divisor at the top of `Holomap.tsx`
- Starting spot: `START` in `Holomap.tsx`

- **Wind:** NOAA GFS global model (free, public domain, updated every 6 h, hourly forecasts) from AWS Open Data. The server downloads only the two 10 m wind layers (~2 MB), decodes them itself (`lib/grib2.ts`), and serves one global 0.5° grid that every visitor and every pan/zoom reuses, so there are no API limits for wind. Cached for an hour. Check it with `node lib/wind.check.ts http://localhost:<port>`.

- **Ships:** live AIS positions from aisstream.io (free, worldwide). Needs a free API key:
  1. Go to aisstream.io, sign in with GitHub, open **Account**, create an API key (it's shown once).
  2. Create a file called `.env.local` in the project folder containing `AISSTREAM_API_KEY=your-key-here`.
  3. Restart the preview (Projects button, then reopen the project).
  Until then the top bar says "SHIPS: NO API KEY". The key stays on the server (aisstream forbids browser connections). The server keeps one live connection and only streams areas someone viewed in the last minute. Caveat: on Vercel's serverless hosting that connection won't stay alive between requests, so ships would be patchy there; it works fully when run as one always-on server.
  - Ships close together on screen merge into a small **radar blip**: a ring split into coloured arcs by ship type (the bigger the arc, the more of that type), with the ship count beside it. Bigger ring = more ships. Hover a blip for the breakdown; **click it to zoom in**: it centres on the blip and zooms in as far as needed to split it. At the closest zoom nothing merges; ships sitting on practically the same spot (a marina, ships tied up together) fan out in a small spiral with thin lines back to their real position.
  - Single ships: a glowing arrow pointing where the ship is heading (the line in front of it is longer the faster it goes); a hollow diamond means stopped or anchored. Hover for name, type, speed and course. Names show when 50 or fewer single ships are in view; a name is skipped if it would overlap another (hover still shows it).
  - Colours: cyan cargo, amber tanker, violet passenger, green fishing, red military, blue-grey everything else.

## Recent changes
- 2026-09-28: Housekeeping only, nothing visible changes: fixed two code-style errors so the project's lint check passes, and rewrote `PLAN.md` to match what is actually built.
- 2026-09-28: Zooming is smooth now. Current/wind streaks stretch with the map instead of being wiped and redrawn at every scroll tick, and ship blips only merge or split at each doubling of zoom (in between they move with the map).
- 2026-09-28: Replaced the inland contour rings with real terrain: shaded relief and height bands from elevation data.
- 2026-09-28: Lakes no longer get the inland contour rings; only the ocean coastline does.
- 2026-09-28: Added lakes and rivers. Inland ships now sit on real water. Map data file is now ~0.9 MB compressed (was ~0.6 MB).
- 2026-09-28: Clicking a ship blip can no longer leave you stuck on a circle at max zoom (ships fan out there instead). Clicks centre and zoom in far enough to split the blip in one go. Scroll zoom ~4× faster. Ship names no longer print on top of each other.
- 2026-09-28: Added depth: land looks raised (side wall, drop shadow, lit rim), the sea floor steps down in darker terraces with shadows at each shelf edge. Land colour slightly lighter (`#0d3b50`). Map data file grew from ~0.4 MB to ~0.6 MB (compressed).
- 2026-09-28: Redesigned ships: crowded areas become small clickable radar blips (ring split by ship type + count) instead of piles of dots; single ships got bigger holo arrows and a stopped-ship diamond.
- 2026-09-28: Endless east-west panning (loops around the globe; north-south still stops at the map edge). Coastlines that the map data cuts along the date line and the poles no longer show up as fake straight glowing lines.
- 2026-09-28: Ocean currents moved from Open-Meteo to NOAA CoastWatch: one free global grid shared by everyone, so no more API limits or "RATE LIMITED" messages. Trade-off: daily instead of hourly, and no tides.
- 2026-09-28: Tilt ↔ flat (T) is now an animated camera dip instead of an instant cut. Flat view is the tilted table scaled up (identical layout), and the table now matches the window's shape.
- 2026-09-28: Added the hold-E bearing tool (pixel-art style; label always sits opposite the arrow).
- 2026-09-28: Wind moved to NOAA GFS global grids (whole world, sharper, no rate limits). Removed fake straight lines across the oceans (artificial polygon seams in the depth-contour data). Fixed ocean currents failing at world zoom.
- 2026-09-28: Added live ships (AIS) with a SHIPS toggle. Ship types arrive every ~6 min per ship, so markers start blue-grey and gain colour over the first few minutes.
- 2026-09-28: Current/wind data now honours Open-Meteo's hourly and daily limits (waits for the right window and shows "API LIMIT · MORE IN N MIN" instead of retrying every minute).
- 2026-09-28: Fixed ocean streaks drifting inland (pixel-accurate land mask) and over-dense streaks when the view is mostly land. Fixed layer buttons not responding in Safari/WebKit (the map's drag handler was grabbing the click).
- 2026-09-28: Wind/current now chosen with clickable holo radio squares on the table (M key removed).
- 2026-09-28: Added wind mode.
- 2026-09-28: Built the holomap — real coastlines + depth contours, live Open-Meteo currents as CC2 pixel streaks, tilt/flat toggle, HUD, server-side caching for the free-tier limit.
