/**
 * M0 内核验证 · 第五轮
 * 目标：确认「同级重名预查」的可靠入口，以及删除父文档的连带行为。
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:6806";
const HERE = dirname(fileURLToPath(import.meta.url));
const out = [];
const NB_NAME = `M0-verify5-${Date.now().toString().slice(-5)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function step(name, fn) {
  try {
    const r = await fn();
    out.push({ name, ok: true, ...r });
    console.log(`\n▶ ${name}\n${JSON.stringify(r).slice(0, 1500)}`);
    return r;
  } catch (e) {
    out.push({ name, ok: false, error: String(e?.stack || e) });
    console.log(`\n✗ ${name}\n  ${e?.stack || e}`);
    return null;
  }
}

let nbId = null;
try {
  nbId = (await api("/api/notebook/createNotebook", { name: NB_NAME }))?.data?.notebook?.id;

  const mk = async (path) =>
    (await api("/api/filetree/createDocWithMd", { notebook: nbId, path, markdown: "x" })).data;

  // 1. listDocsByPath 的 path 到底是什么
  await step("1 listDocsByPath 参数形态", async () => {
    const pId = await mk("/L/父");
    await mk("/L/父/子一");
    await mk("/L/父/子二");
    await sleep(600);

    const root = await api("/api/filetree/listDocsByPath", { notebook: nbId, path: "/" });
    const first = (root?.data?.files || [])[0];

    const byHPath = await api("/api/filetree/listDocsByPath", { notebook: nbId, path: "/L/父" });
    const byHPath2 = await api("/api/filetree/listDocsByPath", { notebook: nbId, path: "L/父" });

    // 用 ID 取存储路径，再列子级
    const doc = (root?.data?.files || []).find((f) => f.name === "L");
    const byStorage = doc ? await api("/api/filetree/listDocsByPath", { notebook: nbId, path: doc.path }) : null;
    const childStorage = byStorage?.data?.files?.find((f) => f.name === "父");
    const grandchildren = childStorage
      ? await api("/api/filetree/listDocsByPath", { notebook: nbId, path: childStorage.path })
      : null;

    return {
      rootFileObj: first,
      byHPath_files: byHPath?.data?.files?.length,
      byHPath2_files: byHPath2?.data?.files?.length,
      parentDocObj: doc,
      byStorage_files: (byStorage?.data?.files || []).map((f) => ({ name: f.name, path: f.path, id: f.id, subFileCount: f.subFileCount })),
      grandchildren_files: (grandchildren?.data?.files || []).map((f) => f.name),
      createdParentId: pId,
    };
  });

  // 2. getHPathByID
  await step("2 getHPathByID", async () => {
    const id = await mk("/路径/深层/文档");
    await sleep(300);
    const r = await api("/api/filetree/getHPathByID", { id });
    return { id, resp: r };
  });

  // 3. 删除父文档：子文档去哪了
  await step("3 删除父文档的连带行为", async () => {
    const parentId = await mk("/连带/父");
    const ca = await mk("/连带/父/子A");
    const cb = await mk("/连带/父/子B");
    await sleep(800);
    const before = await api("/api/query/sql", {
      stmt: `SELECT id, hpath FROM blocks WHERE type='d' AND box='${nbId}' AND hpath LIKE '/连带%' ORDER BY hpath`,
    });
    const del = await api("/api/filetree/removeDocByID", { id: parentId });
    await sleep(1200);
    const afterQ = await api("/api/query/sql", {
      stmt: `SELECT id, hpath FROM blocks WHERE type='d' AND box='${nbId}' AND hpath LIKE '/连带%' ORDER BY hpath`,
    });
    const caCheck = await api("/api/filetree/getHPathByID", { id: ca });
    const cbCheck = await api("/api/filetree/getHPathByID", { id: cb });
    return {
      parentId,
      children: [ca, cb],
      before: before?.data,
      del,
      afterSql: afterQ?.data,
      childAAfter: caCheck,
      childBAfter: cbCheck,
    };
  });

  // 4. 转义后的标题能否用原文查回
  await step("4 标题转义对 hpath 匹配的影响", async () => {
    const id = await mk("/转义/带<尖>括");
    await sleep(600);
    const raw = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/转义/带<尖>括" });
    const escaped = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/转义/带&lt;尖&gt;括" });
    const byId = await api("/api/filetree/getHPathByID", { id });
    return { raw: raw?.data, escaped: escaped?.data, hPathById: byId?.data };
  });

  // 5. 同一批次内，刚建的父文档能否立刻被 getIDsByHPath 查到
  await step("5 新建父文档的可查性（同批次内）", async () => {
    await mk("/即时/刚建的父");
    const t0 = performance.now();
    const r = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/即时/刚建的父" });
    return { ms: +(performance.now() - t0).toFixed(1), ids: r?.data };
  });
} finally {
  if (nbId) {
    const del = await api("/api/notebook/removeNotebook", { notebook: nbId }).catch((e) => ({ code: -99, msg: String(e) }));
    out.push({ name: "Z 清理", ok: del.code === 0, del });
  }
  mkdirSync(HERE, { recursive: true });
  writeFileSync(join(HERE, "kernel-report-5.json"), JSON.stringify(out, null, 2), "utf8");
}
