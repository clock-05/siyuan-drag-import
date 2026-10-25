/**
 * 复查：updateBlock 写回父文档时，子文档到底会不会被删。
 * 上一轮的 false 可能是 SQL 索引滞后（已知 0.3–1s），这轮加等待 + 换查询条件。
 *
 * 跑法：node research/restore-spike3.mjs
 */

const BASE = "http://127.0.0.1:6806";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

/** 直接问内核要子文档，绕开 SQL 索引 */
async function childrenOf(id) {
  const res = await api("/api/filetree/getDoc", { id });
  return res?.code === 0;
}

const stamp = Date.now();
let nbId = "";
try {
  nbId = (await api("/api/notebook/createNotebook", { name: `sdi-child-${stamp}` }))?.data?.notebook?.id;
  const parent = (await api("/api/filetree/createDocWithMd", {
    notebook: nbId,
    path: "/父文档",
    markdown: "父正文第一段\n\n第二段。",
  })).data;

  const child = (await api("/api/filetree/createDocWithMd", {
    notebook: nbId,
    path: "/父文档/子文档",
    markdown: "子正文",
  })).data;

  await sleep(1500);
  const before = await api("/api/query/sql", {
    stmt: `select id, hpath from blocks where type='d' order by hpath`,
  });
  console.log("建完（等 1.5s）文档清单：");
  for (const row of before.data ?? []) console.log(`  ${row.id}  ${row.hpath}`);

  const kramdown = (await api("/api/block/getBlockKramdown", { id: parent })).data.kramdown;
  const write = await api("/api/block/updateBlock", { id: parent, dataType: "markdown", data: kramdown });

  await sleep(1500);
  const after = await api("/api/query/sql", {
    stmt: `select id, hpath from blocks where type='d' order by hpath`,
  });
  console.log("\n写回后（等 1.5s）文档清单：");
  for (const row of after.data ?? []) console.log(`  ${row.id}  ${row.hpath}`);

  const childStillThere = (after.data ?? []).some((row) => row.id === child);
  console.log(`\nupdateBlock code=${write.code}`);
  console.log(`子文档 ${child} 还在：${childStillThere}`);
  console.log(`子文档可直接打开：${await childrenOf(child)}`);
  console.log(`父文档可直接打开：${await childrenOf(parent)}`);
} catch (error) {
  console.error("复查失败：", error);
  process.exitCode = 1;
} finally {
  if (nbId) {
    const removed = await api("/api/notebook/removeNotebook", { notebook: nbId });
    console.log(`\n清理临时笔记本：${removed.code === 0 ? "ok" : JSON.stringify(removed)}`);
  }
}
