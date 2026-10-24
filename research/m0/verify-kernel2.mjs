/**
 * M0 内核行为验证 · 第二轮
 * 第一轮发现问题：SQL 索引有延迟（新文档查不到），removeDoc 需要 notebook 参数。
 * 这一轮以「磁盘上的 .sy 文件」为事实基准，绕开索引延迟。
 */

import { writeFileSync, readFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:6806";
const WS = "D:/Knowledge2/思源笔记工作空间/知识类";
const HERE = dirname(fileURLToPath(import.meta.url));
const out = [];

const NB_NAME = `M0-verify2-${Date.now().toString().slice(-6)}`;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 递归扫笔记本目录，读每个 .sy 的头部 JSON（真实标题与 hPath） */
function scanNotebook(nbId) {
  const root = join(WS, "data", nbId);
  const found = [];
  (function walk(dir, depth) {
    let items = [];
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const p = join(dir, it.name);
      if (it.isDirectory()) walk(p, depth + 1);
      else if (it.name.endsWith(".sy") && it.name !== ".sy") {
        const raw = readFileSync(p, "utf8");
        const head = raw.slice(0, raw.indexOf("\n"));
        let meta = {};
        try {
          meta = JSON.parse(head);
        } catch {
          meta = { parseErr: true, head: head.slice(0, 200) };
        }
        found.push({
          file: p.replace(root, "").replace(/\\/g, "/"),
          title: meta.title,
          hPath: meta.hPath,
          id: meta.id,
          fileSize: statSync(p).size,
        });
      }
    }
  })(root, 0);
  return found.sort((a, b) => (a.hPath || "").localeCompare(b.hPath || ""));
}

async function step(name, fn) {
  try {
    const r = await fn();
    out.push({ name, ok: true, ...r });
    console.log(`\n▶ ${name}\n  ${JSON.stringify(r).slice(0, 1600)}`);
    return r;
  } catch (e) {
    out.push({ name, ok: false, error: String(e?.stack || e) });
    console.log(`\n✗ ${name}\n  ${e?.stack || e}`);
    return null;
  }
}

let nbId = null;
try {
  const c = await api("/api/notebook/createNotebook", { name: NB_NAME });
  nbId = c?.data?.notebook?.id;
  console.log("临时笔记本：", nbId, NB_NAME);

  // A. 多级 hpath → 父文档到底建不建
  await step("A 多级 hpath 的磁盘真相", async () => {
    const r = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/L1/L2/L3",
      markdown: "多级路径",
    });
    await sleep(1200);
    const q = await api("/api/query/sql", {
      stmt: `SELECT id, hpath, content FROM blocks WHERE type='d' AND box='${nbId}' ORDER BY hpath`,
    });
    return { resp: r, sqlAfterWait: q?.data, disk: scanNotebook(nbId) };
  });

  // B. 重复 hpath 时 getIDsByHPath 返回什么
  await step("B 重复 hpath 的去重与查询", async () => {
    const a = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/dup/同名",
      markdown: "第一次",
    });
    const b = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/dup/同名",
      markdown: "第二次",
    });
    const ids = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/dup/同名" });
    await sleep(800);
    return { first: a.data, second: b.data, idsByHPath: ids?.data, disk: scanNotebook(nbId).filter((d) => d.hPath?.includes("同名") || d.hPath?.includes("dup")) };
  });

  // C. 命名边界在磁盘上被如何改写
  await step("C 命名边界真实落地名", async () => {
    const cases = [
      ["首尾空格", "/边界/  带空格的名字  "],
      ["冒号", "/边界/带:冒号"],
      ["反斜杠", "/边界/带\\反斜杠"],
      ["问号星号", "/边界/带?问号*星号"],
      ["尖括号竖线", "/边界/带<尖>括|号"],
      ["点结尾", "/边界/以点结尾."],
      ["超长 120", "/边界/" + "长".repeat(120)],
      ["超长 300", "/边界/" + "超".repeat(300)],
      ["emoji", "/边界/🎉 庆祝"],
      ["纯空格", "/边界/   "],
      ["连续斜杠", "/边界//双斜杠"],
      ["点开头", "/边界/.hidden"],
      ["../穿越", "/边界/../逃逸测试"],
    ];
    const res = [];
    for (const [label, path] of cases) {
      const r = await api("/api/filetree/createDocWithMd", {
        notebook: nbId,
        path,
        markdown: label,
      });
      res.push({ label, in: path, code: r.code, msg: r.msg, id: r.data });
    }
    await sleep(1500);
    const disk = scanNotebook(nbId).filter((d) => (d.hPath || "").startsWith("/边界"));
    return {
      resp: res.map((r) => ({ label: r.label, code: r.code, msg: r.msg })),
      disk: disk.map((d) => ({ hPath: d.hPath, title: d.title, titleLen: d.title?.length })),
    };
  });

  // D. removeDoc 正确签名
  await step("D removeDoc 带 notebook 参数", async () => {
    const c = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/可删除/待删",
      markdown: "x",
    });
    const del = await api("/api/filetree/removeDoc", { id: c.data, notebook: nbId });
    await sleep(800);
    const still = scanNotebook(nbId).filter((d) => d.id === c.data || d.hPath?.includes("待删"));
    return { created: c.data, del, stillOnDisk: still };
  });

  // E. 同名不同内容的上传是否改名
  await step("E 同名不同内容的资源上传", async () => {
    const png1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    // 第二张：改一个字节，确保内容哈希不同
    const png2 = Buffer.from(png1);
    png2[png2.length - 1] = 0x00;

    async function up(buf, name) {
      const fd = new FormData();
      fd.append("assetsDirPath", "/assets/");
      fd.append("file[]", new Blob([buf], { type: "image/png" }), name);
      const res = await fetch(BASE + "/api/asset/upload", { method: "POST", body: fd });
      return await res.json();
    }
    const a = await up(png1, "same.png");
    const b = await up(png2, "same.png");
    const c = await up(png1, "same.png");
    return {
      a: a?.data?.succMap,
      b: b?.data?.succMap,
      cIdenticalContentAgain: c?.data?.succMap,
      assetsOnDisk: readdirSync(join(WS, "data", "assets")).filter((f) => f.includes("same")).slice(-6),
    };
  });

  // F. 已存在父文档时再拖一次同名文件夹（模拟重复导入）
  await step("F 重复导入同一层级的稳定性", async () => {
    const r1 = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/项目A/子目录/文档",
      markdown: "第一轮",
    });
    const r2 = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/项目A/子目录/文档 (2)",
      markdown: "第二轮",
    });
    await sleep(1000);
    const disk = scanNotebook(nbId).filter((d) => (d.hPath || "").includes("项目A"));
    return { r1: r1.code, r2: r2.code, disk: disk.map((d) => d.hPath) };
  });
} finally {
  if (nbId) {
    const del = await api("/api/notebook/removeNotebook", { notebook: nbId }).catch((e) => ({ code: -99, msg: String(e) }));
    out.push({ name: "Z 清理", ok: del.code === 0, del });
    console.log("\n清理：", JSON.stringify(del));
  }
  mkdirSync(HERE, { recursive: true });
  writeFileSync(join(HERE, "kernel-report-2.json"), JSON.stringify(out, null, 2), "utf8");
}
