/**
 * 精确复查：updateBlock 写回父文档后，子文档是否仍在（按 id 查，不用全库 SQL）。
 *
 * 跑法：node research/restore-spike4.mjs
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

const stamp = Date.now();
let nbId = "";
try {
  nbId = (await api("/api/notebook/createNotebook", { name: `sdi-child2-${stamp}` }))?.data?.notebook?.id;
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
  await sleep(1200);

  const probe = async (label) => {
    const byId = await api("/api/query/sql", { stmt: `select id, hpath from blocks where id = '${child}'` });
    const hpath = await api("/api/filetree/getHPathByID", { id: child });
    const doc = await api("/api/filetree/getDoc", { id: child });
    console.log(`${label}`);
    console.log(`  SQL 查到：${(byId.data ?? []).length === 1}  ${(byId.data ?? [])[0]?.hpath ?? ""}`);
    console.log(`  hPath：${JSON.stringify(hpath.data)}`);
    console.log(`  getDoc：code=${doc.code} 有内容=${Boolean(doc.data?.id)}`);
    return (byId.data ?? []).length === 1;
  };

  const before = await probe("写回前：");
  const kramdown = (await api("/api/block/getBlockKramdown", { id: parent })).data.kramdown;
  const write = await api("/api/block/updateBlock", { id: parent, dataType: "markdown", data: kramdown });
  await sleep(1200);
  const after = await probe("写回后：");

  console.log(`\nupdateBlock code=${write.code}`);
  console.log(`子文档仍在：${before && after}`);
} catch (error) {
  console.error("复查失败：", error);
  process.exitCode = 1;
} finally {
  if (nbId) {
    const removed = await api("/api/notebook/removeNotebook", { notebook: nbId });
    console.log(`\n清理临时笔记本：${removed.code === 0 ? "ok" : JSON.stringify(removed)}`);
  }
}
