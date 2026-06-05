// ShopLite load test — Grafana k6
// Mirrors the JMeter scenario: Browse catalog -> Add to cart (N items) -> Checkout.
// Endpoints are placeholders served by the local mock backend.
import http from "k6/http";
import { check, group, sleep } from "k6";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const CART_SIZE = Number(__ENV.CART_SIZE || 10);
const VUS = Number(__ENV.VUS || 10);
const PRODUCTS = ["1001", "1002", "1003"];
const JSON_HEADERS = { headers: { "Content-Type": "application/json" } };

export const options = {
  // SLOs as thresholds — the run fails if any is breached.
  thresholds: {
    http_req_failed: ["rate<0.01"],     // < 1% errors
    http_req_duration: ["p(95)<500"],   // p95 latency budget
    checks: ["rate>0.99"],              // functional assertions
  },
  stages: [
    { duration: "5s", target: VUS },
    { duration: __ENV.DURATION || "50s", target: VUS },
    { duration: "5s", target: 0 },
  ],
};

function think() {
  sleep(Math.random() * 0.9 + 0.3); // 0.3–1.2s
}

export default function () {
  group("Browse Catalog", () => {
    const res = http.get(`${BASE}/api/catalog?page=1&size=20`);
    check(res, { "catalog status 200": (r) => r.status === 200 });
    think();
  });

  let cartId = null;
  group("Add To Cart", () => {
    for (let i = 0; i < CART_SIZE; i++) {
      const productId = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
      const res = http.post(`${BASE}/api/cart/items`, JSON.stringify({ productId, qty: 1 }), JSON_HEADERS);
      check(res, { "add-to-cart status 200/201": (r) => r.status === 200 || r.status === 201 });
      if (res.status === 200 || res.status === 201) {
        try { cartId = res.json("cartId"); } catch (e) { /* ignore */ }
      }
      think();
    }
  });

  group("Checkout", () => {
    const body = {
      cartId,
      guest: {
        email: `qa.perf+${__VU}_${__ITER}@example.com`,
        firstName: "Perf", lastName: "Guest", phone: "+10000000000",
      },
      shippingAddress: { country: "HR", city: "Zagreb", addressLine1: "Perf Street 1", zip: "10000" },
    };
    const res = http.post(`${BASE}/api/orders`, JSON.stringify(body), JSON_HEADERS);
    check(res, { "checkout status 200/201": (r) => r.status === 200 || r.status === 201 });
    think();
  });
}

// Write an HTML report + JSON summary next to the run (mounted to ./results).
export function handleSummary(data) {
  return {
    "report.html": htmlReport(data),
    "summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
