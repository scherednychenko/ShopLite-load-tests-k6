// ShopLite browser test — BUSINESS-OPERATION timing (Grafana k6, browser module)
//
// The business doesn't care about LCP — they care about "how long did it take a
// user to log in / search for an account". So instead of raw Web Vitals, this
// script times named business operations and reports them three ways, the same
// pattern a real team uses:
//
//   1. a custom Trend metric per operation  -> the *timing* (e.g. op_login_ms p95),
//      what the business dashboard shows;
//   2. a check()                            -> pass/fail (did the op succeed / meet
//      its budget) — shows up in the k6/Grafana Cloud "Checks" view, next to Thresholds;
//   3. a threshold on the Trend + on checks  -> the SLO gate (fails CI on regression).
//
// Web Vitals (see browser-cwv.js) stay underneath as *diagnostics*: if an op's p95
// creeps up, you drill into LCP/INP/network to find out why.
//
// The two operations below run against public demo sites as stand-ins — swap the
// URLs/selectors for the real app (its Login screen, its Account Search), keep the
// shape. Runs locally and in k6 Cloud:
//
//   k6 run k6/business-ops.js
//   k6 cloud run k6/business-ops.js
import { browser } from "k6/browser";
import { check } from "k6";
import { Trend } from "k6/metrics";

// Custom timing metrics (true = render as a duration). These are the business KPIs.
const loginMs = new Trend("op_login_ms", true);
const accountSearchMs = new Trend("op_account_search_ms", true);

export const options = {
  scenarios: {
    ops: {
      executor: "shared-iterations",
      vus: Number(__ENV.VUS || 1),
      iterations: Number(__ENV.ITERATIONS || 5),
      maxDuration: "5m",
      options: { browser: { type: "chromium" } },
    },
  },
  // SLOs in business terms — the run fails if an operation gets too slow or starts failing.
  thresholds: {
    op_login_ms: ["p(95)<3000"], // logging in and the app being stable < 3s
    op_account_search_ms: ["p(95)<3000"], // entering a query and the result opening < 3s
    checks: ["rate>0.99"], // 99%+ of operations succeed
  },
};

// Operation 1 — "Login": time from submitting credentials to the app being stable.
// (Stand-in: the canonical test.k6.io login form → "Welcome, admin!" header.)
async function login(page) {
  await page.goto("https://test.k6.io/my_messages.php", { waitUntil: "load" });
  await page.locator('input[name="login"]').type("admin");
  await page.locator('input[name="password"]').type("123");

  const t0 = Date.now();
  await Promise.all([
    page.waitForNavigation(),
    page.locator('input[type="submit"]').click(),
  ]);
  let welcome = "";
  try {
    welcome = await page.locator("h2").textContent();
  } catch (e) {
    /* header not found — op failed */
  }
  loginMs.add(Date.now() - t0);
  check(welcome, { "Login: app stable (welcome shown)": (t) => (t || "").includes("Welcome") });
}

// Operation 2 — "Account Search": time from issuing a query to the result opening.
// (Stand-in: quickpizza "recommend" → the "Our recommendation:" result appears.)
async function accountSearch(page) {
  await page.goto("https://quickpizza.grafana.com/", { waitUntil: "load" });
  await page.waitForSelector("button"); // app ready (not part of the timed op)

  const t0 = Date.now();
  await page.locator("button").click();
  let opened = true;
  try {
    await page.waitForSelector('//*[contains(text(),"Our recommendation")]', { timeout: 5000 });
  } catch (e) {
    opened = false;
  }
  accountSearchMs.add(Date.now() - t0);
  check(opened, { "Account search: result opened": (ok) => ok === true });
}

export default async function () {
  const page = await browser.newPage();
  try {
    await login(page);
    await accountSearch(page);
  } finally {
    await page.close();
  }
}
