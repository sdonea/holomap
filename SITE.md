# Holomap

> A Carrier Command 2 style holotable showing live, real-world ocean currents.

## What it is
One full-screen page: a glowing tactical map of the real ocean, drawn like the CC2 holomap.
Opens on the Gulf Stream off the US East Coast. Coastlines glow cyan with inland contour
rings; blue lines offshore are real depth contours (200 m, 1000 m … 4000 m). The drifting
pixel streaks are the live surface current: each streak moves the way the water is going,
and brighter/longer means faster.

## First visit
With no link, the table opens on a demo: it plots a fuel-optimal route from Cape Hatteras to south of Nova
Scotia through today's Gulf Stream, opens the route panel, and shows one hint ("Tap ROUTE to plot your own").
The hint goes away at the first touch, click or key. A returning visitor doesn't get the demo again (the
browser remembers `holomap.seen`).

## Toolbar (bottom centre of the table)
- **BEARING** — press and drag to measure (on a phone, dragging measures instead of panning). The measurement
  stays pinned until you tap again, pick another tool, or press **Esc**. Key: **B**.
- **ROUTE** — tap the start, then the destination (the hint above the toolbar says which). Key: **R**.
- **CLEAR** — removes the route and any measurement.
- **SHARE** — copies a link to exactly this view, layer, speed and route ("LINK COPIED"). The address bar
  always holds the same link, so copying it works too: `#v=lon,lat,widthKm&l=wind&kn=10&r=lon1,lat1,lon2,lat2`.
  Opening a link restores all of it and re-plots the route.
- **?** — the "How it works" panel: what you're looking at, where the data comes from, how the planner works
  (with a small diagram), limits, keys, and the credit line. Key: **?**. Closes with ×, Esc or a click outside.

## Route panel (right side; a bottom sheet on phones)
Opens by itself when a route is plotted on a wide screen; on a phone, tap the amber label at the destination.
- Distance, time at sea, arrival (UTC), legs, canals, lock time, fuel saved vs the direct line.
- **Cost at this speed:** fuel (tonnes and $), CO₂, ship time $ and the total.
- **Cost by speed chart:** fuel $, ship time $ and total at every speed, with the cheapest speed marked.
  Hover/tap a speed for its numbers; click to re-plot at it. **SAIL AT CHEAPEST** does the same for the
  cheapest. The fuel price ($/t) and ship cost ($/day) boxes change the answer: dearer fuel → slow down.
- **Playback:** ▶ (or **Space**) sails the voyage: an amber ship moves along the route, about one voyage-day
  per 2 seconds, and the panel shows the day, time, and wind and current at the ship. With **WIND** on, the
  streaks near the route show the forecast wind for that moment, so you watch the weather move past. Drag
  the slider to scrub.
- The amber label on the map is now two lines (speed, distance and time); it hides while the panel is open.

## Real ships vs the optimal route
Click a ship. If its broadcast destination is a port the map knows (~160 major ports, `lib/ports.ts`), the
panel shows **ROUTE TO <PORT>**: it plots the optimal route from where the ship is now, at the ship's own
speed, and compares its **heading** with the route's first leg ("ON THE OPTIMAL HEADING" within 10°) and
its **reported ETA** with the optimal one. Once the route first appears, the map flies out (about a second) to show the
whole route, from the ship to the port, clear of the route panel and toolbar; grabbing or scrolling the map
stops the move. Margins are `top` / `bottom` / `side` in `flyToFit` in `components/Holomap.tsx`. AIS doesn't say how much fuel a ship burns, so there's no fuel
comparison. Unknown destinations say "DESTINATION NOT RECOGNISED". Changing the speed afterwards drops the
comparison (it's only fair at the ship's own speed).

## Phones and touch
Pinch to zoom, drag to pan, double-tap to zoom in. The table starts flat under 700 px wide, the keyboard
help, lat/lon readout, scale bar and the top bar's data credits are hidden (the credits are in the ? panel),
and the ship and route panels slide up from the bottom.

