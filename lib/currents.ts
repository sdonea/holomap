import type { Field } from "./geo";

export type Layer = "ocean" | "wind";

// Both layers are one global grid from our own server (/api/currents, /api/wind): Int16 in 0.01 m/s,
// -32768 = no data, geometry in the x-grid header (lon0,lat0,step,cols,rows). Reused for every pan/zoom.
const grids: Partial<Record<Layer, { field: Field; hour: string }>> = {};
export async function loadGrid(layer: Layer, signal: AbortSignal): Promise<Field> {
  const hour = new Date(Math.round(Date.now() / 3600_000) * 3600_000).toISOString();
  const hit = grids[layer];
  if (hit?.hour === hour) return hit.field;
  const res = await fetch(layer === "wind" ? "/api/wind" : "/api/currents", { signal });
  if (!res.ok) throw new Error(`${layer} ${res.status}`);
  const [lon0, lat0, step, cols, rows] = (res.headers.get("x-grid") ?? "").split(",").map(Number);
  const raw = new Int16Array(await res.arrayBuffer());
  const n = cols * rows;
  if (!n || raw.length !== 2 * n) throw new Error(`${layer} grid size mismatch`);
  const field: Field = {
    step, lon0, lat0, cols, rows,
    u: Float32Array.from(raw.subarray(0, n), (x) => x / 100),
    v: Float32Array.from(raw.subarray(n), (x) => x / 100),
    ok: Uint8Array.from(raw.subarray(0, n), (x) => (x === -32768 ? 0 : 1)),
    time: res.headers.get("x-valid-time") ?? "",
  };
  grids[layer] = { field, hour };
  return field;
}
