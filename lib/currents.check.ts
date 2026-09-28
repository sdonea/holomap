// Run with the dev server up: node lib/currents.check.ts [http://localhost:PORT]
// Sanity-checks the decoded CoastWatch current grid against ocean facts that always hold, so a
// decoding bug (garbage, swapped u/v, flipped rows, broken dateline wrap) fails loudly.
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:3000";
const res = await fetch(`${base}/api/currents`);
assert.equal(res.status, 200, "currents route failed");
const [lon0, lat0, step, C, R] = res.headers.get("x-grid")!.split(",").map(Number);
const a = new Int16Array(await res.arrayBuffer());
const N = C * R;
assert.equal(a.length, 2 * N, "grid size");

const at = (lon: number, lat: number) => Math.round((lat - lat0) / step) * C + Math.round((lon - lon0) / step);
const has = (k: number) => a[k] !== -32768;
const u = (k: number) => a[k] / 100, v = (k: number) => a[N + k] / 100;
const box = (w: number, e: number, s: number, n: number) => {
  const ks: number[] = [];
  for (let lat = s; lat <= n; lat += step) for (let lon = w; lon <= e; lon += step) if (has(at(lon, lat))) ks.push(at(lon, lat));
  return ks;
};
const fastest = (ks: number[]) => ks.reduce((b, k) => (Math.hypot(u(k), v(k)) > Math.hypot(u(b), v(b)) ? k : b));

assert.ok(!has(at(-98, 38)), "Kansas should be land");
assert.ok(has(at(-40, 30)), "mid-Atlantic should have data");

let sum = 0, n = 0, max = 0;
for (let k = 0; k < N; k++) if (has(k)) { const sp = Math.hypot(u(k), v(k)); sum += sp; n++; max = Math.max(max, sp); }
assert.ok(n / N > 0.5 && n / N < 0.8, `ocean share ${(n / N).toFixed(2)} (expect ~0.6-0.7)`);
assert.ok(sum / n > 0.05 && sum / n < 0.3, `global mean ${(sum / n).toFixed(2)} m/s (expect ~0.1)`);
assert.ok(max <= 3, `max ${max.toFixed(1)} m/s is not a real surface current`);

// Gulf Stream off Cape Hatteras: its core runs fast and north-east.
const gs = fastest(box(-76, -70, 34, 38));
assert.ok(Math.hypot(u(gs), v(gs)) > 0.8 && u(gs) > 0 && v(gs) > 0, `Gulf Stream core ${u(gs)},${v(gs)} m/s`);
// Kuroshio south of Japan: also a fast current.
const ku = fastest(box(130, 142, 30, 36));
assert.ok(Math.hypot(u(ku), v(ku)) > 0.8, "Kuroshio too slow");
// Antarctic Circumpolar Current: the Southern Ocean flows east on average.
const acc = box(-180, 179.75, -58, -48);
assert.ok(acc.reduce((s, k) => s + u(k), 0) / acc.length > 0.05, "Southern Ocean should flow east");

// Wrapped edge columns duplicate the far side so streaks cross the dateline.
for (let j = 0; j < R; j++) {
  assert.equal(a[j * C], a[j * C + C - 2], "west pad != 179.875°");
  assert.equal(a[j * C + C - 1], a[j * C + 1], "east pad != -179.875°");
}
console.log(`currents ok · ${res.headers.get("x-valid-time")} · Gulf Stream ${Math.hypot(u(gs), v(gs)).toFixed(2)} m/s`);
