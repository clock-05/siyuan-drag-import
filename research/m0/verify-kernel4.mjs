/**
 * M0 内核验证 · 第四轮（修正版）
 * 修正：.sy 是异步落盘的，刚建的文档读出来可能只有半截 JSON —— 解析必须容错。
 * 新增：listDocsByPath 作为「同级重名」的可信来源。
 */

import { writeFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:6806";
const WS = "D:/Knowledge2/思源笔记工作空间/知识类";
const HERE = dirname(fileURLToPath(import.meta.url));
const out = [];
const NB_NAME = `M0-verify4b-${Date.now().toString().slice(-5)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return await res.json();
}

function readMeta(p) {
  const raw = readFileSync(p, "utf8");
  const nl = raw.indexOf("\n");
  const head = raw.slice(0, nl > 0 ? nl : raw.length);
  try {
    const j = JSON.parse(head);
    return j.Properties || {};
  } catch {
    const id = /"ID":"([^"]+)"/.exec(head)?.[1];
    const tm = /"title":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1];
    let title = tm;
    try {
      title = tm === undefined ? undefined : JSON.parse('"' + tm + '"');
    } catch {}
    return { id, title, parseErr: true };
  }
}

function treeOf(nbId) {
  const root = join(WS, "data", nbId);
  const rows = [];
  (function walk(dir) {
    let items = [];
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const p = join(dir, it.name);
      if (it.isDirectory()) walk(p);
      else if (it.name.endsWith(".sy") && it.name !== ".sy") {
        const m = readMeta(p);
        const relDir = relative(root, dir);
        rows.push({
          id: m.id,
          title: m.title,
          depth: relDir.split(sep).filter(Boolean).length,
          dir: relDir,
          partial: !!m.parseErr,
        });
      }
    }
  })(root);
  return rows;
}

function render(rows) {
  return rows.map((r) => `${"  ".repeat(r.depth)}· ${r.title}`).join("\n");
}

async function step(name, fn) {
  try {
    const r = await fn();
    out.push({ name, ok: true, ...r });
    console.log(`\n▶ ${name}\n${r.print ?? ""}\n${JSON.stringify(r).slice(0, 1200)}`);
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

  // 1. 命名边界
  await step("1 命名边界：内核如何改写标题", async () => {
    const cases = [
      "/边界/  带空格的名字  ",
      "/边界/带:冒号",
      "/边界/带\\反斜杠",
      "/边界/带?问号*星号",
      "/边界/带<尖>括|号",
      "/边界/以点结尾.",
      "/边界/" + "长".repeat(120),
      "/边界/" + "超".repeat(300),
      "/边界/🎉 庆祝",
      "/边界/   ",
      "/边界//双斜杠",
      "/边界/.hidden",
      "/边界/../逃逸",
      "/边界/100%#话题",
      '/边界/带"引号\'单引号',
    ];
    const codes = [];
    for (const p of cases) {
      const r = await api("/api/filetree/createDocWithMd", { notebook: nbId, path: p, markdown: "x" });
      codes.push({ p: p.slice(0, 40), code: r.code, msg: r.msg });
    }
    await sleep(1200);
    const rows = treeOf(nbId);
    return {
      codes,
      print: render(rows),
      titles: rows.map((r) => ({ t: r.title, len: (r.title || "").length, partial: r.partial })),
    };
  });

  // 2. 同名 hpath 在树上的真实表现
  await step("2 同名 hpath 在树上的表现", async () => {
    const a = await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/重复/同名", markdown: "一" });
    const b = await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/重复/同名", markdown: "二" });
    const ids = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/重复/同名" });
    await sleep(600);
    const rows = treeOf(nbId).filter((r) => r.dir.includes("重复"));
    return {
      created: [a.data, b.data],
      idsByHPath: ids?.data,
      print: render(rows),
    };
  });

  // 3. listDocsByPath：同级子文档的权威来源
  await step("3 listDocsByPath 列同级子文档", async () => {
    const p = await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/列目录/父", markdown: "x" });
    await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/列目录/父/子一", markdown: "x" });
    await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/列目录/父/子二", markdown: "x" });
    await sleep(500);
    const r1 = await api("/api/filetree/listDocsByPath", { notebook: nbId, path: "/列目录/父" });
    const r2 = await api("/api/filetree/listDocsByPath", { notebook: nbId, path: "/列目录" });
    const r3 = await api("/api/filetree/listDocsByPath", { notebook: nbId, path: "/" });
    const strip = (x) =>
      (x?.data?.files || []).map((f) => ({ name: f.name, path: f.path, subFileCount: f.subFileCount }));
    return {
      parent: strip(r1),
      levelUp: strip(r2),
      root: (r3?.data?.files || []).slice(0, 6).map((f) => f.name),
      rawKeys: Object.keys(r1?.data || {}),
    };
  });

  // 4. 删除验证
  await step("4 removeDocByID 删除验证", async () => {
    const c = await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/删/待删", markdown: "x" });
    const del = await api("/api/filetree/removeDocByID", { id: c.data });
    await sleep(700);
    const left = treeOf(nbId).filter((r) => (r.title || "").includes("待删"));
    return { created: c.data, del, leftCount: left.length, print: render(left) || "(已清除)" };
  });

  // 5. 空 path / 无前导斜杠
  await step("5 path 异常形态", async () => {
    const a = await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "没有斜杠", markdown: "x" });
    const b = await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "", markdown: "x" });
    await sleep(500);
    const rows = treeOf(nbId).filter((r) => [a.data, b.data].includes(r.id));
    return { ids: { noSlash: a.data, empty: b.data }, rows: rows.map((r) => ({ t: r.title, dir: r.dir })) };
  });

  // 6. 删除父文档是否连带子文档（撤销策略的依据）
  await step("6 删除父文档的连带行为", async () => {
    await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/连带/父/子A", markdown: "x" });
    await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/连带/父/子B", markdown: "x" });
    await sleep(500);
    const before = treeOf(nbId).filter((r) => r.dir.includes("连带"));
    const parent = before.find((r) => r.title === "父");
    const del = await api("/api/filetree/removeDocByID", { id: parent.id });
    await sleep(800);
    const after = treeOf(nbId).filter((r) => r.dir.includes("连带"));
    return {
      before: before.map((r) => r.title),
      parentId: parent.id,
      del,
      after: after.map((r) => r.title),
      print: "before=" + before.map((r) => r.title).join(",") + "  after=" + after.map((r) => r.title).join(","),
    };
  });

  // 7. 不同父级同名
  await step("7 不同父级同名互不影响", async () => {
    await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/父1/笔记", markdown: "x" });
    await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/父2/笔记", markdown: "x" });
    await sleep(500);
    const rows = treeOf(nbId).filter((r) => r.title === "笔记");
    return { count: rows.length, print: render(rows) };
  });

  // 8. 新建的文档 listDocsByPath 是否立刻可见（同一批次内判重的依据）
  await step("8 listDocsByPath 的实时性", async () => {
    const parent = "/实时";
    await api("/api/filetree/createDocWithMd", { notebook: nbId, path: parent + "/甲", markdown: "x" });
    const t0 = Date.now();
    const r = await api("/api/filetree/listDocsByPath", { notebook: nbId, path: parent });
    return {
      ms: Date.now() - t0,
      names: (r?.data?.files || []).map((f) => f.name),
      note: "若立刻包含「甲」，说明可以边建边查，无需依赖内存计数",
    };
  });
} finally {
  if (nbId) {
    const del = await api("/api/notebook/removeNotebook", { notebook: nbId }).catch((e) => ({ code: -99, msg: String(e) }));
    out.push({ name: "Z 清理", ok: del.code === 0, del });
  }
  mkdirSync(HERE, { recursive: true });
  writeFileSync(join(HERE, "kernel-report-4.json"), JSON.stringify(out, null, 2), "utf8");
}
