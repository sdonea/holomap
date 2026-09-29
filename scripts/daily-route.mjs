// Daily README update (run by .github/workflows/daily-route.yml, or by hand against a running site):
// opens the map as a first-time visitor, lets the demo pick today's biggest-saving Gulf Stream trip,
// saves a screenshot, rewrites the block between the daily-route markers in README.md and appends a
// line to docs/daily-routes.csv. Exits non-zero if the demo never finishes, so a bad day commits nothing.
//
//   BASE_URL=http://localhost:3000 IMAGE=/tmp/today.jpg node scripts/daily-route.mjs
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const IMAGE = process.env.IMAGE ?? "today.jpg";
const IMAGE_URL = process.env.IMAGE_URL ?? "https://raw.githubusercontent.com/sdonea/holomap/daily/today.jpg";
const today = new Date().toISOString().slice(0, 10);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (let i = 0; ; i++) { // the server may still be starting
  try { await page.goto(BASE); break; } catch (e) { if (i > 30) throw e; await page.waitForTimeout(2000); }
}
await page.getByText("biggest fuel saving").waitFor({ timeout: 180_000 });
await page.getByText(/FORECAST WIND · TODAY'S CURRENTS|WIND: NOW ONLY/).waitFor({ timeout: 180_000 });
await page.waitForTimeout(2000); // camera fly-to and label settle
await page.screenshot({ path: IMAGE, type: "jpeg", quality: 82 });

const text = await page.evaluate(() => document.body.innerText);
await browser.close();
const trip = text.match(/^(.+?): the biggest fuel saving/m)?.[1];
const saving = text.match(/−([\d.]+)% FUEL/)?.[1];
const leg = text.match(/([\d,.]+ NM · (?:\d+ D )?[\d.]+ H)/)?.[1];
if (!trip || !saving || !leg) throw new Error(`couldn't read the demo result:\n${text.slice(0, 2000)}`);

const block = `<!-- daily-route:start -->
### Today's best Gulf Stream trip · ${today}

**${trip}**: ${saving}% less fuel than sailing the straight line (${leg} at 12 kn).

![Today's fuel-optimal route through the Gulf Stream](${IMAGE_URL}?d=${today})

<sub>Updated every day by a GitHub Action: it opens the map like a first-time visitor, the planner compares 58
trips between nine points off the US East Coast on that day's currents, and the biggest saving is shown here.
Every day's pick is logged in <a href="docs/daily-routes.csv">docs/daily-routes.csv</a>.</sub>
<!-- daily-route:end -->`;
const readme = await readFile("README.md", "utf8");
const start = readme.indexOf("<!-- daily-route:start -->"), end = readme.indexOf("<!-- daily-route:end -->");
if (start < 0 || end < 0) throw new Error("README.md has no daily-route markers");
await writeFile("README.md", readme.slice(0, start) + block + readme.slice(end + "<!-- daily-route:end -->".length));
await appendFile("docs/daily-routes.csv", `${today},${trip},${saving},"${leg}"\n`);
console.log(`${today}: ${trip}, −${saving}% fuel, ${leg}`);
