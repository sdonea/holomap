import type { Field } from "./geo";

// Client side of the flow grid (ocean current or wind). Talks to /api/currents (server cache in
// front of Open-Meteo), never asks for points `skip` rules out, and keeps what it has for 15 min.
const TTL = 15 * 60 * 1000;

export type Layer = "ocean" | "wind";

// Wind: one global 0.5° GFS grid from /api/wind (Int16, 0.01 m/s), reused for every pan/zoom.
let wind: { field: Field; hour: string } | null = null;
export async function loadWindField(signal: AbortSignal): Promise<Field> {
  const hour = new Date(Math.round(Date.now() / 3600_000) * 3600_000).toISOString();
  if (wind?.hour === hour) return wind.field;
  const res = await fetch("/api/wind", { signal });
  if (!res.ok) throw new Error(`wind ${res.status}`);
  const raw = new Int16Array(await res.arrayBuffer());
  const cols = 721, rows = 361, n = cols * rows;
  if (raw.length !== 2 * n) throw new Error("wind grid size mismatch");
  const field: Field = {
    step: 0.5, lon0: -180, lat0: -90, cols, rows,
    u: Float32Array.from(raw.subarray(0, n), (x) => x / 100),
    v: Float32Array.from(raw.subarray(n), (x) => x / 100),
    ok: new Uint8Array(n).fill(1),
    time: res.headers.get("x-valid-time") ?? "",
  };
  wind = { field, hour };
  return field;
}
type Pt = { u: number; v: number; ok: boolean; t: number };
const cache = new Map<string, Pt>();
const key = (layer: Layer, lon: number, lat: number) => `${layer}:${lon.toFixed(4)},${lat.toFixed(4)}`;
let lastTime = "";

type Resp = { time: string; data: ([number, number] | null)[]; pending: number[]; retryAfter: number };

export async function loadField(
  layer: Layer,
  bounds: { west: number; east: number; south: number; north: number },
  step: number,
  signal: AbortSignal,
  skip: (lon: number, lat: number) => boolean,
): Promise<{ field: Field; retryAfter: number }> {
  const lon0 = Math.floor(bounds.west / step) * step;
  const lat0 = Math.max(-80, Math.floor(bounds.south / step) * step);
  const cols = Math.ceil((bounds.east - lon0) / step) + 2;
  const rows = Math.ceil((Math.min(85, bounds.north) - lat0) / step) + 2;
  const at = (idx: number): [number, number] => [lon0 + (idx % cols) * step, lat0 + Math.floor(idx / cols) * step];

  const now = Date.now();
  const skipped = new Uint8Array(cols * rows);
  const need: [number, number][] = [];
  for (let idx = 0; idx < cols * rows; idx++) {
    const [lon, lat] = at(idx);
    // grid pads past the view edge, which at world zoom runs off the pole (server rejects |lat| > 90)
    if (Math.abs(lat) > 90 || skip(lon, lat)) { skipped[idx] = 1; continue; }
    const hit = cache.get(key(layer, lon, lat));
    if (!hit || now - hit.t > TTL) need.push([lon, lat]);
  }

  let retryAfter = 0;
  if (need.length) {
    const res = await fetch("/api/currents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ layer, points: need }),
      signal,
    });
    if (!res.ok) throw new Error(`currents ${res.status}`);
    const r = (await res.json()) as Resp;
    const pending = new Set(r.pending);
    r.data.forEach((d, i) => {
      if (pending.has(i)) return; // rate-limited upstream; ask again later
      cache.set(key(layer, need[i][0], need[i][1]), d ? { u: d[0], v: d[1], ok: true, t: now } : { u: 0, v: 0, ok: false, t: now });
    });
    lastTime = r.time;
    retryAfter = r.retryAfter;
  }

  const field: Field = {
    step, lon0, lat0, cols, rows,
    u: new Float32Array(cols * rows),
    v: new Float32Array(cols * rows),
    ok: new Uint8Array(cols * rows),
    time: lastTime,
  };
  for (let idx = 0; idx < cols * rows; idx++) {
    if (skipped[idx]) continue;
    const p = cache.get(key(layer, ...at(idx)));
    if (!p?.ok) continue;
    field.u[idx] = p.u;
    field.v[idx] = p.v;
    field.ok[idx] = 1;
  }
  return { field, retryAfter };
}
