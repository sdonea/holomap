// Fuel-optimal sea route through the live current and wind fields.
// Model: the ship runs at constant engine power, so fuel burned is proportional to hours under way and
// the cheapest route is the fastest one. Speed through water is `knots`, cut by headwind (added
// resistance) and nudged up by tailwind; the ship crabs into cross-currents to hold its track, so
// ground speed = sqrt(V² − cross²) + along. Wind is a forecast series, sampled at the hour the ship
// actually gets there. Distances are great-circle on a spherical earth and the finished legs are
// great-circle arcs, so long crossings bow poleward on the Mercator map like real ones.
// Search: time-dependent A* over a Mercator grid around both ends (Mercator is conformal, so each grid
// step's compass direction is exact; its length is scaled by cos(lat)), then pulled tight into the
// fewest great-circle legs that are no slower and stay clear of every cell touching land.
import { fromMerc, sample, toMerc, type Field } from "./geo.ts";

export type LonLat = [number, number];
// Wind fields[k] is valid `start + k*step` seconds after departure; before/after the series it holds.
export type WindSeries = { start: number; step: number; fields: Field[] };
export type Env = { current: Field | null; wind: WindSeries | null; knots: number };
// Land raster for a box: cell (i, j) spans merc x0 + i*step and y0 + j*step, one step each way.
// 0 = open water, 1 = water touching land (sailable, but no shortcuts through it), 2 = dry land,
// 3 = water too shallow (blocked like land, but a port's approach may cross it; see `pieces`).
export type LandMask = (x0: number, y0: number, step: number, cols: number, rows: number) => Uint8Array | Promise<Uint8Array>;
// search: the A* grid (Mercator corner x0,y0, cell size step, cols x rows), the cells in the order the
// search settled them with the fastest time to reach each (secs, aligned with order), and the raw grid path
// before it's pulled tight. For replaying how the planner worked ("watch it think").
export type Search = { x0: number; y0: number; step: number; cols: number; rows: number; order: Int32Array; secs: Float32Array; path: Int32Array };
export type Route = { pts: LonLat[]; hours: number; km: number; directHours: number | null; via: string[]; delayHours: number; search: Search };

// Calibration knobs: share of speed through water lost per m/s of headwind / gained per m/s of tailwind.
// 0.02 means a 30 kn (15 m/s) headwind costs 30%, in line with typical added-resistance figures for mid-size ships.
export const WIND_LOSS = 0.02, WIND_GAIN = 0.005;
const R = 6371e3, KN = 0.514444, N = 320; // N = grid cells along the box's long side
const D2R = Math.PI / 180;
const near = (d: number) => d - Math.round(d);

