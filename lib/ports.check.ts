// Run: node lib/ports.check.ts   — fails loudly if AIS destination matching or the cost model breaks.
import assert from "node:assert/strict";
import { matchDestination, parseAisEta, PORTS } from "./ports.ts";
import { costAt, costCurve, DEFAULT_MARKET } from "./economics.ts";

// Real destination strings seen on the live AIS feed -> port code (null = no confident match).
const cases: [string, string | null][] = [
  ["NL AMS", "NLAMS"], ["NLTNZ", "NLTNZ"], ["US ORF", "USORF"], ["NORFOLK,VA", "USORF"], ["HALIFAX-------------", "CAHAL"],
  ["CORPUS CHRISTI TX.", "USCRP"], ["NEW YORK CITY", "USNYC"], ["NJ <> NYC FERRY SVC", "USNYC"], ["STATEN_ISLAND", "USNYC"],
  ["BALBOA>SGSIN", "SGSIN"], ["CNSHA => NLRTM", "NLRTM"], ["ROTTERDAM", "NLRTM"], ["long beach", "USLGB"], ["LA SPEZIA", "ITSPE"],
  ["US^0ZSW>?? ???", null], ["XX XXX>?? ???", null], ["FISHING", null], ["PILOT BOAT", null], ["SEA-EAGLE", null], ["", null], ["RIO GRANDE", null],
];
for (const [raw, code] of cases) assert.equal(matchDestination(raw)?.code ?? null, code, raw);
assert.ok(PORTS.length > 150);
for (const p of PORTS) assert.ok(Math.abs(p.lat) <= 70 && Math.abs(p.lon) <= 180 && /^[A-Z]{5}$/.test(p.code), p.code);

// ETA without a year: the nearest occurrence to "now", including across New Year.
const now = Date.UTC(2026, 8, 28, 12);
assert.equal(parseAisEta("SEP 29 22:00 UTC", now), Date.UTC(2026, 8, 29, 22));
assert.equal(parseAisEta("JAN 03 06:00 UTC", Date.UTC(2026, 11, 30)), Date.UTC(2027, 0, 3, 6));
assert.equal(parseAisEta("DEC 30 06:00 UTC", Date.UTC(2027, 0, 2)), Date.UTC(2026, 11, 30, 6));
assert.equal(parseAisEta(undefined), null);

// Costs: burn follows the cube of speed, CO₂ is a fixed multiple of fuel.
const m = DEFAULT_MARKET, D = 5000; // a 5,000 nm voyage in calm water: hours = D / kn
const a = costAt(12, D / 12, 0, m), b = costAt(24, D / 24, 0, m);
assert.ok(Math.abs(b.fuelT / a.fuelT - 4) < 1e-9, "twice the speed, half the time, 8x the burn rate = 4x the fuel");
assert.ok(Math.abs(a.co2T - a.fuelT * 3.15) < 1e-9);
const speeds = [6, 8, 10, 12, 14, 16, 18, 20, 24].map((kn) => ({ kn, hours: D / kn }));
const bestAt = (fuelPrice: number, charter: number) => costCurve(speeds, 0, { ...m, fuelPrice, charter }).best!.kn;
assert.ok(bestAt(1200, 20000) < bestAt(300, 20000), "dearer fuel -> slow down");
assert.ok(bestAt(600, 60000) > bestAt(600, 5000), "dearer ship time -> speed up");
assert.equal(costCurve([{ kn: 6, hours: Infinity }, { kn: 12, hours: 100 }], 0, m).rows.length, 1, "unreachable speeds dropped");

console.log("ports + economics checks ok");
