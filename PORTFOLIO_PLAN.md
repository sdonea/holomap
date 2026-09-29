# Holomap portfolio plan

Goal: someone opens the link cold, on a laptop or a phone, and within 60 seconds understands what it
is, sees something impressive move, and tries it themselves. Five features, in build order. Each has a
"done when" list; nothing counts as done until it passes on the live preview at desktop (1400×850,
mouse) **and** phone (390×844, touch), with typecheck green, the `lib/*.check.ts` files passing, and no
console errors.

Name on anything public: **Sebastian "Seth" Donea**.

---

## 1. Findable tools, touch, shareable links, demo on load

Today every tool is a hidden hotkey (hold E, E + click, T, P) and nothing works by touch except panning.

**Build**
- **Toolbar on the table** (bottom centre, holo buttons in the existing style): `BEARING`, `ROUTE`,
  `CLEAR`, `?` (opens the About panel, item 5). The active tool glows.
  - Bearing tool: press and drag from A to B draws the bearing (on touch, drag measures instead of panning).
    Hold-E keeps working on desktop.
  - Route tool: tap the start, tap the destination. A hint line under the toolbar says what to tap next
    ("TAP START" → "TAP DESTINATION"). Hold-E + click keeps working.
- **Pinch to zoom** (two pointers), plus two-finger pan. Double-tap zooms in.
- **Phone layout**: the keyboard help panel is hidden under ~700 px wide (the toolbar replaces it);
  the table starts flat on small screens (tilted wastes a phone screen); the layer picker and HUD text
  shrink so nothing overlaps.
- **Shareable URL**: the hash holds the view, the layer, the speed and the route
  (`#@-71.00,36.50,2600km&l=ocean&kn=12&r=-75.2,35.1,-60.3,41.8`). Opening a link restores all of it and
  re-plots the route. The hash updates as you go (`history.replaceState`, debounced), so copying the
  address bar is sharing. A `SHARE` button copies the link and says "LINK COPIED".
- **Demo on first visit**: with no hash, once the map is up it plots one route itself (Cape Hatteras to
  south of Nova Scotia, riding the Gulf Stream) and shows a one-line hint: "Fuel-optimal route through
  today's Gulf Stream. Tap ROUTE to plot your own." The hint goes away on the first interaction; a
  returning visitor (localStorage flag) doesn't see it again.

**Done when**
- On a phone viewport: pinch zooms, drag pans, ROUTE → tap → tap plots a route, BEARING → drag measures.
- Copying the URL after plotting a route and opening it in a fresh tab shows the same view and route.
- A fresh visit shows the demo route + hint without touching anything; a second visit doesn't.

## 2. Real ships vs the optimal route

**Build**
- `lib/ports.ts`: ~150 major ports (UN/LOCODE, name, common AIS spellings, lat/lon) and
  `matchDestination(text)` for the free text ships send ("NL RTM", "ROTTERDAM", "USNYC", "NEW YORK",
  "BALBOA>SGSIN" → last port after `>`). Unknown text returns null rather than a guess.
- Ship panel gets a `ROUTE TO <PORT>` button when the destination matches a port. It plots the optimal
  route from the ship's current position to that port at the ship's own current speed.