// Man-made canals and narrow straits, as centre lines [lon, lat]. Natural Earth draws the canals as solid
// land, and on a coarse grid a 14 km strait like Gibraltar rounds to land too, so each one is carved
// back in as a channel at least 1.6 cells wide. delay = lock/queue hours a transit adds (canals only).
export const PASSAGES: { name: string; delay?: number; line: LonLat[] }[] = [
  { name: "PANAMA CANAL", delay: 8, line: [[-79.92, 9.42], [-79.915, 9.33], [-79.922, 9.272], [-79.87, 9.21], [-79.75, 9.13], [-79.695, 9.115], [-79.66, 9.06], [-79.625, 9.017], [-79.592, 8.997], [-79.567, 8.955], [-79.53, 8.89], [-79.51, 8.84]] },
  { name: "SUEZ CANAL", delay: 4, line: [[32.33, 31.4], [32.31, 31.25], [32.32, 30.95], [32.32, 30.85], [32.29, 30.58], [32.35, 30.42], [32.4, 30.33], [32.47, 30.2], [32.57, 29.95], [32.62, 29.5], [32.85, 29.0], [33.15, 28.5], [33.5, 28.0], [33.85, 27.6]] }, // on down the narrow Gulf of Suez
  { name: "KIEL CANAL", delay: 2, line: [[9.08, 53.86], [9.145, 53.892], [9.27, 53.99], [9.28, 54.03], [9.66, 54.3], [10.14, 54.37], [10.2, 54.42]] },
  { name: "STRAIT OF GIBRALTAR", line: [[-6.4, 35.95], [-5.6, 35.97], [-5.0, 36.1]] },
  { name: "STRAIT OF DOVER", line: [[1.0, 50.5], [1.45, 51.0], [2.0, 51.25]] },
  { name: "BOSPORUS", line: [[28.97, 40.98], [29.03, 41.07], [29.07, 41.13], [29.12, 41.2], [29.14, 41.26]] },
  { name: "DARDANELLES", line: [[26.15, 40.02], [26.38, 40.2], [26.6, 40.35], [26.72, 40.44]] },
  { name: "BAB-EL-MANDEB", line: [[43.15, 13.0], [43.32, 12.6], [43.5, 12.4]] },
  { name: "STRAIT OF HORMUZ", line: [[55.9, 26.5], [56.4, 26.55], [56.9, 26.3]] },
  { name: "STRAIT OF MALACCA", line: [[98.5, 5.8], [100.0, 3.6], [101.2, 2.5], [102.3, 1.8], [103.2, 1.3], [103.5, 1.18], [103.85, 1.2], [104.3, 1.3]] },
  { name: "ØRESUND", line: [[12.65, 56.1], [12.68, 55.9], [12.75, 55.65], [12.85, 55.4]] },
  { name: "BERING STRAIT", line: [[-168.9, 66.5], [-169.0, 65.8], [-169.3, 65.2]] },
];

export function gcMetres([lon1, lat1]: LonLat, [lon2, lat2]: LonLat) {
  const a = Math.sin(((lat2 - lat1) * D2R) / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(((lon2 - lon1) * D2R) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Point a fraction t of the way along the great circle a -> b (slerp between unit vectors).
// ponytail: undefined for exactly antipodal ends (any great circle works there); nobody clicks those
export function gcAt(a: LonLat, b: LonLat, t: number): LonLat {
  const v = ([lon, lat]: LonLat) => [Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R)];
  const p = v(a), q = v(b);
  const w = Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
  if (w < 1e-12) return a;
  const k1 = Math.sin((1 - t) * w) / Math.sin(w), k2 = Math.sin(t * w) / Math.sin(w);
  const [x, y, z] = [0, 1, 2].map((i) => k1 * p[i] + k2 * q[i]);
  return [Math.atan2(y, x) / D2R, Math.atan2(z, Math.hypot(x, y)) / D2R];
}

// Wind at a place, t seconds after departure: linear between the two forecast steps around t.
export function windAt(ws: WindSeries | null, lon: number, lat: number, t: number): [number, number] | null {
  if (!ws) return null;
  const x = Math.min(ws.fields.length - 1, Math.max(0, (t - ws.start) / ws.step)), k = Math.floor(x), f = x - k;
  const a = sample(ws.fields[k], lon, lat);
  if (!a || !f) return a;
  const b = sample(ws.fields[k + 1], lon, lat);
  return b ? [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] : a;
}

// Seconds to cover d metres along track (tx, ty) = unit (east, north), in current (cu, cv) and wind
// (wu, wv), all m/s east/north. Infinity when the current beats the ship.
function secs(knots: number, d: number, tx: number, ty: number, cu: number, cv: number, wu: number, wv: number) {
  const head = -(wu * tx + wv * ty); // wind vectors point where the air goes, so blowing at the bow is positive
  const V = knots * KN * Math.max(0.3, 1 - (head > 0 ? WIND_LOSS : WIND_GAIN) * head);
  const cross = cu * ty - cv * tx, along = cu * tx + cv * ty;
  if (cross * cross >= V * V) return Infinity; // swept sideways faster than the ship can crab against it
  const g = Math.sqrt(V * V - cross * cross) + along;
  return g > 0.05 ? d / g : Infinity;
}

// Seconds to sail the great circle a -> b leaving t0 seconds after departure, sampling every pieceM metres.
export function legSeconds(env: Env, a: LonLat, b: LonLat, pieceM = 20e3, t0 = 0) {
  const n = Math.max(1, Math.ceil(gcMetres(a, b) / pieceM));
  let t = 0, p = a;
  for (let k = 1; k <= n; k++) {
    const q = gcAt(a, b, k / n), m = gcAt(a, b, (k - 0.5) / n);
    const [l1, f1, l2, f2] = [p[0] * D2R, p[1] * D2R, q[0] * D2R, q[1] * D2R];
    const e = Math.sin(l2 - l1) * Math.cos(f2); // initial bearing p -> q as a unit (east, north) vector
    const nn = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(l2 - l1);
    const len = Math.hypot(e, nn) || 1;
    const c = env.current && sample(env.current, m[0], m[1]);
    const w = windAt(env.wind, m[0], m[1], t0 + t);
    t += secs(env.knots, gcMetres(p, q), e / len, nn / len, c?.[0] ?? 0, c?.[1] ?? 0, w?.[0] ?? 0, w?.[1] ?? 0);
    p = q;
  }
  return t;
}

// 16 headings: the 8 neighbours plus knight moves, so the grid path isn't stuck on 45° zigzags.
const MOVES = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]].map(([di, dj]) => {
  const len = Math.hypot(di, dj);
  return { di, dj, len, tx: di / len, ty: -dj / len }; // grid rows run south, so north = -dj
});

