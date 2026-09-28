// Run: node lib/geo.check.ts   — fails loudly if map/flow maths breaks.
import assert from "node:assert/strict";
import { sample, toMerc, fromMerc, rhumb, type Field } from "./geo.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// 1 m/s heading toward compass direction d (0 = north, 90 = east) as [east, north].
const toUV = (d: number): [number, number] => [Math.sin((d * Math.PI) / 180), Math.cos((d * Math.PI) / 180)];

// Screen: north is up (merc y decreases going north), east is right.
const [x0, y0] = toMerc(-70, 36), [x1, y1] = toMerc(-69, 37);
assert.ok(x1 > x0 && y1 < y0);
const [lon, lat] = fromMerc(...toMerc(-74.25, 40.5)); near(lon, -74.25, 1e-9); near(lat, 40.5, 1e-9);

// Interpolating 350° and 10° must give ~north, not south (the angle-averaging bug).
const f: Field = {
  step: 1, lon0: 0, lat0: 0, cols: 2, rows: 2, time: "",
  u: new Float32Array(4), v: new Float32Array(4), ok: new Uint8Array([1, 1, 1, 1]),
};
[[0, 350], [1, 10], [2, 350], [3, 10]].forEach(([i, d]) => ([f.u[i], f.v[i]] = toUV(d)));
const s = sample(f, 0.5, 0.5)!;
assert.ok(s[1] > 0.9 && Math.abs(s[0]) < 1e-6);
assert.deepEqual(sample(f, 360.5, 0.5), s); // the map repeats east-west: lon 360.5 is lon 0.5
assert.deepEqual(sample(f, -359.5, 0.5), s);

// Land corners are dropped; all-land returns null.
f.ok.set([1, 0, 0, 0]);
assert.equal(sample(f, 0.9, 0.9), null);
near(sample(f, 0.1, 0.1)![1], toUV(350)[1], 1e-6);

// Bearing tool: compass bearings (0 = N, clockwise) and rhumb distances.
near(rhumb(0, 0, 0, 1).bearing, 0); near(rhumb(0, 0, 0, 1).km, 111.195, 1e-3); // 1° of latitude
near(rhumb(0, 0, 1, 0).bearing, 90);
near(rhumb(0, 1, 0, 0).bearing, 180);
near(rhumb(0, 0, -1, 0).bearing, 270);
near(rhumb(0, 60, 1, 60).km, 111.195 * 0.5, 1e-2); // 1° of longitude at 60° is half as long
near(rhumb(179.5, 0, -179.5, 0).bearing, 90); // crossing the date line goes the short way
// Screen agreement: the arrow's angle on the Mercator map equals the rhumb bearing.
{
  const [ax, ay] = toMerc(-74, 40.5), [bx, by] = toMerc(-9.1, 38.7); // New York -> Lisbon
  const screen = ((Math.atan2(bx - ax, -(by - ay)) * 180) / Math.PI + 360) % 360;
  near(screen, rhumb(-74, 40.5, -9.1, 38.7).bearing, 1e-9);
}

console.log("geo checks ok");
