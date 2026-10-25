/**
 * M3 探针：「覆盖同名文档」怎么实现才不伤到子文档。
 * 目标：保留文档 id 与它的子文档，只把正文换掉。
 *
 * 候选：/api/block/updateBlock {id, dataType:"markdown", data}
 * 若是文档块不好使，再退回「删了重建」并记录代价。
 */

const BASE = "http://127.0.0.1:6806";
const NB_NAME = `M3-probe-${Date.now().toString().slice(-5)}`;

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  return { ...json, _ms: 0 };
}

let nbId = "";
try {
  nbId = (await api("/api/notebook/createNotebook", { name: NB_NAME }))?.data?.notebook?.id ?? "";
  const mk = async (path, markdown) =>
    (await api("/api/filetree/createDocWithMd", { notebook: nbId, path, markdown })).data;

  const docId = await mk("/甲", "旧内容第一段\n\n## 旧小标题\n\n旧内容第三段");
  const childId = await mk("/甲/子文档", "子文档内容");
  console.log(`文档 ${docId}，子文档 ${childId}`);

  const before = await api("/api/block/getBlockKramdown", { id: docId });
  console.log("\n覆盖前：", JSON.stringify(before?.data?.kramdown));

  // ① 直接对文档块做 markdown 全量替换
  const updated = await api("/api/block/updateBlock", {
    id: docId,
    dataType: "markdown",
    data: "新内容只有一段",
  });
  console.log("\n① updateBlock:", JSON.stringify(updated));

  const after = await api("/api/block/getBlockKramdown", { id: docId });
  console.log("覆盖后 kramdown：", JSON.stringify(after?.data?.kramdown));

  const childAlive = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/甲/子文档" });
  console.log("子文档还在吗：", JSON.stringify(childAlive));

  const sameId = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/甲" });
  console.log("文档 id 是否没变：", JSON.stringify(sameId));

  // ② 覆盖成多段落 + 标题 + 列表，确认块结构正常生成
  const rich = "## 新标题\n\n- 一\n- 二\n\n```js\nconsole.log(1)\n```";
  const updated2 = await api("/api/block/updateBlock", {
    id: docId,
    dataType: "markdown",
    data: rich,
  });
  const after2 = await api("/api/block/getBlockKramdown", { id: docId });
  console.log("\n② 富文本 updateBlock:", updated2.code, "→", JSON.stringify(after2?.data?.kramdown));

  // ③ 空内容覆盖（会被当成删除？）
  const emptyUpdate = await api("/api/block/updateBlock", {
    id: docId,
    dataType: "markdown",
    data: "",
  });
  const after3 = await api("/api/block/getBlockKramdown", { id: docId });
  console.log("\n③ 空内容覆盖:", JSON.stringify(emptyUpdate), "→", JSON.stringify(after3?.data?.kramdown ?? null));
  console.log("   文档还在吗：", JSON.stringify(await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/甲" })));
} finally {
  if (nbId) {
    const removed = await api("/api/notebook/removeNotebook", { notebook: nbId });
    console.log(`\n🧹 删除临时笔记本: ${removed?.code === 0 ? "ok" : JSON.stringify(removed)}`);
  }
}