export async function planRoute(a: LonLat, b: LonLat, env: Env, landMask: LandMask): Promise<Route | null> {
  // Tight box first; if land blocks every way through it, widen (coarser each time, but finds long
  // detours like around a continent).
  for (const pad of [0.3, 1.2, 3]) {
    const r = await attempt(a, b, env, landMask, pad);
    if (r) return r;
  }
  return null;
}

async function attempt(a: LonLat, b: LonLat, env: Env, landMask: LandMask, padF: number): Promise<Route | null> {
  // Box: both ends plus the great circle between them (it bows poleward), padded for detours.
  const [ax, ay] = toMerc(...a);
  let ux = ax, x0 = ax, x1 = ax, y0 = ay, y1 = ay;
  for (let k = 1; k <= 32; k++) {
    const [x, y] = toMerc(...gcAt(a, b, k / 32));
    ux += near(x - ux); // unwrapped, so a date-line crossing stays one piece
    x0 = Math.min(x0, ux); x1 = Math.max(x1, ux); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const pad = Math.max(x1 - x0, y1 - y0, 0.001) * padF;
  x0 -= pad; x1 += pad; y0 = Math.max(0, y0 - pad); y1 = Math.min(1, y1 + pad);
  if (x1 - x0 > 0.98) { const c = (x0 + x1) / 2; x0 = c - 0.49; x1 = c + 0.49; } // under one world, so x is unambiguous
  const step = Math.max(x1 - x0, y1 - y0) / N;
  const cols = Math.ceil((x1 - x0) / step), rows = Math.ceil((y1 - y0) / step), n = cols * rows;
  const land = await landMask(x0, y0, step, cols, rows);
  const cellM = step * 2 * Math.PI * R; // one cell in metres at the equator; times cos(lat) elsewhere
  const xc = (x0 + x1) / 2;
  const cellOf = ([lon, lat]: LonLat) => {
    const [x, y] = toMerc(lon, lat);
    const i = Math.floor((x + Math.round(xc - x) - x0) / step), j = Math.floor((y - y0) / step);
    return i >= 0 && j >= 0 && i < cols && j < rows ? j * cols + i : -1;
  };

  // Carve the passages: every cell within 0.8 cells of a centre line becomes open water.
  const passage = new Map<number, number>(); // cell -> PASSAGES index
  PASSAGES.forEach((ps, pi) => {
    // straits only matter when the grid is too coarse to see them; finer than 3 km the map's own water is right
    if (!ps.delay && cellM * Math.cos(ps.line[0][1] * D2R) < 3e3) return;
    for (let k = 1; k < ps.line.length; k++) {
      const [px, py] = toMerc(...ps.line[k - 1]), [qx, qy] = toMerc(...ps.line[k]);
      const m = Math.ceil((4 * Math.hypot(qx - px, qy - py)) / step) + 1;
      for (let s = 0; s <= m; s++) {
        const x = px + ((qx - px) * s) / m, y = py + ((qy - py) * s) / m;
        const ci = (x + Math.round(xc - x) - x0) / step, cj = (y - y0) / step;
        for (let j = Math.floor(cj - 0.8); j <= Math.floor(cj + 0.8); j++)
          for (let i = Math.floor(ci - 0.8); i <= Math.floor(ci + 0.8); i++) {
            if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
            land[j * cols + i] = 0;
            passage.set(j * cols + i, pi);
          }
      }
    }
  });

  // A shortcut is clear if samples every third of a cell along its great circle touch no land at all.
  const clear = (p: LonLat, q: LonLat) => {
    const [px, py] = toMerc(...p), [qx, qy] = toMerc(...q);
    const m = Math.ceil((3 * Math.hypot(near(qx - px), qy - py)) / step) + 1;
    for (let k = 0; k <= m; k++) {
      const c = cellOf(gcAt(p, q, k / m));
      if (c < 0 || land[c]) return false;
    }
    return true;
  };
  // Sailable water in connected pieces, joined the way the search moves (straight, or diagonal past one
  // open side). A click on land or shallows, or a harbour whose dredged channel the depth data doesn't
  // show (New York's Narrows sits behind the shallow Lower Bay), can land in a pocket that can't reach the
  // other end, so both ends snap to the nearest cells of one piece they share.
  const piece = new Int32Array(n).fill(-1), stack: number[] = [];
  for (let c0 = 0, id = 0; c0 < n; c0++) {
    if (land[c0] >= 2 || piece[c0] >= 0) continue;
    piece[c0] = id;
    stack.push(c0);
    while (stack.length) {
      const c = stack.pop()!, i = c % cols, j = (c / cols) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ni = i + di, nj = j + dj, q = nj * cols + ni;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows || land[q] >= 2 || piece[q] >= 0) continue;
          if (di && dj && land[j * cols + ni] && land[nj * cols + i]) continue;
          piece[q] = id;
          stack.push(q);
        }
    }
    id++;
  }
  // Nearest cell of every piece p can reach within 40 steps without crossing dry land (shallows are fine:
  // that's a harbour approach): piece -> [cell, steps]. A click on dry land starts from the nearest cell
  // that isn't.
  const pieces = (p: LonLat) => {
    let c = cellOf(p);
    const m = new Map<number, [number, number]>();
    if (c < 0) return m;
    if (land[c] === 2) {
      const ci = c % cols, cj = (c / cols) | 0;
      let bd = Infinity;
      c = -1;
      for (let dj = -40; dj <= 40; dj++)
        for (let di = -40; di <= 40; di++) {
          const i = ci + di, j = cj + dj, d = di * di + dj * dj;
          if (i >= 0 && j >= 0 && i < cols && j < rows && land[j * cols + i] !== 2 && d < bd) { bd = d; c = j * cols + i; }
        }
      if (c < 0) return m;
    }
    const steps = new Map([[c, 0]]), queue = [c];
    for (let h = 0; h < queue.length; h++) {
      const q = queue[h], d = steps.get(q)!, k = piece[q];
      if (k >= 0 && !m.has(k)) m.set(k, [q, d]); // breadth-first, so the first cell seen is the nearest
      if (d >= 40) continue;
      const i = q % cols, j = (q / cols) | 0;
      for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        const r = nj * cols + ni;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows || land[r] === 2 || steps.has(r)) continue;
        steps.set(r, d + 1);
        queue.push(r);
      }
    }
    return m;
  };
  const pb = pieces(b);
  let s = -1, e = -1, sd = Infinity;
  for (const [k, [ca, da]] of pieces(a)) {
    const hit = pb.get(k);
    if (hit && da + hit[1] < sd) { sd = da + hit[1]; s = ca; e = hit[0]; }
  }
  if (s < 0 || e < 0) return null;

  // Cell centres and each sailable cell's current, sampled once (currents barely change over a voyage).
  const lon = Float64Array.from({ length: cols }, (_, i) => (x0 + (i + 0.5) * step) * 360 - 180);
  const lat = Float64Array.from({ length: rows }, (_, j) => fromMerc(0, y0 + (j + 0.5) * step)[1]);
  const cosl = lat.map((f) => Math.cos(f * D2R));
  const cu = new Float32Array(n), cv = new Float32Array(n);
  if (env.current)
    for (let c = 0; c < n; c++) {
      const cc = land[c] < 2 && sample(env.current, lon[c % cols], lat[(c / cols) | 0]);
      if (cc) { cu[c] = cc[0]; cv[c] = cc[1]; }
    }

  // Time-dependent A*: g is seconds since departure, and the wind for a step is read where and when the
  // ship leaves its cell. Heuristic: straight-line distance at a speed the ship can never beat (admissible).
  const goal: LonLat = [lon[e % cols], lat[(e / cols) | 0]];
  const vmax = env.knots * KN * (1 + WIND_GAIN * 40) + 3;
  const h = (c: number) => gcMetres([lon[c % cols], lat[(c / cols) | 0]], goal) / vmax;
  const g = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const open = heap();
  const blocked = (c: number) => land[c] >= 2;
  const order: number[] = [], reached: number[] = [];
  g[s] = 0;
  open.push(s, h(s));
  while (open.size) {
    const c = open.pop();
    if (done[c]) continue;
    done[c] = 1;
    order.push(c);
    reached.push(g[c]);
    if (c === e) break;
    const i = c % cols, j = (c / cols) | 0;
    const w = windAt(env.wind, lon[i], lat[j], g[c]), wu = w?.[0] ?? 0, wv = w?.[1] ?? 0;
    for (const { di, dj, len, tx, ty } of MOVES) {
      const ni = i + di, nj = j + dj, nc = nj * cols + ni;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows || blocked(nc) || done[nc]) continue;
      // slanted steps must not clip land: a diagonal needs one fully open side, a knight move both
      // cells it crosses fully open (touching land only allows straight steps, which hug the coast)
      if (len < 2 && di && dj && land[j * cols + ni] && land[nj * cols + i]) continue;
      if (len > 2 && (Math.abs(di) === 2
        ? land[j * cols + i + di / 2] || land[nj * cols + i + di / 2]
        : land[(j + dj / 2) * cols + i] || land[(j + dj / 2) * cols + ni])) continue;
      const t = secs(env.knots, len * cellM * (cosl[j] + cosl[nj]) / 2, tx, ty, (cu[c] + cu[nc]) / 2, (cv[c] + cv[nc]) / 2, wu, wv);
      if (g[c] + t < g[nc]) {
        g[nc] = g[c] + t;
        from[nc] = c;
        open.push(nc, g[nc] + h(nc));
      }
    }
  }
  if (!done[e]) return null;

  const path: number[] = [];
  for (let c = e; c !== -1; c = from[c]) path.unshift(c);
  const via = [...new Set(path.filter((c) => passage.has(c)).map((c) => passage.get(c)!))].map((pi) => PASSAGES[pi]);
  const cells = path.map((c): LonLat => [lon[c % cols], lat[(c / cols) | 0]]);
  // the exact clicked points replace their own cells; snapped clicks keep a short connector
  const pts = [a, ...cells.slice(cellOf(a) === s ? 1 : 0, cells.length - (cellOf(b) === e ? 1 : 0)), b];

  // Pull the grid path tight: from each point, jump to the farthest later point whose direct great
  // circle is clear and no slower than the path it replaces.
  const pieceM = Math.max(500, cellM * Math.cos(((lat[0] + lat[rows - 1]) / 2) * D2R));
  const pre = [0];
  for (let k = 1; k < pts.length; k++) pre.push(pre[k - 1] + legSeconds(env, pts[k - 1], pts[k], pieceM, pre[k - 1]));
  const out = [a];
  let total = 0;
  for (let i = 0; i < pts.length - 1;) {
    let j = i + 1, t = legSeconds(env, pts[i], pts[j], pieceM, total);
    for (let k = i + 2; k < pts.length; k++) {
      if (!clear(pts[i], pts[k])) break;
      const tk = legSeconds(env, pts[i], pts[k], pieceM, total);
      if (tk > pre[k] - pre[i]) break;
      j = k;
      t = tk;
    }
    out.push(pts[j]);
    total += t;
    i = j;
  }
  const direct = clear(a, b) ? legSeconds(env, a, b, pieceM) : null;
  if (direct != null && direct <= total) { out.splice(1, out.length - 2); total = direct; }
  if (!Number.isFinite(total)) return null;
  let m = 0;
  for (let k = 1; k < out.length; k++) m += gcMetres(out[k - 1], out[k]);
  const canals = via.filter((p) => p.delay);
  return {
    pts: out, hours: total / 3600, km: m / 1000,
    directHours: direct != null && Number.isFinite(direct) ? direct / 3600 : null,
    via: canals.map((p) => p.name), delayHours: canals.reduce((sum, p) => sum + p.delay!, 0),
    search: { x0, y0, step, cols, rows, order: Int32Array.from(order), secs: Float32Array.from(reached), path: Int32Array.from(path) },
  };
}

