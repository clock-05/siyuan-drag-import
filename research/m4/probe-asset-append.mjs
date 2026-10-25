/**
 * M4 探针：图片上传 / 追加 / 按 id 删除。
 * 需要确认的三件事：
 *   1. /api/asset/upload 的字段名、返回结构、同名改名规则
 *   2. /api/block/appendBlock 能不能给已有文档追加 markdown
 *   3. removeDocByID 删父文档时子文档的连带关系（撤销要用）
 *
 * 用法：思源运行时 node research/m4/probe-asset-append.mjs
 * 只用临时笔记本，finally 删除；上传的图片会留在 data/assets（会打印文件名）。
 */

const BASE = "http://127.0.0.1:6806";
const NB_NAME = `M4-probe-${Date.now().toString().slice(-5)}`;

// 1x1 红点 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

async function upload(fileName, bytes) {
  const form = new FormData();
  form.append("assetsDirPath", "/assets/");
  form.append("file[]", new Blob([bytes], { type: "image/png" }), fileName);
  const res = await fetch(BASE + "/api/asset/upload", { method: "POST", body: form });
  return res.json();
}

let nbId = "";
try {
  nbId = (await api("/api/notebook/createNotebook", { name: NB_NAME }))?.data?.notebook?.id ?? "";
  console.log(`临时笔记本: ${nbId}`);

  /* ---------- 1. 上传 ---------- */
  const first = await upload("测试图.png", PNG);
  console.log("\n① 上传：", JSON.stringify(first));

  const second = await upload("测试图.png", PNG);
  console.log("② 同名再传：", JSON.stringify(second));

  const fromMemory = await upload("内存图.png", PNG);
  console.log("③ 内存字节上传：", JSON.stringify(fromMemory));

  /* ---------- 2. 追加 ---------- */
  const docId = (await api("/api/filetree/createDocWithMd", {
    notebook: nbId,
    path: "/追加测试",
    markdown: "第一段",
  })).data;

  const appended = await api("/api/block/appendBlock", {
    parentID: docId,
    dataType: "markdown",
    data: "## 追加的小标题\n\n追加的正文",
  });
  console.log("\n④ appendBlock：", appended?.code, appended?.msg);

  const after = await api("/api/block/getBlockKramdown", { id: docId });
  console.log("   追加后：", JSON.stringify(after?.data?.kramdown));

  /* ---------- 3. 删除 ---------- */
  const parentId = (await api("/api/filetree/createDocWithMd", {
    notebook: nbId,
    path: "/待删父",
    markdown: "父",
  })).data;
  await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/待删父/子", markdown: "子" });
  const removed = await api("/api/filetree/removeDocByID", { id: parentId });
  const childLeft = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/待删父/子" });
  console.log("\n⑤ removeDocByID：", removed?.code, "→ 子文档剩余", JSON.stringify(childLeft?.data));
} finally {
  if (nbId) {
    const removed = await api("/api/notebook/removeNotebook", { notebook: nbId });
    console.log(`\n🧹 删除临时笔记本: ${removed?.code === 0 ? "ok" : JSON.stringify(removed)}`);
  }
}
