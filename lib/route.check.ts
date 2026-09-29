// Run: node lib/route.check.ts   — fails loudly if the fuel-optimal route planner breaks.
import assert from "node:assert/strict";
import { fromMerc, rhumb, type Field } from "./geo.ts";
import { gcAt, gcMetres, planRoute, WIND_GAIN, WIND_LOSS, type LandMask, type LonLat, type WindSeries } from "./route.ts";

const V = 12 * 0.514444; // 12 kn in m/s
const close = (a: number, b: number, rel = 0.01) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${a} != ${b}`);
const field = (fn: (lon: number, lat: number) => [number, number]): Field => {
  const step = 0.5, lon0 = -180, lat0 = -85, cols = 721, rows = 341, n = cols * rows;
  const f: Field = { step, lon0, lat0, cols, rows, time: "", u: new Float32Array(n), v: new Float32Array(n), ok: new Uint8Array(n).fill(1) };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) [f.u[j * cols + i], f.v[j * cols + i]] = fn(lon0 + i * step, lat0 + j * step);
  return f;
};
const steady = (f: Field): WindSeries => ({ start: 0, step: 3600, fields: [f] });
// Like the map's canvas raster: v = cell centre on land (2) or in shallows (3), 1 = land somewhere in the cell (3x3 samples), 0 = open.
const maskOf = (isLand: (lon: number, lat: number) => boolean, v = 2): LandMask => (x0, y0, s, cols, rows) => {
  const m = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const at = (fx: number, fy: number) => isLand(...fromMerc(x0 + (i + fx) * s, y0 + (j + fy) * s));
      m[j * cols + i] = at(0.5, 0.5) ? v : [0, 0.5, 1].some((fx) => [0, 0.5, 1].some((fy) => at(fx, fy))) ? 1 : 0;
    }
  return m;
};
const sea = maskOf(() => false);
const env = (current: Field | null = null, wind: WindSeries | null = null) => ({ current, wind, knots: 12 });
const hoursAt = (a: LonLat, b: LonLat, speed: number) => gcMetres(a, b) / speed / 3600;

// Still open sea: one great-circle leg (shorter than the rhumb line, bowing north), at plain ship speed.
const NY: LonLat = [-74, 40.5], LIS: LonLat = [-9.1, 38.7];
{
  const r = (await planRoute(NY, LIS, env(), sea))!;
  assert.equal(r.pts.length, 2);
  close(r.km, gcMetres(NY, LIS) / 1000, 1e-9);
  close(r.hours, hoursAt(NY, LIS, V), 1e-6);
  assert.equal(r.directHours, r.hours);
  assert.ok(r.km < rhumb(...NY, ...LIS).km - 50, "great circle beats the straight Mercator line");
  assert.ok(gcAt(NY, LIS, 0.5)[1] > 42, "the great circle bows poleward");
}

// Wind: 10 m/s from the east slows an eastbound ship by WIND_LOSS*10 and speeds a westbound one.
{
  const w = steady(field(() => [-10, 0]));
  close((await planRoute([0, 0], [10, 0], env(null, w), sea))!.hours, hoursAt([0, 0], [10, 0], V * (1 - WIND_LOSS * 10)));
  close((await planRoute([10, 0], [0, 0], env(null, w), sea))!.hours, hoursAt([0, 0], [10, 0], V * (1 + WIND_GAIN * 10)));
}

// Forecast: a headwind that dies after 10 h costs less than one that blows all trip (the planner reads
// the wind at the hour the ship gets there, not a snapshot).
{
  const head = field(() => [-10, 0]), calm = field(() => [0, 0]);
  const dying: WindSeries = { start: 0, step: 10 * 3600, fields: [head, calm] };
  const r = (await planRoute([0, 0], [10, 0], env(null, dying), sea))!;
  const full = hoursAt([0, 0], [10, 0], V * (1 - WIND_LOSS * 10)), none = hoursAt([0, 0], [10, 0], V);
  assert.ok(r.hours < full - 3 && r.hours > none + 1, `dying headwind ${r.hours} h, between ${none} and ${full}`);
}

// Cross-current: 2 m/s north across an eastbound track; the ship crabs, losing sqrt(V² − 4) of speed.
close((await planRoute([0, 0], [10, 0], env(field(() => [0, 2])), sea))!.hours, hoursAt([0, 0], [10, 0], Math.sqrt(V * V - 4)), 0.02);
// A 10 m/s current beats a 6 m/s ship: it can't hold any eastbound track, so there's no route.
assert.equal(await planRoute([0, 0], [10, 0], env(field(() => [0, 10])), sea), null);

// Jet: a 3 m/s eastward current 1.5-3.5° N. The best route detours up to ride it and beats the direct line.
{
  const r = (await planRoute([0, 0], [12, 0], env(field((_, lat) => (lat >= 1.5 && lat <= 3.5 ? [3, 0] : [0, 0]))), sea))!;
  assert.ok(Math.max(...r.pts.map((p) => p[1])) > 1.5, "route rides the jet");
  assert.ok(r.hours < r.directHours! * 0.97, `jet route ${r.hours} h vs direct ${r.directHours} h`);
}

// Land wall at 4-6° E with a gap at 4.5-5.5° N (outside the first, tight box, so a widened retry finds it).
{
  const wall = (lon: number, lat: number) => lon >= 4 && lon <= 6 && !(lat >= 4.5 && lat <= 5.5);
  const r = (await planRoute([0, 0], [10, 0], env(), maskOf(wall)))!;
  assert.equal(r.directHours, null);
  let worst = 0; // how far any leg strays onto land, in degrees
  for (let k = 1; k < r.pts.length; k++)
    for (let t = 0; t <= 1; t += 0.002) {
      const [lon, lat] = gcAt(r.pts[k - 1], r.pts[k], t);
      if (wall(lon, lat)) worst = Math.max(worst, Math.min(lon - 4, 6 - lon, lat < 4.5 ? 4.5 - lat : lat - 5.5));
    }
  assert.ok(worst === 0, `route cuts ${worst.toFixed(3)}° into the wall`);
  assert.ok(Math.max(...r.pts.map((p) => p[1])) > 4, "route goes through the gap");
  // no gap at all: no route
  assert.equal(await planRoute([0, 0], [10, 0], env(), maskOf((lon) => lon >= 4 && lon <= 6)), null);
}

// Shallows: a mask marking shallow water as 2 blocks it exactly like land.
{
  const r = (await planRoute([0, 0], [10, 0], env(), maskOf((lon, lat) => lon >= 4 && lon <= 6 && lat > -3 && lat < 3)))!;
  assert.ok(r.pts.some((p) => Math.abs(p[1]) > 2.5), "route goes around the shoal");
}

// Harbour pocket: the destination sits in deep water walled off by a ring of shallows (a port whose dredged
// channel the depth data doesn't show, like New York's Narrows). The route ends at the nearest water that
// actually connects, instead of snapping into the pocket and finding no way out.
{
  const ring = (lon: number, lat: number) => { const d = Math.hypot(lon - 10, lat); return d > 0.6 && d < 1.2; };
  const r = await planRoute([0, 0], [10, 0], env(), maskOf(ring, 3));
  assert.ok(r, "route to a walled-off harbour");
  assert.deepEqual(r!.pts[r!.pts.length - 1], [10, 0], "still ends at the clicked port");
  // the same ring of dry land (an inland lake) can't be reached from the sea
  assert.equal(await planRoute([0, 0], [10, 0], env(), maskOf(ring)), null);
}

// Canal: a land band across the whole world at 8.95-9.3° N (like the isthmus of Panama). The only way
// through is the carved Panama Canal, and the route reports it and its lock time.
{
  const r = (await planRoute([-79.9, 9.9], [-79.4, 8.3], env(), maskOf((_, lat) => lat >= 8.95 && lat <= 9.3)))!;
  assert.ok(r, "route through the canal");
  assert.deepEqual(r.via, ["PANAMA CANAL"]);
  assert.equal(r.delayHours, 8);
  // and a route that never needs it doesn't claim it
  assert.deepEqual((await planRoute(NY, LIS, env(), sea))!.via, []);
}

// Date line: Japan -> California goes the short way across the Pacific, not around the world.
{
  const r = (await planRoute([142, 35], [-125, 37], env(), sea))!;
  close(r.km, gcMetres([142, 35], [-125, 37]) / 1000, 1e-9);
  assert.ok(gcAt([142, 35], [-125, 37], 0.5)[1] > 45, "transpacific great circle arcs far north");
}

console.log("route checks ok");