// The pair whose fuel-optimal route beats its direct line by the most (saving = 1 − hours/directHours).
// Planning every pair is slow, so the direct line's slowdown against still water screens them all
// cheaply and only the top k get the full planner. Pairs whose direct line crosses land don't count.
export async function bestSaving<T extends { a: LonLat; b: LonLat }>(pairs: T[], env: Env, landMask: LandMask, k = 5) {
  const drag = (p: T) => 1 - gcMetres(p.a, p.b) / (env.knots * KN) / legSeconds(env, p.a, p.b);
  const top = pairs.map((p) => [drag(p), p] as const).sort((x, y) => y[0] - x[0]).slice(0, k);
  let best: { pair: T; saving: number } | null = null;
  for (const [, p] of top) {
    const r = await planRoute(p.a, p.b, env, landMask);
    const saving = r?.directHours ? 1 - r.hours / r.directHours : -Infinity;
    if (saving > (best?.saving ?? -Infinity)) best = { pair: p, saving };
  }
  return best;
}

// Binary min-heap of (id, key).
function heap() {
  const k: number[] = [], v: number[] = [];
  return {
    get size() { return v.length; },
    push(id: number, key: number) {
      let i = v.length;
      k.push(key); v.push(id);
      while (i) {
        const p = (i - 1) >> 1;
        if (k[p] <= key) break;
        k[i] = k[p]; v[i] = v[p]; i = p;
      }
      k[i] = key; v[i] = id;
    },
    pop() {
      const top = v[0], lk = k.pop()!, lv = v.pop()!;
      if (v.length) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= v.length) break;
          if (c + 1 < v.length && k[c + 1] < k[c]) c++;
          if (k[c] >= lk) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lk; v[i] = lv;
      }
      return top;
    },
  };
}
