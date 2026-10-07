<div align="center">

<img src="app/icon.svg" width="72" alt="" />

# Holomap

**The real ocean on a Carrier Command 2 style holotable, with a planner that finds the route a ship
should sail to burn the least fuel through today's currents and wind.**

[![Daily route](https://github.com/sdonea/holomap/actions/workflows/daily-route.yml/badge.svg)](https://github.com/sdonea/holomap/actions/workflows/daily-route.yml)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Data: NOAA](https://img.shields.io/badge/data-NOAA%20%C2%B7%20AIS%20%C2%B7%20Natural%20Earth-0f3257)

**[Open the live map →](https://holomap-eight.vercel.app)**

[Features](#features) · [How the planner works](#how-the-planner-works) · [Under the hood](#under-the-hood) · [Run it](#run-it)

<img src="docs/holomap.gif" width="100%" alt="Holomap: live ocean currents drift across a glowing holotable, a fuel-optimal route is plotted through the Gulf Stream, and the view pulls back to the whole world" />

</div>

A straight line is the shortest way across the sea, but rarely the cheapest. The Gulf Stream runs at up to
2 m/s, which is a third of a 12-knot ship's speed: ride it and you're pushed along for free, fight it and every
mile takes half again as long. Holomap pulls today's surface currents, the 16-day wind forecast and live ship positions,
draws them on a glowing tactical table, and plans the route that spends the least time (and so fuel) at sea.

<!-- daily-route:start -->
### Today's best Gulf Stream trip · 2026-10-07

**Nova Scotia to Charleston**: 0.5% less fuel than sailing the straight line (976 NM · 3 D 13 H at 12 kn).

![Today's fuel-optimal route through the Gulf Stream](https://github.com/sdonea/holomap/raw/daily/today.jpg?d=2026-10-07)

<sub>Updated every day by a GitHub Action: it opens the map like a first-time visitor, the planner compares 58
trips between nine points off the US East Coast on that day's currents, and the biggest saving is shown here.
Every day's pick is logged in <a href="docs/daily-routes.csv">docs/daily-routes.csv</a>.</sub>
<!-- daily-route:end -->

## Features

| | |
|---|---|
| **Live ocean** | Drifting streaks are today's surface current, or the 10 m wind: each moves the way the water goes, brighter is faster. Land is real terrain; the sea steps darker with depth. |
| **Fuel-optimal routes** | Tap a start and a destination (or two of ~160 labelled ports). The route panel shows distance, time, arrival, fuel, CO₂ and cost, plus a cost-by-speed chart that shows why ships slow down when fuel is dear. |
| **Watch it think** | A captioned replay of the search (on by default, switch it off in the ? panel): rings of equal sailing time (isochrones, the classic weather-routing picture) spread from the start, stretching where the current helps and squeezing where it fights; the fastest path is traced back and pulled tight. |
| **Real ships vs the optimum** | Click a live ship headed for a known port and compare its heading and reported ETA with the optimal route from where it is now. |
| **Voyage playback** | Sail the route day by day with the forecast wind moving past. |
| **Share links** | The address bar always holds the exact view, layer, speed and route. |
| **A README that updates itself** | A daily GitHub Action finds the day's best Gulf Stream trip (above) and logs it to [`docs/daily-routes.csv`](docs/daily-routes.csv). |

## How the planner works

1. **Fuel model.** Constant engine power, so fuel is proportional to time at sea and the cheapest route is the
   fastest. Headwind costs 2% of speed per m/s; cross-currents make the ship crab; along-track current adds or
   subtracts. Burn per day follows speed³.
2. **Search.** Time-dependent A* on a ~320-cell Mercator grid around both ends, in 16 directions, reading each
   cell's current and the forecast wind for the hour the ship would get there. Distances are on a sphere.
3. **Pull tight.** The zig-zag grid path becomes the fewest great-circle legs that are no slower and never touch
   land, which is why long routes bow toward the pole on the flat map.
4. **Land and water.** Natural Earth coastlines, water shallower than 15 m is off limits, and the Panama, Suez
   and Kiel canals and narrow straits are carved back in so a coarse grid can't close them.

## Under the hood

- **No map library.** Coastlines, terrain, depth terraces, current streaks and ships are drawn by hand on four
  stacked canvases, tilted with a CSS 3D transform. Ship and port glows are batched into one draw per colour,
  which halved GPU load while panning on a Retina screen.
- **Its own GRIB2 decoder** (`lib/grib2.ts`) byte-ranges just the 10 m wind fields (~2 MB) out of NOAA's 500 MB
  GFS files on AWS, and the currents come from CoastWatch's ERDDAP as raw binary.
- **Plain-assert checks, no test framework.** `lib/*.check.ts` pin the physics (still water, wind, cross-current,
  canals, the date line), the port matcher, the search replay and the demo picker.

| Path | What's there |
|---|---|
| `lib/route.ts` | The planner: fuel model, A*, pull-tight, canals, the demo picker |
| `components/Holomap.tsx` | The table: drawing, input, route plotting, playback |
| `app/api/{currents,wind,ships}` | Data proxies: CoastWatch, GFS, aisstream.io |
| `scripts/daily-route.mjs` + `.github/workflows/daily-route.yml` | The self-updating README |

## Data

All free and public: [NOAA CoastWatch](https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily.html)
surface currents (daily) · [NOAA GFS](https://registry.opendata.aws/noaa-gfs-bdp-pds/) wind and 16-day forecast ·
[aisstream.io](https://aisstream.io) live ships · [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
land height and sea depth · [Natural Earth](https://www.naturalearthdata.com) coastlines and depth contours.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Everything works without keys except live ships: for those, create a free key at aisstream.io and put
`AISSTREAM_API_KEY=...` in `.env.local`.

Checks (Node 22.18+): `npm run typecheck`, `node lib/route.check.ts`, `node lib/ports.check.ts`,
`node lib/geo.check.ts`; with the dev server up, `node lib/currents.check.ts` and `node lib/wind.check.ts`
(pass the server's URL if it isn't `http://localhost:3000`).

---

<div align="center">Built by Sebastian "Seth" Donea · <a href="LICENSE">MIT License</a></div>
