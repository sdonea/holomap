// What a voyage costs at each speed. The ship runs at constant power for the chosen speed, so fuel burn per
// day follows the cube of speed (the standard propeller law) and total fuel = burn/day × days at sea.
// Time has a price too (charter hire, or the owner's daily running cost), which is why ships don't just crawl:
// the cheapest speed balances fuel $ falling as speed³ × time against time $ rising with every day.

export type Market = {
  fuelPrice: number; // $ per tonne (VLSFO, the low-sulphur fuel most ships burn since 2020)
  charter: number; // $ per day of ship time
  burn12: number; // tonnes/day at 12 kn: ~25 for a mid-size (~40,000 t) cargo ship
  co2PerT: number; // tonnes CO₂ per tonne of fuel burned (IMO factor for VLSFO)
};
export const DEFAULT_MARKET: Market = { fuelPrice: 600, charter: 20000, burn12: 25, co2PerT: 3.15 };

export type Cost = { kn: number; hours: number; fuelT: number; co2T: number; fuelUsd: number; timeUsd: number; totalUsd: number };

// hours = sailing time at that speed; delayHours = canal locks/queues (ship time, but engines near idle).
export function costAt(kn: number, hours: number, delayHours: number, m: Market): Cost {
  const fuelT = (m.burn12 * (kn / 12) ** 3 * hours) / 24;
  const fuelUsd = fuelT * m.fuelPrice, timeUsd = ((hours + delayHours) / 24) * m.charter;
  return { kn, hours, fuelT, co2T: fuelT * m.co2PerT, fuelUsd, timeUsd, totalUsd: fuelUsd + timeUsd };
}

// Every speed option's cost and the cheapest one. Speeds the ship can't make (Infinity hours) are dropped.
export function costCurve(bySpeed: { kn: number; hours: number }[], delayHours: number, m: Market) {
  const rows = bySpeed.filter((s) => Number.isFinite(s.hours)).map((s) => costAt(s.kn, s.hours, delayHours, m));
  const best = rows.reduce<Cost | null>((b, r) => (!b || r.totalUsd < b.totalUsd ? r : b), null);
  return { rows, best };
}
