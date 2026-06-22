// ShopLite browser test — Core Web Vitals (Grafana k6, browser module)
//
// The companion to script.js: that one drives the JSON API at protocol level;
// this one runs a REAL Chromium via `k6/browser`, so k6 collects Core Web Vitals
// (LCP / INP / CLS / FCP / TTFB) from the rendered page and gates them with
// thresholds — the same SLOs-as-code idea, applied to frontend performance.
//
// Runs the same way locally and in the cloud — just point BASE_URL at a public,
// reachable site (the cloud can't see localhost):
//
//   # local (needs a local k6 + browser):
//   k6 run -e BASE_URL=https://quickpizza.grafana.com/ k6/browser-cwv.js
//
//   # Grafana Cloud k6 (results + Web Vitals view in the cloud UI):
//   k6 cloud run -e BASE_URL=https://quickpizza.grafana.com/ k6/browser-cwv.js
//
// Point BASE_URL at any site (your app, a client's staging URL) to score it.
import { browser } from "k6/browser";

const BASE = __ENV.BASE_URL || "https://quickpizza.grafana.com/";

export const options = {
  scenarios: {
    cwv: {
      executor: "shared-iterations",
      vus: Number(__ENV.VUS || 1),
      iterations: Number(__ENV.ITERATIONS || 5),
      maxDuration: "5m",
      options: { browser: { type: "chromium" } },
    },
  },
  // SLOs as code: the run fails if a Core Web Vital busts Google's "good" p75.
  thresholds: {
    browser_web_vital_lcp: ["p(75)<2500"], // Largest Contentful Paint
    browser_web_vital_inp: ["p(75)<200"], // Interaction to Next Paint
    browser_web_vital_cls: ["p(75)<0.1"], // Cumulative Layout Shift
    browser_web_vital_fcp: ["p(75)<1800"], // First Contentful Paint
    browser_web_vital_ttfb: ["p(75)<800"], // Time To First Byte
  },
};

export default async function () {
  const page = await browser.newPage();
  try {
    await page.goto(BASE, { waitUntil: "load" });
    // A real interaction gives INP something to measure (best-effort: the first
    // button on the page). Synthetic clicks may not always register INP, which is
    // exactly why INP is primarily a field/RUM metric.
    try {
      await page.locator("button").click({ timeout: 2000 });
    } catch (e) {
      // no button / not clickable — keep measuring the navigation vitals
    }
    await page.waitForTimeout(1500); // let LCP/CLS settle
  } finally {
    await page.close(); // Web Vitals are finalised on page close
  }
}
