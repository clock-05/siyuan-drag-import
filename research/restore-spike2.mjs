/**
 * 快照保真度验证（第二轮）：同一篇文档上做 kramdown 往返，逐字比对 + 看块 id 是否保住。
 *
 * 第一轮结论：exportMdContent 带 frontmatter，写回后 YAML 变成正文文本（坏）；
 * getBlockKramdown 的 DOM 结构一致。这一轮把变量收敛掉：
 *   - 只在同一篇文档上测，排除「文档标题不同」的干扰；
 *   - 比对带 id 的 DOM，判断块引用会不会断；
 *   - 顺便测「追加后能否用快照还原」（追加块被整体去掉）。
 *
 * 跑法：node research/restore-spike2.mjs
 */

const BASE = "http://127.0.0.1:6806";

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

const SAMPLE = [
  "## 二级标题",
  "",
  "正文一段，含 **加粗**、*斜体*、`行内代码`、[链接](https://example.com) 和 $a^2+b^2=c^2$ 行内公式。",
  "",
  "- 列表项 1",
  "- 列表项 2",
  "  - 嵌套项（缩进两层）",
  "",
  "> 引用一段话",
  "",
  "```js",
  "const a = 1;",
  "```",
  "",
  "| 列 A | 列 B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "末尾一段。",
  "",
].join("\n");

function idsOf(html) {
  return [...html.matchAll(/data-node-id="([^"]+)"/g)].map((m) => m[1]).join(",");
}

function firstDiff(a, b) {
  const al = a.split("\n");
  const bl = b.split("\n");
  const lines = [];
  for (let i = 0; i < Math.max(al.length, bl.length); i += 1) {
    if (al[i] !== bl[i]) {
      lines.push(`  行 ${i + 1}  原始 ${JSON.stringify(al[i])}  →  还原 ${JSON.stringify(bl[i])}`);
      if (lines.length >= 8) break;
    }
  }
  return lines.join("\n");
}

const stamp = Date.now();
const NB_NAME = `sdi-restore2-${stamp}`;
let nbId = "";

try {
  nbId = (await api("/api/notebook/createNotebook", { name: NB_NAME }))?.data?.notebook?.id;
  if (!nbId) throw new Error("建笔记本失败");

  const id = (await api("/api/filetree/createDocWithMd", {
    notebook: nbId,
    path: "/往返样本",
    markdown: SAMPLE,
  })).data;

  const md0 = (await api("/api/export/exportMdContent", { id })).data.content;
  const html0 = (await api("/api/block/getBlockDOM", { id })).data.dom;
  const ids0 = idsOf(html0);

  const kramdown = (await api("/api/block/getBlockKramdown", { id })).data.kramdown;
  const write = await api("/api/block/updateBlock", { id, dataType: "markdown", data: kramdown });

  const md1 = (await api("/api/export/exportMdContent", { id })).data.content;
  const html1 = (await api("/api/block/getBlockDOM", { id })).data.dom;
  const ids1 = idsOf(html1);

  console.log("=== 同一篇文档：kramdown 往返 ===");
  console.log(`updateBlock code=${write.code}`);
  console.log(`正文逐字一致：${md0 === md1}`);
  if (md0 !== md1) console.log(firstDiff(md0, md1));
  console.log(`DOM 逐字一致（含 id）：${html0 === html1}`);
  console.log(`块 id 全部保留：${ids0 === ids1}`);
  if (ids0 !== ids1) {
    console.log(`  原始 ${ids0.split(",").length} 个 / 还原后 ${ids1.split(",").length} 个`);
    console.log(`  原始: ${ids0.slice(0, 120)}`);
    console.log(`  还原: ${ids1.slice(0, 120)}`);
  }
  console.log(`kramdown 里带属性块：${/\{:[^}]*\}/.test(kramdown)}\n`);

  /* ---------- 追加后还原 ---------- */
  const append = await api("/api/block/appendBlock", {
    parentID: id,
    dataType: "markdown",
    data: "\n\n---\n\n> 以下内容来自 别的.md（导入）\n\n追加进来的正文。\n",
  });
  const mdAppended = (await api("/api/export/exportMdContent", { id })).data.content;
  console.log("=== 追加 → 用快照还原 ===");
  console.log(`appendBlock code=${append.code}，追加后正文变长：${mdAppended.length > md1.length}`);
  console.log(`追加段确实进了正文：${mdAppended.includes("追加进来的正文")}`);

  await api("/api/block/updateBlock", { id, dataType: "markdown", data: kramdown });
  const md2 = (await api("/api/export/exportMdContent", { id })).data.content;
  console.log(`还原后与导入前逐字一致：${md2 === md0}`);
  console.log(`追加段已消失：${!md2.includes("追加进来的正文")}`);
  if (md2 !== md0) console.log(firstDiff(md0, md2));
  console.log("");

  /* ---------- 子文档是否受影响 ---------- */
  await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/往返样本/子文档", markdown: "子" });
  await api("/api/block/updateBlock", { id, dataType: "markdown", data: kramdown });
  const children = await api("/api/query/sql", {
    stmt: `select id from blocks where type='d' and hpath='/往返样本/子文档'`,
  });
  console.log("=== 子文档 ===");
  console.log(`写回后子文档还在：${(children.data ?? []).length === 1}`);
  console.log("");
} catch (error) {
  console.error("验证失败：", error);
  process.exitCode = 1;
} finally {
  if (nbId) {
    const removed = await api("/api/notebook/removeNotebook", { notebook: nbId });
    console.log(`清理临时笔记本：${removed.code === 0 ? "ok" : JSON.stringify(removed)}`);
  }
}
