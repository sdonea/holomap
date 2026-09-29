"use client";

import { useEffect, useRef } from "react";

const REPO = "https://github.com/sdonea/holomap";

const KEYS: [string[], string][] = [
  [["drag", "w a s d"], "pan"],
  [["scroll", "↑ ↓", "pinch"], "zoom"],
  [["r"], "route tool (tap start, tap destination)"],
  [["b"], "bearing tool (drag to measure)"],
  [["hold e"], "quick bearing · + click: route"],
  [["space"], "play / pause the voyage"],
  [["t"], "tilt / flatten the table"],
  [["p"], "pause the streaks"],
  [["esc"], "close / clear"],
];

// Grid path vs the pulled-tight route, drawn to explain step 3.
function Diagram() {
  const cells = 12, s = 18;
  const jag = [[0, 8], [1, 7], [2, 7], [3, 6], [4, 6], [5, 5], [6, 4], [7, 4], [8, 3], [9, 3], [10, 2], [11, 1]];
  const land = [[5, 8], [6, 8], [6, 7], [7, 7], [7, 8], [8, 8], [8, 7], [8, 6]];
  const c = (v: number) => v * s + s / 2;
  return (
    <svg viewBox={`0 0 ${cells * s} ${10 * s}`} className="mx-auto my-2 w-full max-w-[320px]" role="img"
      aria-label="A jagged path along grid cells, and the same route pulled tight into two straight legs that avoid a block of land.">
      {Array.from({ length: cells + 1 }, (_, i) => (
        <line key={`v${i}`} x1={i * s} x2={i * s} y1={0} y2={10 * s} stroke="#9ff0ff" strokeOpacity={0.12} />
      ))}
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`h${i}`} x1={0} x2={cells * s} y1={i * s} y2={i * s} stroke="#9ff0ff" strokeOpacity={0.12} />
      ))}
      {land.map(([i, j]) => <rect key={`${i},${j}`} x={i * s} y={j * s} width={s} height={s} fill="#0d3b50" stroke="#9ff0ff" strokeOpacity={0.5} />)}
      <polyline points={jag.map(([i, j]) => `${c(i)},${c(j)}`).join(" ")} fill="none" stroke="#9ff0ff" strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="3 3" />
      {jag.map(([i, j]) => <circle key={`${i},${j}`} cx={c(i)} cy={c(j)} r={2} fill="#9ff0ff" fillOpacity={0.6} />)}
      <polyline points={`${c(0)},${c(8)} ${c(5)},${c(5)} ${c(11)},${c(1)}`} fill="none" stroke="#ffd27a" strokeWidth={2.5} />
      <text x={c(8.6)} y={c(8.2)} fontSize="10" fill="#bfefff" fillOpacity={0.7}>LAND</text>
      <text x={c(0)} y={c(9.4)} fontSize="10" fill="#9ff0ff" fillOpacity={0.8}>GRID PATH</text>
      <text x={c(6.4)} y={c(0.8)} fontSize="10" fill="#ffd27a">FINAL LEGS</text>
    </svg>
  );
}

type Props = { open: boolean; onClose: () => void; think: boolean; onThink: (on: boolean) => void };

