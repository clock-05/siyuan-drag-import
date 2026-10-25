/**
 * 快照保真度验证：覆盖/追加要能「还原成导入前的样子」，前提是能拿到一份可无损写回的快照。
 *
 * 对比两条路：
 *   A. /api/block/getBlockKramdown  → /api/block/updateBlock（dataType: markdown）
 *   B. /api/export/exportMdContent  → /api/block/updateBlock（dataType: markdown）
 *
 * 判定标准：写回后再导出一次，和原始导出的正文逐字对比；同时看 DOM 结构（抹掉随机 id）。
 * 全程只用临时笔记本，finally 删掉。
 *
 * 跑法：node research/restore-spike.mjs
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
  "1. 有序 1",
  "2. 有序 2",
  "",
  "> 引用一段话",
  "> 第二行",
  "",
  "```js",
  "const a = 1;",
  "console.log(a);",
  "```",
  "",
  "| 列 A | 列 B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "---",
  "",
  "末尾一段。",
  "",
].join("\n");

/** id 每次都会变，比对结构时必须抹掉 */
function stripIds(html) {
  return html.replace(/data-node-id="[^"]*"/g, 'data-node-id="X"').replace(/ id="[^"]*"/g, ' id="X"');
}

function firstDiff(a, b, label) {
  if (a === b) {
    return null;
  }
  const al = a.split("\n");
  const bl = b.split("\n");
  const lines = [];
  for (let i = 0; i < Math.max(al.length, bl.length); i += 1) {
    if (al[i] !== bl[i]) {
      lines.push(`  行 ${i + 1}`);
      lines.push(`    原始: ${JSON.stringify(al[i])}`);
      lines.push(`    还原: ${JSON.stringify(bl[i])}`);
      if (lines.length > 12) {
        lines.push("    …（后面还有差异）");
        break;
      }
    }
  }
  return `${label} 不一致：\n${lines.join("\n")}`;
}

const stamp = Date.now();
const NB_NAME = `sdi-restore-${stamp}`;
let nbId = "";

try {
  const created = await api("/api/notebook/createNotebook", { name: NB_NAME });
  nbId = created?.data?.notebook?.id;
  if (!nbId) {
    throw new Error(`建笔记本失败：${JSON.stringify(created)}`);
  }
  console.log(`临时笔记本：${NB_NAME} / ${nbId}\n`);

  const original = await api("/api/filetree/createDocWithMd", {
    notebook: nbId,
    path: "/保真度样本",
    markdown: SAMPLE,
  });
  const originId = original.data;
  console.log(`样本文档：${originId}\n`);

  const baselineMd = (await api("/api/export/exportMdContent", { id: originId })).data.content;
  const baselineDom = stripIds((await api("/api/block/getBlockDOM", { id: originId })).data.dom);

  /* ---------- A. getBlockKramdown ---------- */
  const kramdown = (await api("/api/block/getBlockKramdown", { id: originId })).data.kramdown;

  // 另建一篇一模一样的，避免 A 的写回污染 B 的基线
  const copyA = (await api("/api/filetree/createDocWithMd", {
    notebook: nbId,
    path: "/样本A",
    markdown: SAMPLE,
  })).data;

  const writeA = await api("/api/block/updateBlock", { id: copyA, dataType: "markdown", data: kramdown });
  const afterMdA = (await api("/api/export/exportMdContent", { id: copyA })).data.content;
  const afterDomA = stripIds((await api("/api/block/getBlockDOM", { id: copyA })).data.dom);

  /* ---------- B. exportMdContent ---------- */
  const copyB = (await api("/api/filetree/createDocWithMd", {
    notebook: nbId,
    path: "/样本B",
    markdown: SAMPLE,
  })).data;
  const writeB = await api("/api/block/updateBlock", { id: copyB, dataType: "markdown", data: baselineMd });
  const afterMdB = (await api("/api/export/exportMdContent", { id: copyB })).data.content;

  /* ---------- 报告 ---------- */
  console.log("=== 快照长相 ===");
  console.log(`kramdown 长度 ${kramdown.length}，头部：`);
  console.log(kramdown.slice(0, 160).replace(/\n/g, "⏎"));
  console.log(`\n含属性块 {: …}：${/\{:[^}]*\}/.test(kramdown)}`);
  console.log(`\nexportMdContent 头部：`);
  console.log(baselineMd.slice(0, 160).replace(/\n/g, "⏎"));
  console.log(`\n含 frontmatter：${/^---\r?\n/.test(baselineMd)}\n`);

  console.log("=== A. getBlockKramdown → updateBlock ===");
  console.log(`updateBlock code=${writeA.code} msg=${writeA.msg || "-"}`);
  console.log(`正文一致：${afterMdA === baselineMd}`);
  const diffA = firstDiff(baselineMd, afterMdA, "A 正文");
  if (diffA) console.log(diffA);
  console.log(`DOM 一致：${afterDomA === baselineDom}\n`);

  console.log("=== B. exportMdContent → updateBlock ===");
  console.log(`updateBlock code=${writeB.code} msg=${writeB.msg || "-"}`);
  console.log(`正文一致：${afterMdB === baselineMd}`);
  const diffB = firstDiff(baselineMd, afterMdB, "B 正文");
  if (diffB) console.log(diffB);
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
