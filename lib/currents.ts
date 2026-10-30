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

// One shared download per layer per hour. A caller's signal only stops that caller waiting: every pan/zoom
// calls refresh(), and aborting the fetch itself restarted the ~1 MB grid each time, so on a slow connection
// it never finished.
const grids: Partial<Record<Layer, { p: Promise<Field>; hour: string; field?: Field }>> = {};
const hourNow = () => new Date(Math.round(Date.now() / 3600_000) * 3600_000).toISOString();
export async function loadGrid(layer: Layer, signal: AbortSignal): Promise<Field> {
  const hour = hourNow();
  let hit = grids[layer];
  if (hit?.hour !== hour) {
    const p = fetch(layer === "wind" ? "/api/wind" : "/api/currents").then((r) => decode(r, layer));
    p.then(
      (f) => { if (grids[layer]?.p === p) grids[layer].field = f; },
      () => { if (grids[layer]?.p === p) delete grids[layer]; }, // failed: let the next call retry
    );
    grids[layer] = hit = { p, hour };
  }
  signal.throwIfAborted();
  return Promise.race([hit.p, new Promise<never>((_, no) => signal.addEventListener("abort", () => no(signal.reason), { once: true }))]);
}

// The grid if it has already arrived this hour, without waiting for it.
export const readyGrid = (layer: Layer): Field | null => (grids[layer]?.hour === hourNow() ? grids[layer]?.field ?? null : null);

// Wind forecast from departure until `hours` later (GFS reaches 16 days; past that the last step holds),
// cropped to the route's box [w, s, e, n], as one field per 6 h (start/step in seconds relative to now).
// Fetched every 6 h for 3 days, every 12 h to day 7, then daily: GFS itself is only 3-hourly past day 5 and
// wind that far out is rough. A long trip went from up to 64 requests (each a GFS pull on a cold server) to
// under 30. The 6 h steps in between are blended from the fetched hours on either side.
const STEP_H = 6;
const forecastHours = (hours: number) => {
  const at: number[] = [];
  for (let h = 0; h <= 378; h += h < 72 ? 6 : h < 168 ? 12 : 24) {
    at.push(h);
    if (h >= hours + STEP_H) break;
  }
  return at;
};
const blend = (a: Field, b: Field, f: number): Field =>
  a.u.length !== b.u.length ? a : {
    ...a,
    u: a.u.map((x, i) => x + (b.u[i] - x) * f),
    v: a.v.map((x, i) => x + (b.v[i] - x) * f),
    ok: a.ok.map((x, i) => x & b.ok[i]),
  };
export async function loadWindForecast(hours: number, box: number[]) {
  const t0 = Math.floor(Date.now() / (STEP_H * 3600_000)) * STEP_H * 3600_000;
  const at = forecastHours(hours);
  const q = box.map((v) => v.toFixed(1)).join(",");
  const got = await Promise.all(at.map((h) =>
    fetch(`/api/wind?at=${new Date(t0 + h * 3600_000).toISOString()}&box=${q}`)
      .then((r) => decode(r, "wind forecast"))
      .catch(() => null)));
  const fields: Field[] = [];
  for (let k = 0; k < got.length && got[k]; k++) { // keep the unbroken run from departure
    const a = got[k]!, b = got[k + 1];
    fields.push(a);
    if (b) for (let h = at[k] + STEP_H; h < at[k + 1]; h += STEP_H) fields.push(blend(a, b, (h - at[k]) / (at[k + 1] - at[k])));
  }
  return fields.length ? { start: (t0 - Date.now()) / 1000, step: STEP_H * 3600, fields } : null;
}
