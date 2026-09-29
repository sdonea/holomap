"use client";

import { useState } from "react";
import { costAt, costCurve, type Market } from "@/lib/economics";

// What the map engine reports about the plotted route (see plotRoute/show in Holomap.tsx).
export type RouteInfo = {
  status: "plotting" | "refining" | "done" | "none";
  knots: number;
  nm: number;
  hours: number; // sailing
  delayHours: number; // canal locks/queues
  legs: number;
  depart: number; // ms
  via: string[];
  directHours: number | null;
  note: string;
  bySpeed: { kn: number; hours: number }[]; // same path timed at every speed option
  ship?: { name: string; port: string; headingDiff: number | null; reportedEta: number | null };
};
export type PlayState = { t: number; playing: boolean; total: number; wind: string; current: string };

// Series colours: fixed order total, fuel, ship time. Validated (dataviz validate_palette.js, dark mode on
// #041019): lightness band, chroma, colour-blind separation (worst ΔE 11.2) and contrast all pass.
const SERIES = [
  { key: "totalUsd", name: "TOTAL", color: "#b8862a" },
  { key: "fuelUsd", name: "FUEL", color: "#2f9ad0" },
  { key: "timeUsd", name: "SHIP TIME", color: "#d95c93" },
] as const;

const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
const num = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("en-US"));
const dur = (h: number) => (h < 48 ? `${h < 10 ? h.toFixed(1) : Math.round(h)} H` : `${Math.floor(h / 24)} D ${Math.round(h % 24)} H`);
const utc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCDate().toString().padStart(2, "0")} ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()} ${d.getUTCHours().toString().padStart(2, "0")}:00Z`;
};

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="opacity-60">{k}</dt>
      <dd className={`text-right ${strong ? "text-[#ffd27a]" : ""}`}>{v}</dd>
    </div>
  );
}

// Cost by speed: one $ axis, three lines, cheapest speed marked, current speed as a rule. Hover or tap a
// speed for its numbers; click to re-plot at that speed.
function CostChart({ rows, best, kn, onSpeed }: { rows: ReturnType<typeof costCurve>["rows"]; best: number; kn: number; onSpeed: (kn: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length < 2) return null;
  const Wc = 268, Hc = 150, L = 38, R = 8, T = 10, B = 22;
  const k0 = rows[0].kn, k1 = rows[rows.length - 1].kn;
  const top = Math.max(...rows.map((r) => r.totalUsd));
  const stepUsd = [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7].find((s) => top / s <= 4) ?? 1e7;
  const ymax = Math.ceil(top / stepUsd) * stepUsd;
  const x = (k: number) => L + ((k - k0) / (k1 - k0)) * (Wc - L - R);
  const y = (v: number) => T + (1 - v / ymax) * (Hc - T - B);
  const h = hover == null ? null : rows[hover];
  return (
    <figure className="mt-2">
      <figcaption className="flex flex-wrap gap-x-3 text-sm opacity-80">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${Wc} ${Hc}`}
          className="w-full touch-none"
          role="img"
          aria-label={`Voyage cost by speed. Cheapest at ${best} knots.`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * Wc;
            let i = 0;
            rows.forEach((row, j) => { if (Math.abs(x(row.kn) - px) < Math.abs(x(rows[i].kn) - px)) i = j; });
            setHover(i);
          }}
          onPointerLeave={() => setHover(null)}
          onClick={() => h && onSpeed(h.kn)}
          style={{ cursor: "pointer" }}
        >
          {Array.from({ length: Math.round(ymax / stepUsd) + 1 }, (_, i) => i * stepUsd).map((v) => (
            <g key={v}>
              <line x1={L} x2={Wc - R} y1={y(v)} y2={y(v)} stroke="#9ff0ff" strokeOpacity={v ? 0.1 : 0.3} />
              <text x={L - 4} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#bfefff" fillOpacity={0.55}>{usd(v)}</text>
            </g>
          ))}
          {rows.map((r) => (
            <text key={r.kn} x={x(r.kn)} y={Hc - 8} textAnchor="middle" fontSize="10" fill="#bfefff" fillOpacity={0.55}>{r.kn}</text>
          ))}
          <text x={Wc - R} y={Hc - 0.5} textAnchor="end" fontSize="9" fill="#bfefff" fillOpacity={0.45}>KN</text>
          <line x1={x(kn)} x2={x(kn)} y1={T} y2={Hc - B} stroke="#ffd27a" strokeOpacity={0.45} strokeDasharray="3 3" />
          {SERIES.map((s) => (
            <polyline key={s.key} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round"
              points={rows.map((r) => `${x(r.kn)},${y(r[s.key])}`).join(" ")} />
          ))}
          {/* cheapest speed: ringed marker on the total line */}
          {rows.filter((r) => r.kn === best).map((r) => (
            <g key="best">
              <circle cx={x(r.kn)} cy={y(r.totalUsd)} r={5} fill={SERIES[0].color} stroke="#041019" strokeWidth={2} />
              <text x={x(r.kn)} y={y(r.totalUsd) - 9} textAnchor="middle" fontSize="10" fill="#ffd27a">CHEAPEST</text>
            </g>
          ))}
          {h && (
            <g>
              <line x1={x(h.kn)} x2={x(h.kn)} y1={T} y2={Hc - B} stroke="#bfefff" strokeOpacity={0.4} />
              {SERIES.map((s) => (
                <circle key={s.key} cx={x(h.kn)} cy={y(h[s.key])} r={4} fill={s.color} stroke="#041019" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute top-0 border border-[#9ff0ff]/30 bg-[#020a10]/95 px-1.5 text-sm leading-4"
            style={x(h.kn) > Wc / 2 ? { right: `${(1 - x(h.kn) / Wc) * 100 + 3}%` } : { left: `${(x(h.kn) / Wc) * 100 + 3}%` }}
          >
            <div className="opacity-70">{h.kn} KN · {dur(h.hours)}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-1">
                <span className="inline-block h-0.5 w-2" style={{ background: s.color }} />
                {s.name} {usd(h[s.key])}
              </div>
            ))}
            <div className="opacity-60">CLICK TO SAIL AT {h.kn} KN</div>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>Voyage cost by speed</caption>
        <thead><tr><th>Knots</th><th>Days</th><th>Fuel $</th><th>Ship time $</th><th>Total $</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kn}><td>{r.kn}</td><td>{(r.hours / 24).toFixed(1)}</td><td>{Math.round(r.fuelUsd)}</td><td>{Math.round(r.timeUsd)}</td><td>{Math.round(r.totalUsd)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export default function RoutePanel(props: {
  open: boolean;
  info: RouteInfo | null;
  play: PlayState;
  market: Market;
  setMarket: (m: Market) => void;
  onClose: () => void;
  onSpeed: (kn: number) => void;
  onPlay: () => void;
  onSeek: (t: number) => void;
}) {
  const { open, info, play, market, setMarket } = props;
  const glow = "text-[#9ff0ff] [text-shadow:0_0_6px_rgba(90,220,255,0.7)]";
  const ok = info && (info.status === "done" || info.status === "refining");
  const here = ok ? costAt(info.knots, info.hours, info.delayHours, market) : null;
  const curve = ok ? costCurve(info.bySpeed, info.delayHours, market) : null;
  const pct = ok && info.directHours ? (1 - info.hours / info.directHours) * 100 : 0;
  const eta = ok ? info.depart + (info.hours + info.delayHours) * 3600_000 : 0;

  return (
    <aside
      data-ui
      aria-label="Route details"
      aria-hidden={!open}
      inert={!open}
      className={`absolute bottom-20 right-4 top-12 w-[300px] overflow-y-auto border border-t-[3px] border-[#ffd27a]/35 border-t-[#ffd27a] bg-[#041019]/90 px-4 pb-3 pt-3 text-lg leading-6 text-[#bfefff] shadow-[0_0_24px_rgba(255,200,110,0.15)] transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none max-[700px]:inset-x-2 max-[700px]:bottom-16 max-[700px]:top-auto max-[700px]:h-[52%] max-[700px]:w-auto ${open ? "translate-x-0 opacity-100" : "translate-x-[calc(100%+24px)] opacity-0 max-[700px]:translate-x-0 max-[700px]:translate-y-[calc(100%+80px)]"}`}
    >
      <button
        type="button"
        aria-label="Close route details"
        onClick={props.onClose}
        className="absolute right-2 top-1 cursor-pointer px-1 text-2xl leading-none opacity-60 outline-none hover:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#9ff0ff]"
      >
        ×
      </button>
      <div className="text-base tracking-wider text-[#ffd27a] [text-shadow:0_0_6px_rgba(255,200,110,0.6)]">FUEL-OPTIMAL ROUTE</div>
      {!ok ? (
        <p className="mt-2 opacity-70">{info?.status === "none" ? "No sea route between those points." : "Plotting…"}</p>
      ) : (
        <>
          <h2 className={`pr-6 text-3xl leading-7 ${glow}`}>{num(info.nm)} NM · {dur(info.hours + info.delayHours)}</h2>
          <div className="text-base opacity-60">ARRIVES {utc(eta)} · {info.knots} KN</div>

          {info.ship && (
            <section className="mt-3 border-t border-[#9ff0ff]/20 pt-1.5">
              <h3 className="text-sm tracking-widest opacity-50">{info.ship.name || "THIS SHIP"} → {info.ship.port}</h3>
              <dl>
                <Row k="HEADING" v={info.ship.headingDiff == null ? "--" : info.ship.headingDiff <= 10 ? "ON THE OPTIMAL HEADING" : `${Math.round(info.ship.headingDiff)}° OFF OPTIMAL`} strong />
                <Row k="SHIP SAYS" v={info.ship.reportedEta ? `ETA ${utc(info.ship.reportedEta)}` : "NO ETA SENT"} />
                <Row k="OPTIMAL" v={`ETA ${utc(eta)}`} />
                {info.ship.reportedEta != null && (
                  <Row k="DIFFERENCE" v={(() => {
                    const d = (info.ship.reportedEta - eta) / 3600_000;
                    return Math.abs(d) < 1 ? "SAME HOUR" : `SHIP ${dur(Math.abs(d))} ${d > 0 ? "LATER" : "EARLIER"}`;
                  })()} />
                )}
              </dl>
              <p className="mt-1 text-sm leading-4 opacity-45">
                Planned at the ship&apos;s own speed from where it is now. AIS doesn&apos;t say how much fuel it burns, so this
                compares heading and arrival only.
              </p>
            </section>
          )}

          <section className="mt-3 border-t border-[#9ff0ff]/20 pt-1.5">
            <h3 className="text-sm tracking-widest opacity-50">VOYAGE</h3>
            <dl>
              <Row k="LEGS" v={String(info.legs)} />
              {info.via.map((v) => <Row key={v} k="VIA" v={v} />)}
              {info.delayHours > 0 && <Row k="LOCKS + QUEUE" v={`+${info.delayHours} H`} />}
              <Row
                k="VS DIRECT"
                v={info.directHours == null ? "DIRECT CROSSES LAND" : pct < 0.5 ? "DIRECT IS BEST" : `−${pct.toFixed(pct < 10 ? 1 : 0)}% FUEL`}
                strong={pct >= 0.5}
              />
            </dl>
          </section>

          {here && curve && (
            <section className="mt-3 border-t border-[#9ff0ff]/20 pt-1.5">
              <h3 className="text-sm tracking-widest opacity-50">COST AT {info.knots} KN</h3>
              <dl>
                <Row k="FUEL" v={`${num(here.fuelT)} T · ${usd(here.fuelUsd)}`} />
                <Row k="CO₂" v={`${num(here.co2T)} T`} />
                <Row k="SHIP TIME" v={usd(here.timeUsd)} />
                <Row k="TOTAL" v={usd(here.totalUsd)} strong />
              </dl>
              <h3 className="mt-2 text-sm tracking-widest opacity-50">COST BY SPEED</h3>
              <CostChart rows={curve.rows} best={curve.best?.kn ?? info.knots} kn={info.knots} onSpeed={props.onSpeed} />
              {curve.best && curve.best.kn !== info.knots && (
                <button
                  type="button"
                  onClick={() => props.onSpeed(curve.best!.kn)}
                  className="mt-1 cursor-pointer border border-[#ffd27a]/40 px-2 text-base text-[#ffd27a] outline-none hover:bg-[#ffd27a]/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#ffd27a]"
                >
                  SAIL AT CHEAPEST: {curve.best.kn} KN (SAVES {usd(here.totalUsd - curve.best.totalUsd)})
                </button>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2 text-base">
                {([["fuelPrice", "FUEL $/T", 50], ["charter", "SHIP $/DAY", 1000]] as const).map(([k, label, step]) => (
                  <label key={k} className="flex flex-col">
                    <span className="text-sm opacity-50">{label}</span>
                    <input
                      type="number"
                      min={0}
                      step={step}
                      value={market[k]}
                      onChange={(e) => setMarket({ ...market, [k]: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-full border border-[#9ff0ff]/30 bg-black/40 px-1 text-[#bfefff] outline-none focus:border-[#9ff0ff]"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-1 text-sm leading-4 opacity-45">
                Fuel burn grows with speed³. Ship time is charter hire or the owner&apos;s daily running cost. The cheapest speed balances them.
              </p>
            </section>
          )}

          <section className="mt-3 border-t border-[#9ff0ff]/20 pt-1.5">
            <h3 className="text-sm tracking-widest opacity-50">PLAYBACK</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={play.playing ? "Pause voyage" : "Play voyage"}
                onClick={props.onPlay}
                className="w-9 cursor-pointer border border-[#ffd27a]/50 text-[#ffd27a] outline-none hover:bg-[#ffd27a]/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#ffd27a]"
              >
                {play.playing ? "❚❚" : "▶"}
              </button>
              <input
                type="range"
                aria-label="Voyage time"
                min={0}
                max={Math.max(1, play.total)}
                step={60}
                value={Math.max(0, play.t)}
                onChange={(e) => props.onSeek(Number(e.target.value))}
                className="h-1 flex-1 cursor-pointer accent-[#ffd27a]"
              />
            </div>
            <div className="mt-1 text-base">
              {play.t < 0 ? (
                <span className="opacity-50">Watch the ship sail it, with the forecast wind (WIND layer) moving past.</span>
              ) : (
                <>
                  <div>DAY {Math.floor(play.t / 86400) + 1} · {utc(info.depart + play.t * 1000).slice(-6)}</div>
                  <div className="opacity-70">{play.wind}</div>
                  <div className="opacity-70">{play.current}</div>
                </>
              )}
            </div>
          </section>
          <p className="mt-3 text-sm leading-4 opacity-45">{info.note}</p>
        </>
      )}
    </aside>
  );
}