- The comparison, kept honest to what AIS can tell us:
  - **Heading**: the ship's course over ground vs the optimal route's first leg ("ON THE OPTIMAL
    HEADING" within 10°, else "23° OFF THE OPTIMAL HEADING").
  - **Arrival**: the ship's reported ETA vs the planner's ETA at its current speed.
  - Its last 6 h of track (already drawn) next to the optimal line.
  - We can't know its whole-voyage fuel, so no fake "X% wasted" number.
- If there's no API key or no match, the button isn't shown (the panel says "DESTINATION NOT RECOGNISED"
  under the raw text).

**Done when**
- `lib/ports.check.ts` proves the matcher on real AIS spellings (including `>` chains and LOCODEs) and
  that nonsense returns null.
- In the preview, clicking a live ship with a known destination plots its route and shows the heading +
  ETA comparison.

## 3. Fuel economics

**Build**
- `lib/economics.ts`: for the plotted route's path, cost at every speed option, using the planner's own
  leg timing (same path, speed swapped, so it's fast):
  - fuel tonnes (burn/day ∝ speed³, calibrated at `FUEL_T_PER_DAY` @ 12 kn)
  - fuel $ = tonnes × fuel price (default $600/t, VLSFO ballpark)
  - CO₂ = tonnes × 3.15 (VLSFO emission factor)
  - time cost $ = days × charter rate (default $20,000/day)
  - total = fuel $ + time $, and the **cheapest speed** (the slow-steaming trade-off).
- **Route panel** (right side of the table, like the ship panel; replaces the long amber label, which
  shrinks to two lines at the destination): distance, time, ETA, canal, fuel t, fuel $, CO₂, vs direct,
  plus a small **cost-vs-speed chart** (fuel $, time $, total; the minimum marked) with editable fuel
  price and charter rate. Clicking a speed on the chart re-plots at that speed.

**Done when**
- `lib/economics.check.ts` proves: cube law, cheapest speed falls as fuel price rises and rises as
  charter rate rises, CO₂ factor.
- Changing fuel price in the panel moves the marked cheapest speed; clicking it re-plots.

## 4. Voyage playback

**Build**
- The route keeps the time at every drawn point (from the planner's leg timing, forecast wind included).
- Route panel gets a timeline: ▶/❚❚, a scrubber, and the clock ("DAY 3 · 14:00Z"). Playing runs about
  one voyage-day per 2 seconds.
- An amber ship marker moves along the route, pointing along it; the HUD shows the wind and current at
  the ship at that moment.
- With the WIND layer on, the streaks show the **forecast wind at that time** inside the route's forecast
  box (live wind outside it), so you watch weather move past the ship.
- Space toggles play; dragging the scrubber pauses.

**Done when**
- Play runs start to finish and stops at the destination; scrubbing jumps the marker; wind streaks
  visibly change between day 0 and day 5 of a long route.

## 5. "How it works" panel

**Build**
- `?` in the toolbar opens an overlay (Esc / × closes): what you're looking at, where each dataset comes
  from (NOAA CoastWatch, NOAA GFS, AIS, AWS terrain, Natural Earth), and how the route planner works
  (fuel model, A* on a Mercator grid, great circles, canals, depth, forecast wind), with one small
  diagram (grid path → pulled-tight great-circle legs). Plain language first, technical detail below.
- Credit line "Built by Sebastian "Seth" Donea" and a link to the GitHub repo.
- Page `<title>`/description and an Open Graph image (a screenshot of the table) so the link previews
  well when shared.

**Done when**
- Opens from the toolbar and from `?` key, reads well on a phone (scrolls), closes with Esc/×/outside tap.

---

## Needs a decision from Seth (not blocking the build)

**Live ships when this is hosted.** The ship feed needs one server that stays connected to aisstream.
On Vercel (serverless) each request can land on a fresh instance, so ships would be patchy. Options:
1. Host the whole app on an always-on box (Railway / Fly.io / Render, roughly $5/month). Simplest, ships work fully.
2. Vercel for the site + a tiny always-on worker that writes ships to Redis (Upstash, free tier). More moving parts.
3. Vercel only, ships labelled as best-effort. Free, but the ship features (item 2) will often look empty.

Everything else (currents, wind, terrain, routing) works anywhere.

## Code layout

`components/Holomap.tsx` is already ~1,600 lines. New UI goes in its own files so it stays readable:
`components/RoutePanel.tsx` (item 3 + 4), `components/AboutPanel.tsx` (item 5), `components/Toolbar.tsx`
(item 1). Pure logic in `lib/ports.ts`, `lib/economics.ts`, each with a `*.check.ts`. The map talks to the
panels through React state set from the drawing loop (the same pattern as the ship panel).

## Progress (all five built and verified 2026-09-28; hosting decision above still open)

Done and checked:
- `lib/ports.ts`: ~160 ports + `matchDestination` + `parseAisEta`. `lib/economics.ts`: cost at each speed, cheapest speed.
  Both proven by `node lib/ports.check.ts` (one check file covers both; real AIS strings from the live feed).
- `components/RoutePanel.tsx` (items 3 + 4 UI: stats, ship comparison, cost-by-speed chart with a validated
  palette, fuel price / charter inputs, playback controls) and `components/AboutPanel.tsx` (item 5 content +
  diagram + credit). Written, **not yet wired into the map or checked in the browser**.

Next: wire it all into `components/Holomap.tsx` (nothing there has changed yet this round). Design settled:
- React state: `toolUi`, `hint`, `demo`, `panel: "ship" | "route" | null` (replaces `shipOpen`), `routeInfo`,
  `play`, `market`, `about`, `copied`; one `api` ref (setTool, clear, shareUrl, play, seek, routeShip).
- Engine: `tool` + `bearingTo` (pinned bearing end for touch); pointer map for pinch + double-tap; route tool =
  tap start (reuse `bearingFrom` as the start mark) then tap destination; keys R / B / Space / ? and Esc steps
  back; ignore keys while typing in inputs.
- URL hash `v=lon,lat,km&l=wind&kn=10&r=lon1,lat1,lon2,lat2`, read at mount (view, layer, speed, pending route
  plotted after geo.json loads), written debounced from viewChanged / setRoute / layer / speed.
- Demo: no `r` in hash and no `holomap.seen` in localStorage → plot (-74.9, 35.2) → (-63.5, 43.0), show hint,
  set the flag.
- `show()` also computes per-point times (playback), `bySpeed` (same path timed at every speed, for the chart),
  first-leg bearing vs ship COG; label shrinks to 2 lines and opens the route panel on click; panel auto-opens
  on plot when wider than 700 px.
- Playback: advance `playT` in the frame loop (whole voyage in 8–25 s), amber ship marker on the route,
  `flowAt()` swaps streaks to forecast wind at `playT` when WIND is on; push `play` state at ~8 Hz.
- Phone: start flat under 700 px, hide the key-help box and lat/lon readout, toolbar bottom-centre.
- Then: OG image (`app/opengraph-image.png`) + title/description, SITE.md, full desktop + phone verification.

- [x] 1. Findable tools, touch, shareable links, demo on load
- [x] 2. Real ships vs the optimal route
- [x] 3. Fuel economics
- [x] 4. Voyage playback
- [x] 5. How it works panel + OG image
- [x] SITE.md updated for all of it
