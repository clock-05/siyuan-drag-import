/**
 * 端到端（真机）：把 T3–T6 的产物直接打到运行中的思源内核。
 * 覆盖：来源分类 → 命名/编码/frontmatter/H1 → 查重加后缀 → createDocWithMd → 回读正文。
 * 全程只操作自建临时笔记本，finally 里删除。
 */

import esbuild from "esbuild";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeZip } from "./zip-fixture.mjs";

const BUILD = "test/.build";
const BASE = "http://127.0.0.1:6806";
const require = createRequire(import.meta.url);

await esbuild.build({
  entryPoints: [
    "src/source/analyze.ts",
    "src/import/planner.ts",
    "src/import/executor.ts",
    "src/import/undo.ts",
  ],
  bundle: true,
  format: "esm",
  outdir: BUILD,
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});

const stamp = Date.now();
const { analyzeSources } = await import(`../${BUILD}/source/analyze.mjs?t=${stamp}`);
const { scanPlan, resolvePlan } = await import(`../${BUILD}/import/planner.mjs?t=${stamp}`);
const { runPlan } = await import(`../${BUILD}/import/executor.mjs?t=${stamp}`);
const { undoImport, rollbackBatch } = await import(`../${BUILD}/import/undo.mjs?t=${stamp}`);

const workDir = mkdtempSync(join(tmpdir(), "sdi-e2e-"));
global.window = {
  require: (id) => {
    if (id === "electron") {
      return { webUtils: { getPathForFile: (file) => file.__path ?? "" } };
    }
    return require(id);
  },
  siyuan: { config: { system: { workspaceDir: workDir } } },
};

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

// 插件里用的是相对路径（浏览器会自动拼上 6806 的 origin），Node 的 fetch 要求绝对地址
const rawFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  rawFetch(typeof input === "string" && input.startsWith("/") ? BASE + input : input, init);

