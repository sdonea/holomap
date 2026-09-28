// Run with the dev server up: node lib/wind.check.ts [http://localhost:PORT]
// Sanity-checks the decoded GFS grid against physics that always holds, so a GRIB decoding bug
// (garbage, swapped u/v, flipped rows) fails loudly.
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:3000";
const res = await fetch(`${base}/api/wind`);
assert.equal(res.status, 200, "wind route failed");
const a = new Int16Array(await res.arrayBuffer());
const C = 721, R = 361, N = C * R;
assert.equal(a.length, 2 * N, "grid size");

const u = (j: number, i: number) => a[j * C + i] / 100;
const v = (j: number, i: number) => a[N + j * C + i] / 100;
const row = (lat: number) => Math.round((lat + 90) / 0.5);
const bandMeanU = (lat0: number, lat1: number) => {
  let s = 0, n = 0;
  for (let j = row(lat0); j <= row(lat1); j++) for (let i = 0; i < C - 1; i++) { s += u(j, i); n++; }
  return s / n;
};

let max = 0, sum = 0;
for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
  const sp = Math.hypot(u(j, i), v(j, i));
  max = Math.max(max, sp);
  sum += sp;
}
const mean = sum / N;
assert.ok(mean > 4 && mean < 10, `global mean 10 m wind ${mean.toFixed(1)} m/s (expect ~5-8)`);
assert.ok(max < 90, `max ${max.toFixed(1)} m/s is not a real surface wind`);
// Trade winds blow from the east (u < 0); Southern Ocean westerlies blow from the west (u > 0).
// Southern trades (10-20°S) are used because northern ones are cancelled by monsoon westerlies in summer.
assert.ok(bandMeanU(-20, -10) < -2, `southern trades band mean u ${bandMeanU(-20, -10).toFixed(1)} should be easterly`);
assert.ok(bandMeanU(-60, -40) > 3, `westerlies band mean u ${bandMeanU(-60, -40).toFixed(1)} should be westerly`);
// Wrap column: lon 180 must equal lon -180.
for (let j = 0; j < R; j += 30) assert.equal(a[j * C + C - 1], a[j * C], "lon 180 != lon -180");

console.log(`wind checks ok (valid ${res.headers.get("x-valid-time")}, run ${res.headers.get("x-gfs-run")}, mean ${mean.toFixed(1)} m/s, max ${max.toFixed(1)} m/s)`);
