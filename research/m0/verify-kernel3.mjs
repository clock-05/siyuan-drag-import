/**
 * M0 内核验证 · 第三轮
 * 修正前两轮的测量误差：.sy 头部字段大小写、SQL 索引延迟、removeDoc 真实签名。
 */

import { writeFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:6806";
const WS = "D:/Knowledge2/思源笔记工作空间/知识类";
const HERE = dirname(fileURLToPath(import.meta.url));
const out = [];
const NB_NAME = `M0-verify3-${Date.now().toString().slice(-6)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  return { ...json, _ms: +(performance.now() - t0).toFixed(1) };
}

/** 只读扫描：返回每个 .sy 的头部原始字段 + 相对路径 */
function scanNotebook(nbId) {
  const root = join(WS, "data", nbId);
  const found = [];
  (function walk(dir, rel) {
    let items = [];
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const p = join(dir, it.name);
      const r = rel + "/" + it.name;
      if (it.isDirectory()) walk(p, r);
      else if (it.name.endsWith(".sy") && it.name !== ".sy") {
        const raw = readFileSync(p, "utf8");
        const nl = raw.indexOf("\n");
        let meta = {};
        try {
          meta = JSON.parse(raw.slice(0, nl));
        } catch {
          meta = { raw: raw.slice(0, 120) };
        }
        found.push({
          path: r,
          depth: r.split("/").length - 2,
          title: meta.Title,
          hPath: meta.HPath,
          id: meta.ID,
          keys: Object.keys(meta).join(","),
        });
      }
    }
  })(root, "");
  return found.sort((a, b) => (a.hPath || "").localeCompare(b.hPath || ""));
}

async function step(name, fn) {
  try {
    const r = await fn();
    out.push({ name, ok: true, ...r });
    console.log(`\n▶ ${name}\n  ${JSON.stringify(r).slice(0, 2000)}`);
    return r;
  } catch (e) {
    out.push({ name, ok: false, error: String(e?.stack || e) });
    console.log(`\n✗ ${name}\n  ${e?.stack || e}`);
    return null;
  }
}

/* 0. SQL 是否对「已存在的旧笔记本」正常工作（只读） */
await step("0 SQL 对既有笔记本可用性（只读）", async () => {
  const nb = await api("/api/notebook/lsNotebooks", {});
  const opened = (nb?.data?.notebooks || []).filter((n) => !n.closed && !n.encrypted).slice(0, 3);
  const res = [];
  for (const n of opened) {
    const q = await api("/api/query/sql", {
      stmt: `SELECT count(*) AS c FROM blocks WHERE type='d' AND box='${n.id}'`,
    });
    res.push({ nb: n.name, code: q.code, count: q?.data?.[0]?.c, ms: q._ms });
  }
  return { openedNotebooks: opened.map((n) => n.name), res };
});

let nbId = null;
try {
  const c = await api("/api/notebook/createNotebook", { name: NB_NAME });
  nbId = c?.data?.notebook?.id;

  // 1. 建一篇，看 .sy 头部真实格式
  await step("1 .sy 头部字段", async () => {
    const r = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/A/B/C",
      markdown: "内容",
    });
    await sleep(300);
    const disk = scanNotebook(nbId);
    const raw = readFileSync(join(WS, "data", nbId, disk[2].path), "utf8");
    return { created: r.data, disk, rawHead: raw.slice(0, 400) };
  });

  // 2. SQL 索引延迟曲线
  await step("2 SQL 索引延迟（同一篇文档）", async () => {
    const marks = [];
    for (const wait of [0, 300, 1000, 3000, 8000]) {
      if (wait) await sleep(wait);
      const q = await api("/api/query/sql", {
        stmt: `SELECT id, hpath FROM blocks WHERE type='d' AND box='${nbId}'`,
      });
      marks.push({ elapsedTarget: wait, rows: q?.data?.length ?? -1, code: q.code, msg: q.msg });
    }
    return { marks };
  });

  // 3. 命名边界：真实 Title
  await step("3 命名边界的真实落地值", async () => {
    const cases = [
      ["首尾空格", "/边界/  带空格的名字  "],
      ["冒号", "/边界/带:冒号"],
      ["反斜杠", "/边界/带\\反斜杠"],
      ["问号星号", "/边界/带?问号*星号"],
      ["尖括号竖线", "/边界/带<尖>括|号"],
      ["点结尾", "/边界/以点结尾."],
      ["超长120", "/边界/" + "长".repeat(120)],
      ["超长300", "/边界/" + "超".repeat(300)],
      ["emoji", "/边界/🎉 庆祝"],
      ["纯空格", "/边界/   "],
      ["连续斜杠", "/边界//双斜杠"],
      ["点开头", "/边界/.hidden"],
      ["上跳", "/边界/../逃逸"],
      ["百分号井号", "/边界/100%#话题"],
    ];
    const codes = [];
    for (const [label, path] of cases) {
      const r = await api("/api/filetree/createDocWithMd", { notebook: nbId, path, markdown: label });
      codes.push({ label, code: r.code, msg: r.msg });
    }
    await sleep(600);
    const disk = scanNotebook(nbId).filter((d) => (d.hPath || "").startsWith("/边界"));
    return {
      codes,
      titles: disk.map((d) => ({ hPath: d.hPath, title: d.title, len: (d.title || "").length })),
      diskTree: disk.map((d) => d.path),
    };
  });

  // 4. removeDoc 的真实签名
  await step("4 删除接口签名探测", async () => {
    const mk = async (p) =>
      (await api("/api/filetree/createDocWithMd", { notebook: nbId, path: p, markdown: "x" })).data;
    const d1 = await mk("/删/一");
    const r1 = await api("/api/filetree/removeDocByID", { id: d1 });
    const d2 = await mk("/删/二");
    const r2 = await api("/api/filetree/removeDoc", { notebook: nbId, path: "/删/二" });
    const d3 = await mk("/删/三");
    const r3 = await api("/api/filetree/removeDoc", { id: d3, notebook: nbId, path: "/删/三" });
    await sleep(500);
    const left = scanNotebook(nbId).filter((d) => (d.hPath || "").startsWith("/删")).map((d) => d.hPath);
    return { removeDocByID: r1, removeDoc_notebook_path: r2, removeDoc_id_notebook_path: r3, left };
  });

  // 5. hpath 不写前导斜杠 / 空 path
  await step("5 path 形态容错", async () => {
    const a = await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "没有斜杠", markdown: "x" });
    const b = await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "", markdown: "x" });
    const c = await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/", markdown: "x" });
    const d = await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/只一层", markdown: "x" });
    await sleep(400);
    return { noLeadingSlash: a, empty: b, rootOnly: c, oneLevel: d };
  });

  // 6. getIDsByHPath 在 100 篇规模下的耗时
  await step("6 getIDsByHPath 耗时（100 篇后）", async () => {
    for (let i = 0; i < 100; i++) {
      await api("/api/filetree/createDocWithMd", {
        notebook: nbId,
        path: `/量/第 ${i} 篇`,
        markdown: "x",
      });
    }
    const hits = [];
    for (const p of ["/量/第 1 篇", "/量/不存在", "/A/B/C"]) {
      const t0 = performance.now();
      const r = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: p });
      hits.push({ p, ms: +(performance.now() - t0).toFixed(1), n: r?.data?.length, code: r.code });
    }
    return { hits };
  });
} finally {
  if (nbId) {
    const del = await api("/api/notebook/removeNotebook", { notebook: nbId }).catch((e) => ({ code: -99, msg: String(e) }));
    out.push({ name: "Z 清理", ok: del.code === 0, del });
    console.log("\n清理：", JSON.stringify(del));
  }
  mkdirSync(HERE, { recursive: true });
  writeFileSync(join(HERE, "kernel-report-3.json"), JSON.stringify(out, null, 2), "utf8");
}
