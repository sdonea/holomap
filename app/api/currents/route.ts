// Global surface ocean currents from NOAA CoastWatch's blended near-real-time product (satellite-altimetry
// geostrophic currents, 0.25°, updated daily; free, no key, no rate limit we can reach). One ~17 MB pull per
// 6 h serves every visitor and every pan/zoom, the same pattern as app/api/wind.
// ERDDAP's .dods reply is text header, "\nData:\n", then per variable: [u32 n][u32 n][n big-endian float64]
// followed by its maps (time f64, latitude f32 south->north, longitude f32 -179.875..179.875).
// We return Int16 cm/s: [u rows south->north x COLS] then v; -32768 = land/no data.
const VARS = ["u_current", "v_current"].map((v) => `${v}[last][(-89.875):1:(89.875)][(-179.875):1:(179.875)]`);
const SRC = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily.dods?${encodeURIComponent(VARS.join(","))}`;
const SRC_COLS = 1440, ROWS = 720, COLS = SRC_COLS + 2; // one wrapped column each side so streaks cross the dateline
const GRID = `-180.125,-89.875,0.25,${COLS},${ROWS}`; // lon0,lat0,step,cols,rows
const NONE = -32768;

type Grid = { body: ArrayBuffer; valid: string };
let cached: { key: string; grid: Grid } | undefined, job: { key: string; p: Promise<Grid> } | undefined;

async function build(): Promise<Grid> {
  const res = await fetch(SRC, { cache: "no-store" });
  if (!res.ok) throw new Error(`CoastWatch ${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  let o = new TextDecoder("latin1").decode(new Uint8Array(buf, 0, 4096)).indexOf("\nData:\n") + 7;
  if (o < 7) throw new Error("CoastWatch reply has no data section");
  const out = new Int16Array(2 * ROWS * COLS);
  let time = 0;
  for (let k = 0; k < 2; k++) {
    const n = dv.getUint32(o);
    if (n !== ROWS * SRC_COLS) throw new Error(`CoastWatch grid is ${n} cells, expected ${ROWS * SRC_COLS}`);
    const a = o + 8;
    for (let j = 0; j < ROWS; j++)
      for (let i = 0; i < COLS; i++) {
        const x = dv.getFloat64(a + (j * SRC_COLS + ((i + SRC_COLS - 1) % SRC_COLS)) * 8);
        out[k * ROWS * COLS + j * COLS + i] = Math.abs(x) < 20 ? Math.round(x * 100) : NONE; // land fill is -214748
      }
    o = a + n * 8;
    time = dv.getFloat64(o + 8);
    o += 16;
    if (dv.getFloat32(o + 8) > 0) throw new Error("CoastWatch latitudes not south->north");
    o += 8 + ROWS * 4 + 8 + SRC_COLS * 4;
  }
  // u and v coastlines differ by a cell here and there, so need both. Also drop > 3 m/s: altimetry breaks down
  // in shallow straits near the equator (New Guinea, Indonesia) and invents 5 m/s jets; no real one is that fast.
  for (let k = 0, m = ROWS * COLS; k < m; k++)
    if (out[k] === NONE || out[k + m] === NONE || Math.hypot(out[k], out[k + m]) > 300) out[k] = out[k + m] = NONE;
  // Mostly land/no-data runs of one value: gzip takes the ~4 MB grid well under Vercel's 4.5 MB response cap.
  const body = await new Response(new Blob([out]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return { body, valid: new Date(time * 1000).toISOString() };
}

export async function GET() {
  const key = String(Math.floor(Date.now() / 21600_000)); // daily product; recheck every 6 h
  try {
    if (cached?.key !== key) {
      if (job?.key !== key) job = { key, p: build() }; // concurrent requests share one download
      cached = { key, grid: await job.p };
    }
  } catch (e) {
    console.error(e);
    job = undefined; // let the next request retry
    if (!cached) return Response.json({ error: "current data unavailable" }, { status: 502 });
    // fall through with the previous grid rather than nothing
  }
  return new Response(cached.grid.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-encoding": "gzip",
      "x-grid": GRID,
      "x-valid-time": cached.grid.valid,
      "cache-control": "public, max-age=1800, s-maxage=3600, stale-while-revalidate=21600",
    },
  });
}