export default function AboutPanel({ open, onClose, think, onThink }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", k, true); // capture: Esc closes this before the map sees it
    return () => window.removeEventListener("keydown", k, true);
  }, [open, onClose]);
  if (!open) return null;

  const h3 = "mt-5 border-t border-[#9ff0ff]/20 pt-2 text-sm tracking-widest text-[#9ff0ff]/60";
  const a = "text-[#9ff0ff] underline decoration-[#9ff0ff]/40 underline-offset-2 hover:decoration-[#9ff0ff]";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 font-[family-name:var(--font-pixel)]" onClick={onClose}>
      <article
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-full w-full max-w-[620px] overflow-y-auto border border-t-[3px] border-[#9ff0ff]/35 border-t-[#9ff0ff] bg-[#041019]/95 px-5 pb-5 pt-4 text-lg leading-6 text-[#bfefff] shadow-[0_0_40px_rgba(80,220,255,0.25)]"
      >
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-2 top-1 cursor-pointer px-1 text-3xl leading-none opacity-60 outline-none hover:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#9ff0ff]"
        >
          ×
        </button>
        <h2 id="about-title" className="text-4xl leading-9 text-[#9ff0ff] [text-shadow:0_0_8px_rgba(90,220,255,0.7)]">HOLOMAP</h2>
        <p className="mt-1">
          A live map of the real ocean, drawn like the holotable in Carrier Command 2. Pick two points and it plots the route a
          ship should sail to burn the least fuel, through today&apos;s ocean currents and the wind forecast, around land and
          through the canals.
        </p>

        <h3 className={h3}>TRY THIS</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>ROUTE</b>, then tap a start and a destination. Off Cape Hatteras, watch it ride the Gulf Stream.</li>
          <li>Try New York to San Francisco (through Panama) or the Mediterranean to the Arabian Sea (through Suez).</li>
          <li>Open the route panel: the cost-by-speed chart shows why ships slow down when fuel is expensive. Change the fuel price.</li>
          <li>Turn on <b>WIND</b> and press ▶ to sail the voyage with the forecast weather moving past.</li>
          <li>Click a ship: if its destination is a known port, <b>ROUTE TO</b> compares its heading and ETA with the optimal route.</li>
          <li><b>SHARE</b> copies a link to exactly this view and route.</li>
        </ul>

        <h3 className={h3}>WHAT YOU&apos;RE LOOKING AT</h3>
        <p>
          Drifting streaks are the surface current (or the wind, 10 m up): each moves the way the water goes, brighter means
          faster. Blips are live ships, coloured by type. Land shows real terrain; the sea steps darker as it gets deeper.
        </p>

        <h3 className={h3}>HOW THE ROUTE PLANNER WORKS</h3>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <b>Fuel model.</b> The ship holds constant engine power, so fuel burned is proportional to time at sea and the
            cheapest route is the fastest one. A headwind costs 2% of speed per m/s; a cross-current makes the ship crab, and a
            current along the track adds or subtracts its speed. Burn per day follows speed³.
          </li>
          <li>
            <b>Search.</b> A grid of about 320 cells across is laid over the map around both points. A* search finds the
            fastest path through it in 16 directions, reading the current in each cell and the forecast wind for the hour the
            ship would get there. Distances are measured on a round earth.
            <button
              type="button"
              role="switch"
              aria-checked={think}
              onClick={() => onThink(!think)}
              className="mt-2 flex cursor-pointer items-center gap-2.5 text-left outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#9ff0ff]"
            >
              <span className={`relative h-5 w-9 shrink-0 border transition-colors ${think ? "border-[#ffd27a] bg-[#ffd27a]/20" : "border-[#9ff0ff]/40 bg-transparent"}`}>
                <span className={`absolute top-[3px] h-3 w-3 transition-[left,background-color] ${think ? "left-[19px] bg-[#ffd27a] shadow-[0_0_6px_#ffd27a]" : "left-[3px] bg-[#9ff0ff]/60"}`} />
              </span>
              <span><b>WATCH IT THINK</b> <span className="opacity-70">· before each route, watch the search spread in rings of equal sailing time, trace back the fastest path and pull it tight</span></span>
            </button>
          </li>
          <li>
            <b>Pull tight.</b> The zig-zag grid path is replaced by the fewest great-circle legs that are no slower and never
            touch land. A great circle is the shortest path on a globe, which is why long routes curve toward the pole on
            this flat map.
            <Diagram />
          </li>
          <li>
            <b>Land and water.</b> Coastlines come from Natural Earth; water shallower than 15 m is off limits. The Panama,
            Suez and Kiel canals and narrow straits like Gibraltar are carved back in so a coarse grid can&apos;t close them.
            If land blocks the first search box, it widens and tries again.
          </li>
        </ol>

        <h3 className={h3}>DATA (ALL FREE AND PUBLIC)</h3>
        <ul className="space-y-0.5">
          <li><a className={a} href="https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily.html" target="_blank" rel="noreferrer">NOAA CoastWatch</a>: surface currents from satellite sea height, daily.</li>
          <li><a className={a} href="https://registry.opendata.aws/noaa-gfs-bdp-pds/" target="_blank" rel="noreferrer">NOAA GFS</a>: wind now and forecast to 16 days, every 6 h.</li>
          <li><a className={a} href="https://aisstream.io" target="_blank" rel="noreferrer">aisstream.io</a>: live ship positions (AIS).</li>
          <li><a className={a} href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">AWS Terrain Tiles</a>: land height and sea depth.</li>
          <li><a className={a} href="https://www.naturalearthdata.com" target="_blank" rel="noreferrer">Natural Earth</a>: coastlines, lakes, rivers, depth contours.</li>
        </ul>

        <h3 className={h3}>LIMITS</h3>
        <p>
          Currents are today&apos;s (there&apos;s no free current forecast). No canal tolls, ice, piracy zones or traffic lanes;
          a port connects straight from the nearest deep water. Costs use a typical mid-size cargo ship.
        </p>

        <h3 className={`${h3} max-[700px]:hidden`}>KEYS</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 max-[700px]:hidden">
          {KEYS.map(([ks, what]) => (
            <div key={what} className="contents">
              <dt className="flex gap-1">{ks.map((k) => <kbd key={k} className="rounded-[3px] bg-white/15 px-1 leading-5">{k}</kbd>)}</dt>
              <dd className="opacity-80">{what}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 border-t border-[#9ff0ff]/20 pt-2 text-base opacity-80">
          Built by Sebastian &quot;Seth&quot; Donea · <a className={a} href={REPO} target="_blank" rel="noreferrer">source on GitHub</a>
        </p>
      </article>
    </div>
  );
}