## Tab icon
`app/icon.svg` is the favicon: the "COURSE" mark on a 16×16 pixel grid (start square, dashed amber route,
destination diamond, a cyan coast and a current streak, inside the cyan holotable bezel). SVG, so it stays
sharp at every size. `app/apple-icon.png` (180×180) is the same pixels for iPhone home screens, which
ignore SVG. Next.js links both automatically. The default `favicon.ico` was removed.

## Sharing preview
`app/opengraph-image.png` (a 1200×630 screenshot of the demo) is what shows when the link is pasted into a
chat or social post; the title and description are in `app/layout.tsx`. To refresh it, screenshot the demo at
1200×630 and replace the file.

## Controls
- **Drag** or **W A S D** — pan. Going east or west never ends: you loop around the globe. North and south stop at the top and bottom of the map. Zooming out stops at one whole world across the screen.
- **Scroll** or **↑ / ↓** — zoom (about 1.8× per mouse-wheel notch; roughly 12 notches from the whole world to the closest zoom, ~20 km across)
- **Hold E** — bearing tool: drops a mark at the cursor; move the cursor and an arrow shows the compass bearing (0° = north, clockwise, with the arc drawn from north) plus distance in km and nautical miles. Lines and arc are chunky pixels to match the current streaks; the numbers sit on a dark plate in the HUD pixel font so they stay readable. On this map a straight line is a constant-heading course, so the number is the heading to steer. Release E to clear it.
- **Hold E + click** — fuel-optimal route: while holding E (the bearing's start mark is the departure point), click anywhere to set the destination. An amber dashed course appears: the route that burns the least fuel. The ship is assumed to run at constant engine power, so fuel burned goes up with time at sea. The route rides helpful currents (e.g. up the Gulf Stream), avoids foul ones and strong headwinds, goes around land, and stays out of water shallower than 15 m. **Wind is the forecast for the hour the ship actually gets there** (NOAA GFS, up to 16 days ahead; after that the last forecast holds). Currents are today's, since that data has no forecast (they change slowly). It goes **through the Panama, Suez and Kiel canals** (adding 8 h, 4 h and 2 h for locks and queues) and keeps narrow straits (Gibraltar, Dover, Bosporus, Dardanelles, Bab-el-Mandeb, Hormuz, Malacca/Singapore, Øresund, Bering) open even on long routes. Distances use the real round earth; open-water legs are great circles, the shortest path on a globe, which is why long crossings curve toward the pole on this flat map. It draws a first version at once, then refines it with the wind forecast. The amber label shows distance, time at sea, legs, arrival time (UTC), estimated fuel in tonnes, which canal it uses, and how much less fuel it burns than the direct line. The route stays after you let go of E; **Esc** clears it. Clicking on land or shallows (a port) starts or ends at the nearest deep water that actually connects to the other end, crossing shallows but never dry land to get there (so a harbour whose dredged channel the depth data doesn't show, like New York's, still works).
  - **SPEED ◀ ▶** (under SHIPS in the layer picker): 6 to 24 knots. Changing it re-plots the route. Fuel per day grows with the cube of speed, so slower is much cheaper per trip (e.g. Med to Arabian Sea: ~294 t at 12 kn, ~131 t at 8 kn).
  - Not modelled: canal tolls and booking, dredged harbour channels (so a port click connects straight from the nearest deep water), ice, piracy zones, traffic separation lanes, waves separately from wind.
  - To tune: in `components/Holomap.tsx`, `SPEEDS` / `SHIP_KN_START` (speed choices) and `MIN_DEPTH_M` (shallowest water allowed). In `lib/economics.ts`, `DEFAULT_MARKET`: fuel price, ship cost per day, `burn12` (tonnes per day at 12 kn; 25 suits a mid-size cargo ship) and the CO₂ factor. In `lib/route.ts`, `WIND_LOSS` / `WIND_GAIN` (how much head/tail wind slows or speeds the ship) and `PASSAGES` (canal and strait centre lines, lock delays).
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
- `components/Holomap.tsx` — the whole map: drawing, streaks, controls, HUD, table frame, ship panel
- `components/Toolbar.tsx` — the BEARING / ROUTE / CLEAR / SHARE / ? buttons and the hint line
- `components/RoutePanel.tsx` — route details, cost-by-speed chart, playback controls
- `components/AboutPanel.tsx` — the "How it works" overlay
- `lib/economics.ts` — voyage cost at each speed (fuel, CO₂, ship time, cheapest speed)
- `lib/ports.ts` — ~160 major ports and the matcher for ships' free-text destinations; `lib/ports.check.ts` proves it and the cost maths
- `lib/geo.ts` — map maths (projection, current direction → arrow, interpolation)
- `lib/currents.ts` — fetches the global current or wind grid from the server (once per hour per visitor)
- `app/api/currents/route.ts` — downloads + decodes the global NOAA current grid, caches it for 6 h
- `lib/currents.check.ts` — run `node lib/currents.check.ts http://localhost:<port>` to sanity-check the live current grid (Gulf Stream runs north-east, Southern Ocean flows east, land is empty)
- `lib/route.ts` — the fuel-optimal route planner (searches a grid around both ends, then straightens the path into great-circle legs)
- `lib/route.check.ts` — run `node lib/route.check.ts` to prove the planner still works (great circles, wind and current maths, forecast wind, riding a current jet, finding a gap in a wall of land without clipping it, going around shallows, the Panama Canal, the date line)
- `lib/geo.check.ts` — run `node lib/geo.check.ts` to prove map maths, flow interpolation and bearings are still correct
- `app/api/wind/route.ts` + `lib/grib2.ts` — global wind grid from NOAA GFS. `?at=<time>&box=w,s,e,n` returns a forecast hour cropped to an area (used by the route planner, ~50 KB per step)
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
  - **Click a ship** to open its info panel on the right of the table: type, name, MMSI, status (under way / anchored / moored…), speed, course, heading, destination, ETA, size, draught, call sign, IMO, position and how long ago it last reported, plus a MarineTraffic link. The ship gets corner brackets on the map and its **past course** is drawn behind it: an X at each position it reported over the last 6 hours, joined by straight lines, ending at the ship. The server keeps at most one report per 30 s per ship (one per 10 min while it sits still), and when zoomed out, Xs that would overlap are skipped (the line still passes through them). Tracks are recorded by the server while it runs, so right after a restart they start short and grow. It refreshes every 3 s. Close with ×, **Esc**, or by clicking empty map. Size, destination and call sign come from a separate AIS message each ship sends every ~6 min, so they show "--" until it arrives. Small boats (pleasure craft, small fishing boats) carry cheaper "Class B" transponders that never send status, destination, ETA, draught or IMO, so their panel says SMALL CRAFT (AIS CLASS B) and leaves those rows out.

## Recent changes
- 2026-09-28: The keyboard help in the bottom-left corner is now a small "? keys" chip (hover to see the list, click for the full How-it-works panel), so it no longer covers the coordinates.
- 2026-09-28: New tab icon (the COURSE pixel mark) and iPhone home-screen icon.
- 2026-09-28: ROUTE TO a ship's destination now zooms out to show the whole route.
- 2026-09-28: Portfolio round: toolbar (BEARING, ROUTE, CLEAR, SHARE, ?), touch (pinch, double-tap, tap-tap routes, drag-to-measure), shareable links in the address bar, a first-visit demo route, a route panel with fuel/CO₂/cost and a cost-by-speed chart, voyage playback with forecast wind, ROUTE TO a ship's destination with heading/ETA comparison, a "How it works" panel, phone layout, and a link preview image. Planner fix: routes to harbours behind shallows (e.g. New York) no longer fail.
- 2026-09-28: Route planner upgrades: goes through the Panama/Suez/Kiel canals and keeps narrow straits open, avoids shallow water, uses the wind forecast along the voyage, no longer cuts across headland corners, speed control with fuel-in-tonnes and arrival time, label no longer covers the route.
- 2026-09-28: Added the fuel-optimal route: hold E, click a destination, and the map plots the cheapest course through live currents and wind, around land, along great circles.
- 2026-09-28: Click a ship to open a live info panel (voyage, vessel size, position, MarineTraffic link).
- 2026-09-28: A clicked ship now shows its past course (last 6 h): X marks at each reported position, joined by lines.
- 2026-09-28: Small boats (AIS Class B) now get their type, call sign and size too (the server listens for their separate details message).
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
