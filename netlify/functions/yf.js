// WizView 실시간 프록시 — Yahoo Finance(차트·스파크)·CBOE(옵션)만 허용. 브라우저 CORS 우회용.
// GET /.netlify/functions/yf?kind=chart&symbol=TSLA&range=5d&interval=1d
// GET /.netlify/functions/yf?kind=spark&symbols=TSLA,GEV
// GET /.netlify/functions/yf?kind=options&symbol=TSLA
// GET /.netlify/functions/yf?ping=1
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const SYM = /^[A-Z0-9^=.\-]{1,12}$/;
const RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y", "60d"]);
const INTERVALS = new Set(["1m", "5m", "15m", "1d"]);

export default async (req) => {
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k) || "";
  const headers = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
  if (q("ping")) return new Response(JSON.stringify({ ok: true, t: Date.now() }), { headers });
  let target, ttl = 60;
  const kind = q("kind");
  if (kind === "chart") {
    const s = q("symbol").toUpperCase(), r = q("range") || "5d", i = q("interval") || "1d";
    if (!SYM.test(s) || !RANGES.has(r) || !INTERVALS.has(i)) return bad(headers);
    target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=${r}&interval=${i}&includePrePost=false`;
  } else if (kind === "spark") {
    const syms = q("symbols").toUpperCase().split(",").filter(Boolean);
    if (!syms.length || syms.length > 20 || !syms.every((s) => SYM.test(s))) return bad(headers);
    target = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(syms.join(","))}&range=1d&interval=1d`;
  } else if (kind === "options") {
    const s = q("symbol").toUpperCase(); if (!/^[A-Z]{1,6}$/.test(s)) return bad(headers);
    target = `https://cdn.cboe.com/api/global/delayed_quotes/options/${s}.json`; ttl = 300;
  } else return bad(headers);
  try {
    const r = await fetch(target, { headers: { "User-Agent": UA, Accept: "application/json" } });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { ...headers, "cache-control": `public, max-age=${ttl}, s-maxage=${ttl}` } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers });
  }
};
function bad(headers) { return new Response(JSON.stringify({ error: "bad request" }), { status: 400, headers }); }
export const config = { path: "/.netlify/functions/yf" };