function fileAt(path, content, name = path.split(/[\\/]/).pop()) {
  const file = new File([content], name);
  Object.defineProperty(file, "__path", { value: path });
  return file;
}

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? `（${detail}）` : ""}`);
  }
};

const NB_NAME = `M1-e2e-${String(stamp).slice(-5)}`;
let nbId = "";

try {
  const created = await api("/api/notebook/createNotebook", { name: NB_NAME });
  nbId = created?.data?.notebook?.id ?? "";
  check("临时笔记本已创建", Boolean(nbId), JSON.stringify(created));

  /* ---------- 造样本 ---------- */
  const utf8Path = join(workDir, "笔记.md");
  writeFileSync(
    utf8Path,
    "---\ntitle: 测试\ntags: [a, b]\n---\n\n# 笔记\n\n第一段正文。\n",
    "utf-8",
  );
  const gbkPath = join(workDir, "GBK 笔记.md");
  // "中文测试" 的 GBK 编码
  writeFileSync(gbkPath, Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]));
  const pngPath = join(workDir, "封面.png");
  writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const folderPath = join(workDir, "一个文件夹");
  mkdirSync(folderPath);

  const files = [
    fileAt(utf8Path, "---\ntitle: 测试\ntags: [a, b]\n---\n\n# 笔记\n\n第一段正文。\n"),
    fileAt(gbkPath, Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4])),
    fileAt(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    fileAt(folderPath, "", "一个文件夹"),
  ];

  /* ---------- T3 来源识别 ---------- */
  const analysis = analyzeSources(files, null);
  check("识别出 2 个 md", analysis.md.length === 2, String(analysis.md.length));
  check("png 被归类为不支持", analysis.rejected.some((r) => r.name === "封面.png"));
  check(
    "空文件夹被明确拒绝（不是静默忽略）",
    analysis.rejected.some((r) => r.name === "一个文件夹" && r.kind === "empty"),
    JSON.stringify(analysis.rejected),
  );
  check("取到了真实路径", analysis.md.every((m) => m.path.startsWith(workDir)));

  /* ---------- T5 规划 + T6 执行 ---------- */
  const target = { notebook: nbId, label: "根目录", isNotebookRoot: true, row: null };
  const scan = await scanPlan(analysis.md, target, null);
  const plan = await resolvePlan(scan, { fallback: "suffix" });
  check("规划出 2 篇", plan.items.length === 2, JSON.stringify(plan.items.map((i) => i.hpath)));
  check(
    "hpath 落在根级",
    plan.items.every((i) => /^\/[^/]+$/.test(i.hpath)),
    JSON.stringify(plan.items.map((i) => i.hpath)),
  );

  const first = await runPlan(plan.items, nbId, null);
  check("2 篇全部建成", first.ok.length === 2 && first.failed.length === 0, JSON.stringify(first.failed));

  /* ---------- 失败项要带「能不能重试」的标记 ---------- */
  const hugeRun = await runPlan(
    plan.items.slice(0, 1).map((item) => ({ ...item, size: 999 * 1024 * 1024 })),
    nbId,
    null,
    undefined,
    undefined,
    { maxBytes: 1024 },
  );
  check("超过大小上限的失败不给重试", hugeRun.failed[0]?.retryable === false, JSON.stringify(hugeRun.failed));
  check("不可重试的失败不保留原始项", hugeRun.failed[0]?.item === undefined);

  const missingRun = await runPlan(
    plan.items.slice(0, 1).map((item) => ({
      ...item,
      source: { ...item.source, file: undefined, path: "/不存在的路径/缺失.md" },
    })),
    nbId,
    null,
  );
  check("读不到文件的失败可以重试", missingRun.failed[0]?.retryable === true, JSON.stringify(missingRun.failed));
  check("可重试的失败带着原始项", Boolean(missingRun.failed[0]?.item));

  /* ---------- 回读正文 ---------- */
  const noteId = first.ok.find((item) => item.name === "笔记")?.id;
  const gbkId = first.ok.find((item) => item.name === "GBK 笔记")?.id;

  const noteDoc = await api("/api/block/getBlockKramdown", { id: noteId });
  const noteText = noteDoc?.data?.kramdown ?? "";
  check("frontmatter 没有进正文", !noteText.includes("tags:"));
  check("重复的 H1 被去掉", !noteText.trimStart().startsWith("# 笔记"), noteText.slice(0, 40));
  check("正文内容正确", noteText.includes("第一段正文。"));

  const gbkDoc = await api("/api/block/getBlockKramdown", { id: gbkId });
  check("GBK 文件不乱码", (gbkDoc?.data?.kramdown ?? "").includes("中文测试"), gbkDoc?.data?.kramdown ?? "");

  /* ---------- 同名冲突：三种策略 ---------- */
  const scan2 = await scanPlan(analysis.md, target, null);
  const conflictEntries = scan2.entries.filter((entry) => entry.existingId);
  check("扫描出 2 个同名冲突", conflictEntries.length === 2, String(conflictEntries.length));
  check ("冲突项带上了已有文档 id", conflictEntries.every((entry) => Boolean(entry.existingId)));

  const choicesOf = (value) => new Map(scan2.entries.map((entry) => [entry.hpath, value]));

  const skipPlan = await resolvePlan(scan2, { choices: choicesOf("skip") });
  check("跳过策略：一篇都不建", skipPlan.items.length === 0 && skipPlan.skipped.length === 2, JSON.stringify(skipPlan));

  const suffixPlan = await resolvePlan(scan2, { choices: choicesOf("suffix") });
  check(
    "加后缀策略：得到「笔记 (2)」",
    suffixPlan.items.some((item) => item.hpath === "/笔记 (2)"),
    JSON.stringify(suffixPlan.items.map((i) => i.hpath)),
  );

  const overwritePlan = await resolvePlan(scan2, { choices: choicesOf("overwrite") });
  const noteOverwrite = overwritePlan.items.find((item) => item.name === "笔记");
  check(
    "覆盖策略指向已有文档",
    noteOverwrite?.mode === "overwrite" && noteOverwrite?.overwriteId === noteId,
    JSON.stringify(noteOverwrite),
  );

  const suffixRun = await runPlan(suffixPlan.items, nbId, null);
  check("加后缀批次建成", suffixRun.ok.length === 2, JSON.stringify(suffixRun.failed));
  const dupIds = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/笔记 (2)" });
  check("内核里确实有「笔记 (2)」", (dupIds?.data ?? []).length === 1, JSON.stringify(dupIds));
  const originalAgain = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/笔记" });
  check("原「笔记」仍是 1 个", (originalAgain?.data ?? []).length === 1, JSON.stringify(originalAgain));

  /* ---------- 覆盖：换正文、保 id、保子文档 ---------- */
  const overwriteTarget = (await api("/api/filetree/createDocWithMd", {
    notebook: nbId,
    path: "/被覆盖",
    markdown: "旧正文内容",
  })).data;
  await api("/api/filetree/createDocWithMd", {
    notebook: nbId,
    path: "/被覆盖/子文档",
    markdown: "子文档正文",
  });

  const ovPath = join(workDir, "被覆盖.md");
  writeFileSync(ovPath, "新正文内容");
  const ovScan = await scanPlan(analyzeSources([fileAt(ovPath, "新正文内容")], null).md, target, null);
  check("覆盖前扫描到冲突", ovScan.entries[0]?.existingId === overwriteTarget, JSON.stringify(ovScan.entries));
  const ovPlan = await resolvePlan(ovScan, {
    choices: new Map([[ovScan.entries[0].hpath, "overwrite"]]),
  });
  const ovRun = await runPlan(ovPlan.items, nbId, null);
  check("覆盖执行成功", ovRun.ok.length === 1 && ovRun.ok[0].mode === "overwrite", JSON.stringify(ovRun));
  check("覆盖后 id 不变", ovRun.ok[0]?.id === overwriteTarget, ovRun.ok[0]?.id);
  const ovDoc = await api("/api/block/getBlockKramdown", { id: overwriteTarget });
  const ovText = ovDoc?.data?.kramdown ?? "";
  check("正文被换成新内容", ovText.includes("新正文内容") && !ovText.includes("旧正文内容"), ovText);
  const ovChild = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/被覆盖/子文档" });
  check("子文档没有被连累", (ovChild?.data ?? []).length === 1, JSON.stringify(ovChild));

  /* ---------- 还原式撤销：覆盖后写回导入前的快照 ---------- */
  const ovBefore = ovRun.ok[0]?.before ?? "";
  check("覆盖时留了还原点", ovBefore.includes("旧正文内容") && !ovBefore.includes("新正文内容"), ovBefore.slice(0, 60));
  const ovUndo = await undoImport({
    notebook: nbId,
    created: [],
    restored: [{ id: overwriteTarget, before: ovBefore }],
    autoDirs: [],
  });
  check("覆盖撤销走「还原」而不是删除", ovUndo.restored === 1 && ovUndo.removed === 0, JSON.stringify(ovUndo));
  const ovBack = (await api("/api/block/getBlockKramdown", { id: overwriteTarget }))?.data?.kramdown ?? "";
  check("正文回到覆盖前", ovBack.includes("旧正文内容") && !ovBack.includes("新正文内容"), ovBack.slice(0, 60));
  const ovChildAfter = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/被覆盖/子文档" });
  check("还原后子文档还在", (ovChildAfter?.data ?? []).length === 1, JSON.stringify(ovChildAfter));

  /* ---------- 目标文档作为父级 ---------- */
  const childPlan = await resolvePlan(
    await scanPlan(analysis.md, { ...target, parentDocId: noteId }, null),
    { fallback: "suffix" },
  );
  check(
    "拖到文档上时成为子文档",
    childPlan.items.every((item) => item.hpath.startsWith("/笔记/")),
    JSON.stringify(childPlan.items.map((i) => i.hpath)),
  );
  const childRun = await runPlan(childPlan.items, nbId, null);
  check("子文档建成（父级自动复用）", childRun.ok.length === 2, JSON.stringify(childRun.failed));

  /* ---------- M2：文件夹 ---------- */
  const projDir = join(workDir, "项目A");
  mkdirSync(join(projDir, "spec"), { recursive: true });
  mkdirSync(join(projDir, "empty"), { recursive: true });
  mkdirSync(join(projDir, "img"), { recursive: true });
  mkdirSync(join(projDir, ".obsidian"), { recursive: true });
  writeFileSync(join(projDir, "a.md"), "# a\n\n甲");
  writeFileSync(join(projDir, "b.md"), "# b\n\n乙");
  writeFileSync(join(projDir, "spec", "c.md"), "# c\n\n丙");
  writeFileSync(join(projDir, "img", "x.png"), "png");
  writeFileSync(join(projDir, "note.txt"), "txt");
  writeFileSync(join(projDir, ".obsidian", "app.md"), "# 不该导入");

  const folderAnalysis = analyzeSources([fileAt(projDir, "", "项目A")], null);
  check("文件夹里收到 3 个 md", folderAnalysis.md.length === 3, String(folderAnalysis.md.length));
  check(
    "目录段带上了文件夹本身",
    folderAnalysis.md.every((item) => item.dirs[0] === "项目A"),
    JSON.stringify(folderAnalysis.md.map((i) => i.dirs)),
  );
  check("隐藏目录没被收进来", !folderAnalysis.md.some((item) => item.name === "app.md"));
  check(
    "非 md 与资产各汇总一行",
    folderAnalysis.rejected.some((item) => item.name.includes("1 个非 Markdown")) &&
      folderAnalysis.rejected.some((item) => item.name.includes("1 个图片/附件")),
    JSON.stringify(folderAnalysis.rejected.map((i) => i.name)),
  );

  const folderPlan = await resolvePlan(await scanPlan(folderAnalysis.md, target, null), { fallback: "suffix" });
  const folderPaths = folderPlan.items.map((item) => item.hpath).sort();
  check(
    "hpath 还原三层层级",
    JSON.stringify(folderPaths) === JSON.stringify(["/项目A/a", "/项目A/b", "/项目A/spec/c"]),
    JSON.stringify(folderPaths),
  );

  const folderRun = await runPlan(folderPlan.items, nbId, null);
  check("文件夹里 3 篇全部建成", folderRun.ok.length === 3 && folderRun.failed.length === 0, JSON.stringify(folderRun.failed));

  const parentIds = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/项目A" });
  check("文件夹自动补建成父文档", (parentIds?.data ?? []).length === 1, JSON.stringify(parentIds));
  const subIds = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/项目A/spec" });
  check("二级目录同样补建", (subIds?.data ?? []).length === 1, JSON.stringify(subIds));
  const emptyIds = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/项目A/empty" });
  check("空目录不建文档", (emptyIds?.data ?? []).length === 0, JSON.stringify(emptyIds));
  const imgIds = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/项目A/img" });
  check("资源目录不建文档", (imgIds?.data ?? []).length === 0, JSON.stringify(imgIds));

  const nestedId = folderRun.ok.find((item) => item.name === "c")?.id;
  const nestedDoc = await api("/api/block/getBlockKramdown", { id: nestedId });
  check("子目录正文正确", (nestedDoc?.data?.kramdown ?? "").includes("丙"), nestedDoc?.data?.kramdown ?? "");

  // 再拖一次同一个文件夹：父文档必须复用，只有文件加 (2)
  const againScan = await scanPlan(analyzeSources([fileAt(projDir, "", "项目A")], null).md, target, null);
  check("二次拖入扫描出冲突", againScan.entries.filter((e) => e.existingId).length === 3, String(againScan.entries.filter((e) => e.existingId).length));
  const again = await resolvePlan(againScan, { fallback: "suffix" });
  check(
    "二次拖入不给目录加后缀",
    again.items.every((item) => item.hpath.startsWith("/项目A/")),
    JSON.stringify(again.items.map((i) => i.hpath)),
  );
  check(
    "二次拖入文件走 (2)",
    again.items.some((item) => item.hpath === "/项目A/a (2)"),
    JSON.stringify(again.items.map((i) => i.hpath)),
  );
  const againRun = await runPlan(again.items, nbId, null);
  check("二次拖入全部建成", againRun.ok.length === 3, JSON.stringify(againRun.failed));
  const parentAgain = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/项目A" });
  check("父文档仍是 1 个（复用不新建）", (parentAgain?.data ?? []).length === 1, JSON.stringify(parentAgain));

  /* ---------- M3：压缩包 ---------- */
  const zipPath = join(workDir, "压缩包A.zip");
  writeFileSync(
    zipPath,
    Buffer.from(
      makeZip([
        { name: "压缩包项目/", data: "" },
        { name: "压缩包项目/a.md", data: "# a\n\n压缩包内甲" },
        { name: "压缩包项目/spec/c.md", data: "# c\n\n压缩包内丙" },
        { name: "压缩包项目/note.txt", data: "txt" },
        { name: "压缩包项目/img/x.png", data: "png" },
        { name: "__MACOSX/._a.md", data: "junk" },
      ]),
    ),
  );

  const zipAnalysis = analyzeSources([fileAt(zipPath, "", "压缩包A.zip")], null);
  check("压缩包解出 2 个 md", zipAnalysis.md.length === 2, String(zipAnalysis.md.length));
  check(
    "压缩包内路径带顶层目录",
    zipAnalysis.md.every((item) => item.dirs[0] === "压缩包项目"),
    JSON.stringify(zipAnalysis.md.map((i) => i.dirs)),
  );
  check("压缩包内容走内存而不是磁盘", zipAnalysis.md.every((item) => Boolean(item.bytes)));

  const zipPlan = await resolvePlan(await scanPlan(zipAnalysis.md, target, null), { fallback: "suffix" });
  check(
    "压缩包 hpath 还原层级",
    JSON.stringify(zipPlan.items.map((i) => i.hpath).sort()) ===
      JSON.stringify(["/压缩包项目/a", "/压缩包项目/spec/c"]),
    JSON.stringify(zipPlan.items.map((i) => i.hpath).sort()),
  );
  const zipRun = await runPlan(zipPlan.items, nbId, null);
  check("压缩包 2 篇建成", zipRun.ok.length === 2, JSON.stringify(zipRun.failed));
  const zipDoc = await api("/api/block/getBlockKramdown", { id: zipRun.ok.find((i) => i.name === "a")?.id });
  check("压缩包正文正确", (zipDoc?.data?.kramdown ?? "").includes("压缩包内甲"), zipDoc?.data?.kramdown ?? "");

  // 不支持的压缩格式与思源导出包
  const rarPath = join(workDir, "资料.rar");
  writeFileSync(rarPath, "rar");
  const rarAnalysis = analyzeSources([fileAt(rarPath, "", "资料.rar")], null);
  check(
    "rar 明确提示转 zip",
    rarAnalysis.rejected.some((item) => item.name === "资料.rar" && item.reason.includes(".zip")),
    JSON.stringify(rarAnalysis.rejected),
  );

  const syPath = join(workDir, "旧笔记.sy.zip");
  writeFileSync(syPath, Buffer.from(makeZip([{ name: "x.md", data: "x" }])));
  const syAnalysis = analyzeSources([fileAt(syPath, "", "旧笔记.sy.zip")], null);
  check(
    "sy.zip 指路官方导入",
    syAnalysis.rejected.some((item) => item.reason.includes("设置 → 导入")),
    JSON.stringify(syAnalysis.rejected),
  );
  check("sy.zip 不会被当普通压缩包解开", syAnalysis.md.length === 0);

  // 坏包：一个字都不建
  const badPath = join(workDir, "坏的.zip");
  writeFileSync(badPath, Buffer.from("这不是 zip"));
  const badAnalysis = analyzeSources([fileAt(badPath, "", "坏的.zip")], null);
  check("坏包不产生任何 md", badAnalysis.md.length === 0);
  check("坏包给出原因", /损坏/.test(badAnalysis.rejected[0]?.reason ?? ""), JSON.stringify(badAnalysis.rejected));

  /* ---------- M4：图片上传与链接重写 ---------- */
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const picDir = join(workDir, "图项目");
  mkdirSync(join(picDir, "img"), { recursive: true });
  writeFileSync(join(picDir, "img", "a.png"), png);
  writeFileSync(join(picDir, "带图.md"), "![示意图](img/a.png)\n\n带图的正文");

  const picAnalysis = analyzeSources([fileAt(picDir, "", "图项目")], null);
  const picPlan = await resolvePlan(await scanPlan(picAnalysis.md, target, null), { fallback: "suffix" });
  const picRun = await runPlan(picPlan.items, nbId, null, undefined, undefined, { uploadImages: true });
  check("带图文档建成", picRun.ok.length === 1, JSON.stringify(picRun.failed));
  check("图片被上传", picRun.assets.images.uploaded === 1, JSON.stringify(picRun.assets));
  const picDoc = await api("/api/block/getBlockKramdown", { id: picRun.ok[0]?.id });
  const picText = picDoc?.data?.kramdown ?? "";
  check("链接被改写成 assets/", /assets\/[^)]+\.png/.test(picText), picText);
  check("原相对路径不再出现", !picText.includes("img/a.png"), picText);

  // 关掉上传时链接保持原样
  const noUploadPlan = await resolvePlan(
    await scanPlan(analyzeSources([fileAt(picDir, "", "图项目")], null).md, target, null),
    { fallback: "suffix" },
  );
  const noUploadRun = await runPlan(noUploadPlan.items, nbId, null, undefined, undefined, {
    uploadImages: false,
  });
  const noUploadDoc = await api("/api/block/getBlockKramdown", { id: noUploadRun.ok[0]?.id });
  check("关掉上传后保留原链接", (noUploadDoc?.data?.kramdown ?? "").includes("img/a.png"));
  check("关掉上传不计上传数", noUploadRun.assets.images.uploaded === 0);

  /* ---------- M4：Obsidian 写法（真机踩到的坑） ---------- */
  const obsDir = join(workDir, "Obsidian库");
  mkdirSync(join(obsDir, "attachments"), { recursive: true });
  writeFileSync(join(obsDir, "Pasted image 20261024211413.png"), png);
  writeFileSync(join(obsDir, "attachments", "封面图.png"), png);
  writeFileSync(join(obsDir, "未命名.md"), "\n![[Pasted image 20261024211413.png]]");
  writeFileSync(join(obsDir, "附件目录.md"), "![](封面图.png)\n\n正文");

  const obsAnalysis = analyzeSources([fileAt(obsDir, "", "Obsidian库")], null);
  const obsPlan = await resolvePlan(await scanPlan(obsAnalysis.md, target, null), { fallback: "suffix" });
  const obsRun = await runPlan(obsPlan.items, nbId, null);
  check("Obsidian 库两篇都建成", obsRun.ok.length === 2, JSON.stringify(obsRun.failed));
  check("两张图都上传了", obsRun.assets.images.uploaded === 2, JSON.stringify(obsRun.assets));

  const embeddedId = obsRun.ok.find((item) => item.name === "未命名")?.id;
  const embeddedDoc = await api("/api/block/getBlockKramdown", { id: embeddedId });
  const embeddedText = embeddedDoc?.data?.kramdown ?? "";
  check("嵌入语法被换成 assets 链接", /assets\/[^)]+\.png/.test(embeddedText), embeddedText);
  check("不再残留 ![[]] 语法", !embeddedText.includes("![["), embeddedText);

  const attachId = obsRun.ok.find((item) => item.name === "附件目录")?.id;
  const attachDoc = await api("/api/block/getBlockKramdown", { id: attachId });
  const attachText = attachDoc?.data?.kramdown ?? "";
  check("附件子目录里的图也能找到", /assets\/[^)]+\.png/.test(attachText), attachText);

  /* ---------- M4：普通文件链接（pdf）也上传 ---------- */
  const pdfDir = join(workDir, "带附件");
  mkdirSync(join(pdfDir, "files"), { recursive: true });
  mkdirSync(join(pdfDir, "附件"), { recursive: true });
  writeFileSync(join(pdfDir, "files", "讲义.pdf"), Buffer.from("%PDF-1.4\n%test\n"));
  writeFileSync(join(pdfDir, "附件", "课程笔记.pdf"), Buffer.from("%PDF-1.4\n%custom-dir\n"));
  writeFileSync(join(pdfDir, "[Zwonek 2012] 文献.pdf"), Buffer.from("%PDF-1.4\n%zotero\n"));
  writeFileSync(
    join(pdfDir, "附件笔记.md"),
    "# 附件笔记\n\n[课程讲义](files/讲义.pdf)\n\n[站外](https://example.com/a.pdf)\n\n![[[Zwonek 2012] 文献.pdf]]\n\n![[课程笔记.pdf]]",
  );
  const pdfAnalysis = analyzeSources([fileAt(pdfDir, "", "带附件")], null);
  const pdfPlan = await resolvePlan(await scanPlan(pdfAnalysis.md, target, null), { fallback: "suffix" });
  const pdfRun = await runPlan(pdfPlan.items, nbId, null);
  check("带附件的文档建成", pdfRun.ok.length === 1, JSON.stringify(pdfRun.failed));
  check("三个 pdf 都上传了", pdfRun.assets.files.uploaded === 3, JSON.stringify(pdfRun.assets));
  check("自定义附件目录里的也能找到", pdfRun.assets.kinds[".pdf"]?.uploaded === 3, JSON.stringify(pdfRun.assets.kinds));
  const pdfDoc = await api("/api/block/getBlockKramdown", { id: pdfRun.ok[0]?.id });
  const pdfText = pdfDoc?.data?.kramdown ?? "";
  check("pdf 链接被改写", /\(assets\/[^)]+\.pdf\)/.test(pdfText), pdfText);
  check("外链保持原样", pdfText.includes("https://example.com/a.pdf"), pdfText);
  check("Obsidian 的 pdf 嵌入被转成链接", !pdfText.includes("!["), pdfText);
  check("方形括号文件名也改写成功", pdfText.includes("Zwonek 2012\\] 文献.pdf"), pdfText);

  // 渲染层确认：带方括号的链接文字真的是链接，不是一段坏文本
  const pdfDom = await api("/api/block/getBlockDOM", { id: pdfRun.ok[0]?.id });
  const pdfHtml = String(pdfDom?.data?.dom ?? "");
  check("带方括号的链接渲染成 a", /<span data-type="a"[^>]*href="assets\/[^"]+\.pdf"[^>]*>\[Zwonek 2012\] 文献\.pdf<\/span>/.test(pdfHtml), pdfHtml);

  /* ---------- M4：追加策略 ---------- */
  const appendTarget = (await api("/api/filetree/createDocWithMd", {
    notebook: nbId,
    path: "/追加目标",
    markdown: "原有内容",
  })).data;
  const appendPath = join(workDir, "追加目标.md");
  writeFileSync(appendPath, "新增内容");
  const appendScan = await scanPlan(analyzeSources([fileAt(appendPath, "新增内容")], null).md, target, null);
  check("追加前扫描到冲突", appendScan.entries[0]?.existingId === appendTarget);
  const appendPlan = await resolvePlan(appendScan, {
    choices: new Map([[appendScan.entries[0].hpath, "append"]]),
  });
  const appendRun = await runPlan(appendPlan.items, nbId, null);
  check("追加执行成功", appendRun.ok[0]?.mode === "append", JSON.stringify(appendRun.ok));
  const appendedDoc = await api("/api/block/getBlockKramdown", { id: appendTarget });
  const appendedText = appendedDoc?.data?.kramdown ?? "";
  check("原有内容还在", appendedText.includes("原有内容"), appendedText);
  check("新增内容接在后面", appendedText.includes("新增内容"), appendedText);
  check("带来源说明", appendedText.includes("以下内容来自"), appendedText);
  check("追加不改文档 id", appendRun.ok[0]?.id === appendTarget);

  /* ---------- 还原式撤销：追加段被整段去掉 ---------- */
  const apBefore = appendRun.ok[0]?.before ?? "";
  check(
    "追加时留的还原点不含新增内容",
    apBefore.includes("原有内容") && !apBefore.includes("新增内容"),
    apBefore.slice(0, 60),
  );
  const apUndo = await undoImport({
    notebook: nbId,
    created: [],
    restored: [{ id: appendTarget, before: apBefore }],
    autoDirs: [],
  });
  check("追加撤销走还原", apUndo.restored === 1, JSON.stringify(apUndo));
  const apBack = (await api("/api/block/getBlockKramdown", { id: appendTarget }))?.data?.kramdown ?? "";
  check("追加段被去掉", !apBack.includes("新增内容") && apBack.includes("原有内容"), apBack.slice(0, 80));
  check("来源说明也一并消失", !apBack.includes("以下内容来自"), apBack.slice(0, 80));

  /* ---------- M4：撤销 ---------- */
  const undoDir = join(workDir, "撤销项目");
  mkdirSync(undoDir, { recursive: true });
  writeFileSync(join(undoDir, "x.md"), "x");
  writeFileSync(join(undoDir, "y.md"), "y");
  const undoScan = await scanPlan(analyzeSources([fileAt(undoDir, "", "撤销项目")], null).md, target, null);
  check("撤销项目目录被记为新建", undoScan.autoDirs.includes("/撤销项目"), JSON.stringify(undoScan.autoDirs));
  const undoPlan = await resolvePlan(undoScan, { fallback: "suffix" });
  const undoRun = await runPlan(undoPlan.items, nbId, null);
  check("撤销前文档已建好", undoRun.ok.length === 2, JSON.stringify(undoRun.failed));

  const undoOutcome = await undoImport({
    notebook: nbId,
    created: undoRun.ok.map((item) => ({ id: item.id, hpath: item.hpath })),
    autoDirs: undoScan.autoDirs,
  });
  check("撤销篇数按实际删掉的文档算（不是把目录当 1 篇）", undoOutcome.removed === 2, JSON.stringify(undoOutcome));
  const undoGone = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/撤销项目" });
  check("撤销后顶层目录没了", (undoGone?.data ?? []).length === 0, JSON.stringify(undoGone));
  const undoChildGone = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/撤销项目/x" });
  check("撤销后子文档也没了", (undoChildGone?.data ?? []).length === 0);
  const untouchedDoc = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/笔记" });
  check("撤销不碰其它文档", (untouchedDoc?.data ?? []).length === 1, JSON.stringify(untouchedDoc));

  /* ---------- M3：中途取消 ---------- */
  const cancelPathA = join(workDir, "取消一.md");
  const cancelPathB = join(workDir, "取消二.md");
  writeFileSync(cancelPathA, "一");
  writeFileSync(cancelPathB, "二");
  const cancelPlan = await resolvePlan(
    await scanPlan(analyzeSources([fileAt(cancelPathA, "一"), fileAt(cancelPathB, "二")], null).md, target, null),
    { fallback: "suffix" },
  );
  let gates = 0;
  const cancelRun = await runPlan(cancelPlan.items, nbId, null, undefined, () => {
    gates += 1;
    return gates > 1;
  });
  check("取消后不再建", cancelRun.cancelled === true);
  check("取消前已建的已回滚（executor 只管建，回滚在上层做）", cancelRun.ok.length === 1, String(cancelRun.ok.length));
  const cancelledDoc = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/取消一" });
  const notBuilt = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/取消二" });
  check("第一篇在库里（还没回滚）", (cancelledDoc?.data ?? []).length === 1);
  check("第二篇没建", (notBuilt?.data ?? []).length === 0);

  /* ---------- 取消 = 撤销：把取消前建好的那批全撤掉 ---------- */
  {
    const rollback = await rollbackBatch({
      notebook: nbId,
      targets: cancelRun.ok.map((row) => ({
        id: row.id,
        hpath: row.hpath,
        name: row.name,
        mode: row.mode,
        before: row.before,
      })),
      autoDirs: [],
    });
    check("回滚删掉了取消前建的那篇", rollback.removed === 1, JSON.stringify(rollback));
    const afterRollback = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/取消一" });
    check("回滚后文档不在库里了", (afterRollback?.data ?? []).length === 0, JSON.stringify(afterRollback));
    check("回滚没有失败项", rollback.failed === 0, JSON.stringify(rollback));
  }
  /* ---------- M4.5：仓库里的附件样例（用户手动验收用的那一份） ---------- */
  const sampleDir = join(process.cwd(), "samples", "附件测试");
  const sampleAnalysis = analyzeSources([fileAt(sampleDir, "", "附件测试")], null);
  check(
    "样例目录识别到 1 篇",
    sampleAnalysis.md.length === 1,
    JSON.stringify(sampleAnalysis.md.map((m) => m.name)),
  );
  const samplePlan = await resolvePlan(await scanPlan(sampleAnalysis.md, target, null), { fallback: "suffix" });
  const sampleRun = await runPlan(samplePlan.items, nbId, null);
  check("样例导入成功", sampleRun.ok.length === 1, JSON.stringify(sampleRun.failed));
  check("普通链接 + 嵌入共 2 个文件，去重后只传两次", sampleRun.assets.files.uploaded === 2, JSON.stringify(sampleRun.assets));
  check("指向不存在的 pdf 计为缺失", sampleRun.assets.files.missing === 1, JSON.stringify(sampleRun.assets));
  const sampleDoc = await api("/api/block/getBlockKramdown", { id: sampleRun.ok[0]?.id });
  const sampleText = String(sampleDoc?.data?.kramdown ?? "");
  check("四处 pdf 引用都改写成 assets/", (sampleText.match(/\(assets\/[^)]+\.pdf\)/g) ?? []).length === 4, sampleText);
  check("没有残留 Obsidian 嵌入语法", !sampleText.includes("![["), sampleText);
  check("没有残留指向原路径的链接", !sampleText.includes("(docs/规格书.pdf)"), sampleText);
  check("外链保持原样", sampleText.includes("https://b3log.org/siyuan/"), sampleText);
  check("锚点保持原样", sampleText.includes("(#应该保留的)"), sampleText);
  check("mailto 保持原样", sampleText.includes("mailto:someone@example.com"), sampleText);
  check("缺失的附件保留原路径", sampleText.includes("docs/不存在.pdf"), sampleText);

  /* ---------- 0.8.2：两条来源指向同一篇文档，快照只取一次 ---------- */
  {
    const created = await api("/api/filetree/createDocWithMd", {
      notebook: nbId,
      path: "/重复目标",
      markdown: "原始正文",
    });
    const dupId = created?.data;
    const utf8 = (text) => new TextEncoder().encode(text);
    const item = (text) => ({
      source: { name: "重复目标.md", path: "", size: 8, dirs: [], bytes: utf8(text) },
      name: "重复目标",
      hpath: "/重复目标",
      size: 8,
      mode: "overwrite",
      overwriteId: dupId,
    });

    const dupRun = await runPlan([item("第一份"), item("第二份")], nbId, null);
    check("两条覆盖都执行了", dupRun.ok.length === 2, JSON.stringify(dupRun.failed));
    check(
      "同一篇文档的快照只取一次（第二条不能拿被改过的正文）",
      dupRun.ok[0]?.before === dupRun.ok[1]?.before,
      JSON.stringify(dupRun.ok.map((row) => row.before)),
    );

    const dupUndo = await undoImport({
      notebook: nbId,
      created: [],
      restored: dupRun.ok.map((row) => ({ id: row.id, before: row.before })),
      autoDirs: [],
    });
    check("同一篇被覆盖两次也能还原", dupUndo.restored === 2, JSON.stringify(dupUndo));
    const back = await api("/api/block/getBlockKramdown", { id: dupId });
    check(
      "撤销后正文真的回到导入前",
      String(back?.data?.kramdown ?? "").includes("原始正文"),
      String(back?.data?.kramdown ?? "").slice(0, 160),
    );
  }

  /* ---------- 0.8.3：Obsidian 双链转成思源块引用 ---------- */
  {
    const utf8 = (text) => new TextEncoder().encode(text);
    const doc = (name, text) => ({
      source: { name: `${name}.md`, path: "", size: text.length * 3, dirs: [], bytes: utf8(text) },
      name,
      hpath: `/${name}`,
      size: text.length * 3,
      mode: "create",
    });

    const linkRun = await runPlan(
      [doc("链接A", "见 [[链接B]] 和 [[链接B|B 的别名]]，还有 [[没导入的笔记]]。"), doc("链接B", "目标正文")],
      nbId,
      null,
    );
    check("双链：两篇都建好", linkRun.ok.length === 2, JSON.stringify(linkRun.failed));
    check("双链：统计到 2 处", linkRun.links === 2, String(linkRun.links));

    const targetB = linkRun.ok.find((row) => row.name === "链接B")?.id;
    const aId = linkRun.ok.find((row) => row.name === "链接A")?.id;
    const aText = String((await api("/api/block/getBlockKramdown", { id: aId }))?.data?.kramdown ?? "");
    check("双链：指向目标文档的 id", aText.includes(`((${targetB} "链接B"))`), aText.slice(0, 200));
    check("双链：别名原样显示", aText.includes(`((${targetB} "B 的别名"))`), aText.slice(0, 200));
    check("双链：没导入的目标保持原样", aText.includes("[[没导入的笔记]]"), aText.slice(0, 200));
    const aDom = String((await api("/api/block/getBlockDOM", { id: aId }))?.data?.dom ?? "");
    check("双链：内核真的渲染成块引用", aDom.includes('data-type="block-ref"'), aDom.slice(0, 200));

    const offRun = await runPlan(
      [doc("关闭A", "见 [[关闭B]]"), doc("关闭B", "目标")],
      nbId,
      null,
      undefined,
      undefined,
      { convertWikilinks: false },
    );
    check("双链开关关掉后不转", (offRun.links ?? 0) === 0, String(offRun.links));
    const offId = offRun.ok.find((row) => row.name === "关闭A")?.id;
    const offText = String((await api("/api/block/getBlockKramdown", { id: offId }))?.data?.kramdown ?? "");
    check("双链开关关掉后保留原文", offText.includes("[[关闭B]]"), offText.slice(0, 120));
  }

} finally {
  if (nbId) {
    const removed = await api("/api/notebook/removeNotebook", { notebook: nbId });
    console.log(`\n🧹 删除临时笔记本：${removed?.code === 0 ? "ok" : JSON.stringify(removed)}`);
  }
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`\n${passed} 项通过${failures.length ? `，${failures.length} 项失败` : ""}`);
if (failures.length) {
  console.log("\n失败明细：");
  for (const item of failures) {
    console.log(`  ✗ ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("真机链路（识别 → 规划 → 建文档 → 回读）：全部通过");
}
