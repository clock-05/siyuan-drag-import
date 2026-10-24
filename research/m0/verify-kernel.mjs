/**
 * M0 内核行为验证 —— 在真实运行的思源（127.0.0.1:6806）上执行。
 *
 * 安全约定：
 *  1. 只在自建的临时笔记本里操作，结束时整本删除（try/finally 保证）。
 *  2. 不读取、不修改用户已有笔记本。
 *  3. 全程只调公开 API。
 *
 * 运行：node drag-drop-import/m0/verify-kernel.mjs
 * 输出：drag-drop-import/m0/kernel-report.json + 控制台摘要
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:6806";
const HERE = dirname(fileURLToPath(import.meta.url));
const results = [];

const NB_NAME = `M0-verify-${Date.now().toString().slice(-6)}`;

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

async function step(name, fn) {
  try {
    const r = await fn();
    results.push({ name, ok: true, ...r });
    console.log(`\n▶ ${name}\n  ${JSON.stringify(r).slice(0, 900)}`);
    return r;
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.stack || e) });
    console.log(`\n✗ ${name}\n  ${e?.stack || e}`);
    return null;
  }
}

/* ------------------------------------------------------------------ */

let nbId = null;

try {
  // ============ 0. 建临时笔记本 ============
  await step("00 创建临时笔记本", async () => {
    const r = await api("/api/notebook/createNotebook", { name: NB_NAME });
    nbId = r?.data?.notebook?.id;
    if (!nbId) throw new Error("建笔记本失败：" + JSON.stringify(r));
    return { nbId, nbName: NB_NAME, resp: r };
  });
  if (!nbId) throw new Error("没有临时笔记本，后续测试无法进行");

  const sql = (stmt) => api("/api/query/sql", { stmt });

  // ============ 1. createDocWithMd 多级 hpath 是否自动补建 ============
  await step("01 多级 hpath 自动补建父文档", async () => {
    const r = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/L1/L2/L3",
      markdown: "多级路径测试",
    });
    const docs = await sql(
      `SELECT id, hpath, content FROM blocks WHERE type='d' AND box='${nbId}' ORDER BY hpath`
    );
    return {
      resp: r,
      docsInNotebook: docs?.data ?? docs,
      note: "若只出现 /L1/L2/L3 一条，说明父层级是隐式的；若出现 L1、L1/L2、L1/L2/L3 三条，说明自动补建",
    };
  });

  // ============ 2. 同名 hpath 重复创建 ============
  await step("02 同一 hpath 重复创建两次", async () => {
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
    const docs = await sql(
      `SELECT id, hpath FROM blocks WHERE type='d' AND box='${nbId}' AND hpath LIKE '%同名%'`
    );
    return { first: a, second: b, matched: docs?.data ?? docs };
  });

  // ============ 3. getIDsByHPath 能否预查重名 ============
  await step("03 getIDsByHPath 查已存在路径", async () => {
    const hit = await api("/api/filetree/getIDsByHPath", {
      notebook: nbId,
      path: "/L1/L2/L3",
    });
    const miss = await api("/api/filetree/getIDsByHPath", {
      notebook: nbId,
      path: "/不存在/根本没有",
    });
    return { hit, miss };
  });

  // ============ 4. 父文档已存在时能否继续往下挂 ============
  await step("04 复用已存在的父文档继续建子文档", async () => {
    const r = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/L1/L2/新增子文档",
      markdown: "父文档已存在，看是否复用",
    });
    const docs = await sql(
      `SELECT id, hpath FROM blocks WHERE type='d' AND box='${nbId}' AND hpath LIKE '/L1%' ORDER BY hpath`
    );
    return { resp: r, docs: docs?.data ?? docs };
  });

  // ============ 5. 命名边界 ============
  await step("05 命名边界：空格/非法字符/超长/emoji/空名", async () => {
    const cases = [
      ["首尾空格", "/边界/  带空格的名字  "],
      ["冒号", "/边界/带:冒号"],
      ["反斜杠", "/边界/带\\反斜杠"],
      ["问号星号", "/边界/带?问号*星号"],
      ["点结尾", "/边界/以点结尾."],
      ["超长120", "/边界/" + "长".repeat(120)],
      ["emoji", "/边界/🎉 庆祝一下"],
      ["中日韩混排", "/边界/한글とカタカナと汉字"],
      ["单斜杠结尾", "/边界/斜杠结尾/"],
      ["纯空格", "/边界/   "],
      ["点开头的隐藏名", "/边界/.gitignore"],
    ];
    const out = [];
    for (const [label, path] of cases) {
      const r = await api("/api/filetree/createDocWithMd", {
        notebook: nbId,
        path,
        markdown: "边界测试",
      });
      out.push({ label, path, code: r.code, msg: r.msg, id: r.data, ms: r._ms });
    }
    const docs = await sql(
      `SELECT id, hpath, length(content) AS n FROM blocks WHERE type='d' AND box='${nbId}' AND hpath LIKE '/边界%' ORDER BY hpath`
    );
    return { out, docs: docs?.data ?? docs };
  });

  // ============ 6. markdown 落地内容：frontmatter / GFM / callout / HTML ============
  await step("06 markdown 原样落库能力", async () => {
    const md = [
      "---",
      "title: 前端表格",
      "tags: [a, b]",
      "---",
      "",
      "## 表格",
      "",
      "| 列1 | 列2 |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "> [!note] 提示",
      "> callout 内容",
      "",
      "<div style=\"color:red\">内联 HTML</div>",
      "",
      "$E=mc^2$",
    ].join("\n");
    const r = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/能力/frontmatter 与语法",
      markdown: md,
    });
    let kramdown = null;
    if (r.code === 0) {
      const k = await api("/api/block/getBlockKramdown", { id: r.data });
      kramdown = k?.data?.kramdown;
    }
    return { resp: r, kramdown: (kramdown || "").slice(0, 1200) };
  });

  // ============ 7. 资源上传与同名改名 ============
  await step("07 /api/asset/upload 上传与同名处理", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const tmp = join(HERE, "__probe.png");
    writeFileSync(tmp, png);

    async function upload(name) {
      const fd = new FormData();
      fd.append("assetsDirPath", "/assets/");
      fd.append("file[]", new Blob([png], { type: "image/png" }), name);
      const t0 = performance.now();
      const res = await fetch(BASE + "/api/asset/upload", { method: "POST", body: fd });
      const json = await res.json();
      return { name, ...json, _ms: +(performance.now() - t0).toFixed(1) };
    }

    const a = await upload("probe.png");
    const b = await upload("probe.png");
    const c = await upload("中文图片名.png");
    return { first: a, second: b, chinese: c };
  });

  // ============ 8. 删除文档 ============
  await step("08 removeDoc 删除并确认", async () => {
    const c = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/可删除/待删",
      markdown: "x",
    });
    const del = await api("/api/filetree/removeDoc", { id: c.data });
    const after = await sql(`SELECT id, hpath FROM blocks WHERE id='${c.data}'`);
    return { created: c, removeResp: del, after: after?.data ?? after };
  });

  // ============ 9. 批量性能 ============
  await step("09 连续建 100 篇耗时分布", async () => {
    const N = 100;
    const times = [];
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const r = await api("/api/filetree/createDocWithMd", {
        notebook: nbId,
        path: `/性能/第 ${i + 1} 篇`,
        markdown: `# 第 ${i + 1} 篇\n\n正文内容，用于测试批量写入。`,
      });
      if (r.code !== 0) times.push({ i, err: r.msg });
      else times.push(r._ms);
    }
    const total = +(performance.now() - t0).toFixed(0);
    const nums = times.filter((x) => typeof x === "number").sort((a, b) => a - b);
    return {
      count: N,
      totalMs: total,
      avgMs: +(nums.reduce((s, x) => s + x, 0) / nums.length).toFixed(1),
      p50: nums[Math.floor(nums.length * 0.5)],
      p95: nums[Math.floor(nums.length * 0.95)],
      max: nums[nums.length - 1],
      perSec: +(N / (total / 1000)).toFixed(1),
    };
  });

  // ============ 10. 已关闭笔记本作为目标 ============
  await step("10 目标笔记本被关闭时的行为", async () => {
    const close = await api("/api/notebook/closeNotebook", { notebook: nbId });
    const afterClose = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/关闭后/能建吗",
      markdown: "x",
    });
    const open = await api("/api/notebook/openNotebook", { notebook: nbId });
    const afterOpen = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/关闭后/重新打开后",
      markdown: "x",
    });
    return { close, afterClose, open, afterOpen };
  });
} finally {
  // ============ 清理 ============
  if (nbId) {
    const del = await api("/api/notebook/removeNotebook", { notebook: nbId }).catch((e) => ({
      code: -99,
      msg: String(e),
    }));
    results.push({ name: "99 清理临时笔记本", ok: del.code === 0, del, nbId });
    console.log(`\n▶ 清理：${JSON.stringify(del)}`);
  }
  mkdirSync(HERE, { recursive: true });
  writeFileSync(join(HERE, "kernel-report.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(`\n报告已写入 ${join(HERE, "kernel-report.json")}`);
}
