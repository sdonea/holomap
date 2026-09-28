// Web Mercator on the unit square: x,y in [0,1], y grows southward (same as screen).
const MAX_LAT = 85;

export function toMerc(lon: number, lat: number): [number, number] {
  const s = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

export function fromMerc(x: number, y: number): [number, number] {
  return [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI];
}

// Open-Meteo ocean_current_direction is where the water is GOING: 0° = north, 90° = east.
// Returns [east, north] in m/s. Mercator is conformal, so on screen: dx = east, dy = -north.
export function toUV(kmh: number, dirDeg: number): [number, number] {
  const ms = kmh / 3.6;
  const r = (dirDeg * Math.PI) / 180;
  return [ms * Math.sin(r), ms * Math.cos(r)];
}

// Rhumb line (constant compass heading) between two points. On Mercator a straight line IS a rhumb
// line, so this bearing matches the arrow drawn on screen exactly. Bearing in degrees true
// (0 = north, clockwise), distance in km. Formulas: Movable Type "rhumb lines".
export function rhumb(lon1: number, lat1: number, lon2: number, lat2: number): { bearing: number; km: number } {
  const r = Math.PI / 180;
  const p1 = lat1 * r, p2 = lat2 * r;
  const dp = p2 - p1;
  let dl = (lon2 - lon1) * r;
  if (Math.abs(dl) > Math.PI) dl = dl > 0 ? dl - 2 * Math.PI : dl + 2 * Math.PI; // shorter way round
  const dpsi = Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
  const q = Math.abs(dpsi) > 1e-12 ? dp / dpsi : Math.cos(p1); // E-W line: psi is ill-conditioned
  const bearing = ((Math.atan2(dl, dpsi) / r) + 360) % 360;
  return { bearing, km: Math.hypot(dp, q * dl) * 6371 };
}

export type Field = {
  step: number; // grid spacing in degrees
  lon0: number;
  lat0: number;
  cols: number;
  rows: number;
  u: Float32Array; // east m/s, row-major, rows go south -> north
  v: Float32Array; // north m/s
  ok: Uint8Array; // 0 = land / no data
  time: string; // model timestamp (UTC)
};

// Bilinear on u/v (never on angles, which break at 359° -> 0°). Land corners are dropped
// and the remaining weights renormalised, so flow runs right up to the coast.
export function sample(f: Field, lon: number, lat: number): [number, number] | null {
  const gx = (lon - f.lon0) / f.step;
  const gy = (lat - f.lat0) / f.step;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  if (i < 0 || j < 0 || i >= f.cols - 1 || j >= f.rows - 1) return null;
  const tx = gx - i;
  const ty = gy - j;
  let u = 0, v = 0, w = 0;
  for (let k = 0; k < 4; k++) {
    const di = k & 1, dj = k >> 1;
    const idx = (j + dj) * f.cols + i + di;
    if (!f.ok[idx]) continue;
    const wk = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty);
    u += f.u[idx] * wk;
    v += f.v[idx] * wk;
    w += wk;
  }
  // Mostly-land cell: treat as land rather than extrapolate one far corner.
  return w < 0.25 ? null : [u / w, v / w];
}

// Grid step (degrees) so a view spanning `lonSpan` gets at most ~`target` columns.
// Open-Meteo bills per point, so this is the knob trading sharpness against the free-tier budget.
// Floor is 0.08°, the model's native resolution; finer would only interpolate.
const STEPS = [0.08, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
export function pickStep(lonSpan: number, target = 24): number {
  return STEPS.find((s) => s >= lonSpan / target) ?? 8;
}
