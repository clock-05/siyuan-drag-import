/** M0 · 500 篇连续建文档的退化曲线 */
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:6806";
async function api(path, body) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const j = await res.json();
  return { ...j, ms: performance.now() - t0 };
}

const nb = (await api("/api/notebook/createNotebook", { name: `M0-perf-${Date.now().toString().slice(-5)}` })).data
  .notebook.id;

const N = 500;
const buckets = [];
let errors = 0;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const r = await api("/api/filetree/createDocWithMd", {
    notebook: nb,
    path: `/批量/第 ${i + 1} 篇`,
    markdown: `# 第 ${i + 1} 篇\n\n正文。`,
  });
  if (r.code !== 0) errors++;
  if ((i + 1) % 100 === 0) {
    buckets.push({ done: i + 1, avgMs: +((performance.now() - t0) / (i + 1)).toFixed(1) });
  }
}
const total = performance.now() - t0;

// 顺带测：500 篇后 getIDsByHPath 与 listDocsByPath 的耗时
const q1 = await api("/api/filetree/getIDsByHPath", { notebook: nb, path: "/批量/第 250 篇" });
const q2 = await api("/api/query/sql", {
  stmt: `SELECT count(*) AS c FROM blocks WHERE type='d' AND box='${nb}'`,
});

const report = {
  total: N,
  errors,
  totalMs: Math.round(total),
  avgMs: +(total / N).toFixed(1),
  perSec: +(N / (total / 1000)).toFixed(1),
  buckets,
  getIDsByHPathMs: +q1.ms.toFixed(1),
  getIDsByHPathRows: q1.data?.length,
  sqlDocCount: q2.data?.[0]?.c,
  sqlMs: +q2.ms.toFixed(1),
};
console.log(JSON.stringify(report, null, 2));
writeFileSync(new URL("./perf-500.json", import.meta.url), JSON.stringify(report, null, 2));

const del = await api("/api/notebook/removeNotebook", { notebook: nb });
console.log("cleanup:", JSON.stringify(del));
