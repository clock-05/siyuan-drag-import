/**
 * M1 · 写代码前的 API 探针
 * 只回答「M1 里我拿不准、又不想靠猜」的几个问题：
 *   1. lsNotebooks 的字段（closed 怎么表示）
 *   2. createDocWithMd 的返回值是不是就是文档 id
 *   3. getHPathByID 的返回形态（根级 / 多级）
 *   4. block/getBlockInfo 能不能从文档 id 反查所属笔记本（box）
 *   5. getIDsByHPath 收到笔记本 id 时是什么表现（备选反查路线）
 * 只用临时笔记本，finally 里删除。
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:6806";
const HERE = dirname(fileURLToPath(import.meta.url));
const NB_NAME = `M1-probe-${Date.now().toString().slice(-5)}`;
const out = [];

async function api(path, body) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const j = await res.json();
  return { ...j, _ms: +(performance.now() - t0).toFixed(1) };
}

async function probe(name, fn) {
  try {
    const data = await fn();
    out.push({ name, ok: true, data });
    console.log(`\n▶ ${name}\n${JSON.stringify(data, null, 2).slice(0, 1400)}`);
  } catch (error) {
    out.push({ name, ok: false, error: String(error?.stack || error) });
    console.log(`\n✗ ${name}\n  ${error?.stack || error}`);
  }
}

let nbId = "";
try {
  const created = await api("/api/notebook/createNotebook", { name: NB_NAME });
  nbId = created?.data?.notebook?.id ?? "";
  console.log(`临时笔记本: ${NB_NAME} → ${nbId}`);

  const mk = async (path, markdown = "探针正文") =>
    (await api("/api/filetree/createDocWithMd", { notebook: nbId, path, markdown })).data;

  await probe("1 lsNotebooks 字段", async () => {
    const r = await api("/api/notebook/lsNotebooks", {});
    const mine = (r?.data?.notebooks ?? []).filter((n) => n.id === nbId);
    return { count: r?.data?.notebooks?.length, mine };
  });

  let rootId = "";
  let childId = "";
  await probe("2 createDocWithMd 返回值", async () => {
    rootId = await mk("/探针根");
    childId = await mk("/探针根/探针子");
    return { rootId, childId, rootType: typeof rootId };
  });

  await probe("3 getHPathByID 形态", async () => {
    const a = await api("/api/filetree/getHPathByID", { id: rootId });
    const b = await api("/api/filetree/getHPathByID", { id: childId });
    return { root: a, child: b };
  });

  await probe("4 getBlockInfo 反查笔记本", async () => {
    const a = await api("/api/block/getBlockInfo", { id: childId });
    const b = await api("/api/block/getBlockInfo", { id: nbId });
    return { byDoc: a?.data, byNotebook: b };
  });

  await probe("5 getIDsByHPath 传笔记本 id", async () => {
    const a = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/探针根" });
    const b = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/探针根/探针子" });
    const c = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/不存在的名字" });
    return { root: a, child: b, missing: c };
  });
} finally {
  if (nbId) {
    const rm = await api("/api/notebook/removeNotebook", { notebook: nbId });
    console.log(`\n🧹 删除临时笔记本: ${JSON.stringify(rm)}`);
  }
  writeFileSync(join(HERE, "api-probe-report.json"), JSON.stringify(out, null, 2), "utf-8");
}
