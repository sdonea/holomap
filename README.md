# Holomap

A live map of the real ocean, drawn like the holotable in Carrier Command 2, with a fuel-optimal route
planner. Pick two points and it plots the route a ship should sail to burn the least fuel through today's
ocean currents and the wind forecast, around land and through the canals.

<!-- daily-route:start -->
### Today's best Gulf Stream trip · 2026-09-29

**Georges Bank to Charleston**: 8.6% less fuel than sailing the straight line (765 NM · 2 D 17 H at 12 kn).

![Today's fuel-optimal route through the Gulf Stream](https://github.com/sdonea/holomap/raw/daily/today.jpg?d=2026-09-29)

<sub>Updated every day by a GitHub Action: it opens the map like a first-time visitor, the planner compares 58
trips between nine points off the US East Coast on that day's currents, and the biggest saving is shown here.
Every day's pick is logged in <a href="docs/daily-routes.csv">docs/daily-routes.csv</a>.</sub>
<!-- daily-route:end -->

## What it does

- **Live ocean.** Drifting streaks are today's surface current (or the 10 m wind): each moves the way the water
  goes, brighter is faster. Blips are live ships from AIS, coloured by type. Land is real terrain; the sea
  steps darker with depth.
- **Fuel-optimal routes.** Tap a start and a destination, or tap two ports. The route panel shows distance,
  time, arrival, fuel, CO₂ and cost, with a cost-by-speed chart showing why ships slow down when fuel is dear.
- **Watch it think.** Turn it on in the ? panel and each route is preceded by a captioned replay of the
  search: rings of equal sailing time (isochrones, the classic weather-routing picture) spread from the start,
  stretching where the current helps and squeezing where it fights; when the wave reaches the destination the
  fastest chain of cells is traced back, then pulled tight into the final straight legs.
- **Real ships vs the optimum.** Click a ship headed for a known port and compare its heading and reported
  ETA with the optimal route from where it is now.
- **Voyage playback** with the forecast wind moving past, and **share links** that restore the exact view and route.

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

The core is `lib/route.ts`, with runnable checks in `lib/route.check.ts` (straight lines in still water,
wind and current physics, canals, the date line, the search replay and the demo picker).

## Data (all free and public)

[NOAA CoastWatch](https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily.html) surface currents
(daily) · [NOAA GFS](https://registry.opendata.aws/noaa-gfs-bdp-pds/) wind and 16-day forecast ·
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

Built by Sebastian "Seth" Donea.
