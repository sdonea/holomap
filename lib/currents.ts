import type { Field } from "./geo";

export type Layer = "ocean" | "wind";

// Both layers are one global grid from our own server (/api/currents, /api/wind): Int16 in 0.01 m/s,
// -32768 = no data, geometry in the x-grid header (lon0,lat0,step,cols,rows). Reused for every pan/zoom.
async function decode(res: Response, what: string): Promise<Field> {
  if (!res.ok) throw new Error(`${what} ${res.status}`);
  const [lon0, lat0, step, cols, rows] = (res.headers.get("x-grid") ?? "").split(",").map(Number);
  const raw = new Int16Array(await res.arrayBuffer());
  const n = cols * rows;
  if (!n || raw.length !== 2 * n) throw new Error(`${what} grid size mismatch`);
  return {
    step, lon0, lat0, cols, rows,
    u: Float32Array.from(raw.subarray(0, n), (x) => x / 100),
    v: Float32Array.from(raw.subarray(n), (x) => x / 100),
    ok: Uint8Array.from(raw.subarray(0, n), (x) => (x === -32768 ? 0 : 1)),
    time: res.headers.get("x-valid-time") ?? "",
  };
}

const grids: Partial<Record<Layer, { field: Field; hour: string }>> = {};
export async function loadGrid(layer: Layer, signal: AbortSignal): Promise<Field> {
  const hour = new Date(Math.round(Date.now() / 3600_000) * 3600_000).toISOString();
  const hit = grids[layer];
  if (hit?.hour === hour) return hit.field;
  const field = await decode(await fetch(layer === "wind" ? "/api/wind" : "/api/currents", { signal }), layer);
  grids[layer] = { field, hour };
  return field;
}

// Wind forecast every 6 h from departure until `hours` later (GFS reaches 16 days; past that the last
// step holds), cropped to the route's box [w, s, e, n]. start/step are seconds relative to now.
const STEP_H = 6;
export async function loadWindForecast(hours: number, box: number[]) {
  const t0 = Math.floor(Date.now() / (STEP_H * 3600_000)) * STEP_H * 3600_000;
  const n = Math.min(64, Math.ceil(hours / STEP_H) + 2);
  const q = box.map((v) => v.toFixed(1)).join(",");
  const got = await Promise.all(Array.from({ length: n }, (_, k) =>
    fetch(`/api/wind?at=${new Date(t0 + k * STEP_H * 3600_000).toISOString()}&box=${q}`)
      .then((r) => decode(r, "wind forecast"))
      .catch(() => null)));
  const fields: Field[] = [];
  for (const f of got) { if (!f) break; fields.push(f); } // keep the unbroken run from departure
  return fields.length ? { start: (t0 - Date.now()) / 1000, step: STEP_H * 3600, fields } : null;
}
