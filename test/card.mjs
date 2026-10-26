/**
 * 结果卡片单测：T7 的三种结果计数、打开第一篇、日志折叠、关闭清理。
 * 组件本身不依赖思源，直接用 jsdom 挂载。
 */

import esbuild from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import { JSDOM } from "jsdom";

const BUILD = "test/.build";
const outfile = `${BUILD}/result.mjs`;
rmSync(outfile, { force: true });
await esbuild.build({
  entryPoints: ["src/ui/result.ts"],
  bundle: true,
  format: "esm",
  outfile,
  logLevel: "silent",
});

const { ResultCard } = await import(`../${outfile}?t=${Date.now()}`);

const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? `（${detail}）` : ""}`);
  }
};

const summary = {
  ok: [
    { name: "笔记", id: "doc-1", hpath: "/笔记", ms: 30, encoding: "utf-8", removedFrontmatter: false, removedH1: false, mode: "create" },
    { name: "GBK 笔记", id: "doc-2", hpath: "/GBK 笔记", ms: 31, encoding: "gbk", removedFrontmatter: false, removedH1: false, mode: "create" },
  ],
  failed: [{ name: "坏文件.md", reason: "无读取权限（可能被其他程序占用）" }],
  skipped: [
    { name: "封面.png", reason: "非 Markdown（.png）", kind: "other" },
    { name: "资料包.zip", reason: "压缩包（M3 支持）", kind: "archive" },
  ],
  ms: 1234,
  logPath: "D:/ws/data/storage/petal/siyuan-drag-import/logs/1024-1200.jsonl",
};

const card = new ResultCard();
let opened = "";
card.show(summary, { onOpenFirst: (id) => (opened = id) });

const el = document.querySelector(".sdi-card");
check("卡片挂到 body 上", Boolean(el));
check("标题为导入完成", el.querySelector(".sdi-card__title").textContent === "导入完成");
const counts = el.querySelector(".sdi-card__counts").textContent;
check("三种结果都计数", counts.includes("成功 2") && counts.includes("跳过 2") && counts.includes("失败 1"), counts);
check("耗时显示", counts.includes("1.2s"), counts);
check("失败 + 跳过共 3 条", el.querySelectorAll(".sdi-card__list li").length === 3);
check("失败原因可见", el.textContent.includes("无读取权限"));

const openBtn = el.querySelector('[data-act="open"]');
openBtn.dispatchEvent(new dom.window.Event("click"));
check("打开第一篇拿到正确 id", opened === "doc-1", opened);

const logBox = el.querySelector(".sdi-card__log");
check("日志默认折叠", logBox.hidden === true);
check("日志按钮改成「打开日志」", el.querySelector('[data-act="log"]').textContent === "打开日志");
el.querySelector('[data-act="log"]').dispatchEvent(new dom.window.Event("click"));
// jsdom 里没有 Electron 也没有剪贴板：兜底把路径亮出来
check("打不开时兜底亮出日志路径", logBox.hidden === false);
check("只放路径，不把整份日志摊进卡片", logBox.textContent.includes("1024-1200.jsonl") && !logBox.textContent.includes("onload"));

el.querySelector(".sdi-card__close").dispatchEvent(new dom.window.Event("click"));
check("关闭后 DOM 不残留", document.querySelector(".sdi-card") === null);

// 日志没启用（拿不到 fs / 工作区）：不放一个点了只会复制空路径的死按钮
card.show({ ...summary, logPath: "" });
check("日志关闭时没有「打开日志」按钮", document.querySelector('[data-act="log"]') === null);

// 全部跳过：没有成功项时不该出现「打开第一篇」，标题要说清是类型不支持
card.show({ ...summary, ok: [], failed: [] });
const emptyEl = document.querySelector(".sdi-card");
check("混合不支持时用通用标题", emptyEl.querySelector(".sdi-card__title").textContent === "没有可导入的文件");
check("没有成功项时不渲染打开按钮", emptyEl.querySelector('[data-act="open"]') === null);
check("全是不支持时不显示计数行", emptyEl.querySelector(".sdi-card__counts") === null);
check("重复 show 只留一张卡片", document.querySelectorAll(".sdi-card").length === 1);

// 只有读不了的文件夹（权限/层级/符号链接）时才走这条
card.show({ ...summary, ok: [], failed: [], skipped: [{ name: "legacy", reason: "无读取权限", kind: "folder" }] });
const folderEl = document.querySelector(".sdi-card");
check("读不了的文件夹标题明确", folderEl.querySelector(".sdi-card__title").textContent === "这些文件夹读不了");
check("读不了的文件夹只剩标题（原因在清单里）", folderEl.querySelector(".sdi-card__hint") === null);
check("只留文件名单，不重复计数", folderEl.querySelectorAll(".sdi-card__list li").length === 1);

// 只拖压缩包
card.show({ ...summary, ok: [], failed: [], skipped: [{ name: "资料.rar", reason: "暂只支持 .zip（可先转成 zip）", kind: "archive" }] });
check("拖 rar 时标题明确", document.querySelector(".sdi-card__title").textContent === "压缩包暂不支持");
check(
  "rar 的提示指向 zip",
  (document.querySelector(".sdi-card__hint")?.textContent ?? "") === "先转成 zip 再拖。",
  document.querySelector(".sdi-card__hint")?.textContent,
);

// 压缩包解开了但没有 md
card.show({
  ...summary,
  ok: [],
  failed: [],
  skipped: [{ name: "照片.zip", reason: "压缩包里没有 md 文件", kind: "archive", code: "archive-no-md" }],
});
check("空压缩包标题明确", document.querySelector(".sdi-card__title").textContent === "压缩包里没有 md 文件");

// 思源导出包是另一种情况，不能笼统说「压缩包不支持」
card.show({
  ...summary,
  ok: [],
  failed: [],
  skipped: [{ name: "笔记.sy.zip", reason: "思源导出包，请用「设置 → 导入」", kind: "archive", code: "export-package" }],
});
check("导出包单独提示", document.querySelector(".sdi-card__title").textContent === "这是思源导出包");

// 解压阶段的读取卡片（M3）
card.showReading("压缩包A.zip");
const readingEl = document.querySelector(".sdi-card");
check("读取卡片标题", readingEl.querySelector(".sdi-card__title").textContent === "正在读取…");
check("读取卡片显示文件名", (readingEl.querySelector(".sdi-card__counts")?.textContent ?? "").includes("压缩包A.zip"));
check("读取卡片没有取消按钮", readingEl.querySelector('[data-act="cancel"]') === null);

// 文件夹走的是另一个措辞：遍历文件夹不是「解压」
card.showReading("项目A", "folder");
check(
  "文件夹读取用「读取中」",
  document.querySelector(".sdi-card__progress")?.textContent === "读取中",
  document.querySelector(".sdi-card__progress")?.textContent,
);

// 大量同名 + 加后缀：resolvePlan 要一篇一篇找空名字，得有自己的提示
card.showReading("12 篇", "rename");
check("加后缀阶段有自己的标题", document.querySelector(".sdi-card__title").textContent === "正在处理同名文档…");
check(
  "加后缀阶段的提示词",
  document.querySelector(".sdi-card__progress").textContent === "加后缀",
  document.querySelector(".sdi-card__progress").textContent,
);

// 导入中的占位卡片（M2 文件夹批量导入时先给反馈）
card.showProgress(48, "项目A");
const busyEl = document.querySelector(".sdi-card");
check("进度卡片带总数", (busyEl.querySelector(".sdi-card__title")?.textContent ?? "").includes("48"));
check("进度卡片显示目标", (busyEl.querySelector(".sdi-card__counts")?.textContent ?? "").includes("项目A"));
check("进度卡片没有按钮", busyEl.querySelector(".sdi-card__foot") === null);
check("进度卡片有进度条", Boolean(busyEl.querySelector(".sdi-card__bar i")));

card.updateProgress(12, 48, "spec/c.md");
check("进度数字跟上了", busyEl.querySelector(".sdi-card__progress").textContent === "12 / 48");
check("显示当前文件名", busyEl.querySelector(".sdi-card__counts em").textContent === "spec/c.md");
check("进度条按比例", busyEl.querySelector(".sdi-card__bar i").style.width === "25%");

// 剩余时间：前 5 篇不估（样本太少），之后按平均速度外推，取整到 5 秒
{
  const realNow = Date.now;
  const base = realNow();
  let fake = base;
  Date.now = () => fake;
  try {
    card.showProgress(40, "项目A");
    const progress = () => document.querySelector(".sdi-card__progress").textContent;
    card.updateProgress(4, 40, "a.md");
    check("前 4 篇不给剩余时间", progress() === "4 / 40", progress());
    fake += 8000; // 10 篇用了 8 秒 → 每篇 0.8s，剩 30 篇 ≈ 24s，取整到 25
    card.updateProgress(10, 40, "b.md");
    check("按平均速度给剩余时间", progress() === "10 / 40 · 约 25 秒", progress());
    card.updateProgress(39, 40, "c.md");
    check("剩余不到 5 秒就不显示", progress() === "39 / 40", progress());
  } finally {
    Date.now = realNow;
  }
  card.destroy();
}

// 取消按钮（M3）：点一次就置灰，避免重复触发
let cancelAsked = 0;
card.showProgress(48, "项目A", () => {
  cancelAsked += 1;
});
const cancelBtn = document.querySelector('[data-act="cancel"]');
check("进度卡片有取消按钮", Boolean(cancelBtn));
check("取消按钮说明它等于撤销", cancelBtn.textContent === "取消并撤销", cancelBtn.textContent);
cancelBtn.dispatchEvent(new dom.window.Event("click"));
check("点取消会通知外层", cancelAsked === 1);
check("取消后按钮置灰防重复", cancelBtn.disabled === true && cancelBtn.textContent === "正在撤销…");
cancelBtn.dispatchEvent(new dom.window.Event("click"));
check("重复点不会二次触发", cancelAsked === 1);

// 结果会顶掉进度卡片，不会叠两张
card.show(summary, { onOpenFirst: () => {} });
check("结果顶掉进度卡片", document.querySelectorAll(".sdi-card").length === 1);
check("顶掉后标题变结果", document.querySelector(".sdi-card__title").textContent === "导入完成");
check("结果出来后进度更新被忽略", (() => {
  card.updateProgress(99, 99, "late.md");
  return document.querySelector(".sdi-card__progress") === null;
})());

// 有覆盖项时要标出来
card.show({
  ...summary,
  ok: [{ ...summary.ok[0], mode: "overwrite" }, summary.ok[1]],
});
check(
  "覆盖数单独标出",
  document.querySelector(".sdi-card__counts").textContent.includes("覆盖 1"),
  document.querySelector(".sdi-card__counts").textContent,
);

// 覆盖 + 追加分别计数
card.show({
  ...summary,
  ok: [{ ...summary.ok[0], mode: "overwrite" }, { ...summary.ok[1], mode: "append" }],
});
check(
  "覆盖与追加分别计数",
  document.querySelector(".sdi-card__counts").textContent.includes("覆盖 1") &&
    document.querySelector(".sdi-card__counts").textContent.includes("追加 1"),
  document.querySelector(".sdi-card__counts").textContent,
);

// 资源上传结果说明：一律「附件 + 后缀」，图片和文件同一句话
const assetStats = (images, files, kinds = {}) => ({
  images: { uploaded: 0, missing: 0, failed: 0, ...images },
  files: { uploaded: 0, missing: 0, failed: 0, ...files },
  kinds,
});
const kind = (ext, counts) => ({ [ext]: { uploaded: 0, missing: 0, failed: 0, ...counts } });
const noteOf = () => document.querySelector(".sdi-card__note")?.textContent ?? "";

card.show({
  ...summary,
  assets: assetStats({ uploaded: 3, missing: 1 }, {}, kind(".png", { uploaded: 3, missing: 1 })),
});
check(
  "图片也说成附件，后缀写在括号里",
  noteOf() === "已上传 3 个附件（.png），1 个附件找不到（.png），链接保持原样",
  noteOf(),
);

card.show({ ...summary, assets: assetStats({ uploaded: 0, missing: 1 }, {}, kind(".png", { missing: 1 })) });
check("只有缺失时句子完整", noteOf() === "1 个附件找不到（.png），链接保持原样", noteOf());

card.show({ ...summary, assets: assetStats({ uploaded: 5 }, {}, kind(".png", { uploaded: 5 })) });
check("全部成功时不带尾巴", noteOf() === "已上传 5 个附件（.png）", noteOf());

card.show({
  ...summary,
  assets: assetStats({ uploaded: 3 }, { uploaded: 2 }, { ...kind(".png", { uploaded: 3 }), ...kind(".pdf", { uploaded: 2 }) }),
});
check("图片与文件合并成一句，后缀并列", noteOf() === "已上传 5 个附件（.png、.pdf）", noteOf());
check("不再出现「张图片」", !noteOf().includes("张图片"), noteOf());

card.show({
  ...summary,
  assets: assetStats({ uploaded: 1 }, { missing: 1 }, { ...kind(".png", { uploaded: 1 }), ...kind(".pdf", { missing: 1 }) }),
});
check(
  "上传与缺失分两句说",
  noteOf() === "已上传 1 个附件（.png），1 个附件找不到（.pdf），链接保持原样",
  noteOf(),
);

card.show({ ...summary, assets: assetStats({}, { uploaded: 1 }, kind(".pages", { uploaded: 1 })) });
check("没见过的扩展名照实写", noteOf() === "已上传 1 个附件（.pages）", noteOf());

card.show({
  ...summary,
  assets: assetStats({ uploaded: 1, failed: 1 }, {}, kind(".png", { uploaded: 1, failed: 1 })),
});
check(
  "上传失败单独一句",
  noteOf() === "已上传 1 个附件（.png），1 个附件上传失败（.png），链接保持原样",
  noteOf(),
);

// 双链转换：只有真转了才多一行说明
card.show({ ...summary, links: 0 });
check("没转双链就不显示说明", !document.querySelector(".sdi-card").textContent.includes("[[双链]]"));
card.show({ ...summary, links: 5 });
check(
  "转了多少处双链写在卡片上",
  document.querySelector(".sdi-card").textContent.includes("已把 5 处 [[双链]] 转为引用"),
  document.querySelector(".sdi-card").textContent,
);

// 撤销：两步确认 + 倒计时 + 过期
let undoCalls = 0;
card.show(summary, {
  onUndo: async () => {
    undoCalls += 1;
    return "已删除 2 篇";
  },
  undoWindowMs: 30 * 1000,
});
const undoBtn = document.querySelector('[data-act="undo"]');
check("有新建文档时出现撤销按钮", Boolean(undoBtn));
check(
  "撤销按钮带倒计时",
  undoBtn.textContent.startsWith("撤销本次导入（") && undoBtn.textContent.includes("s"),
  undoBtn.textContent,
);
check("30 秒窗口用秒显示", undoBtn.textContent.includes("（30s）"), undoBtn.textContent);
undoBtn.dispatchEvent(new dom.window.Event("click"));
check(
  "第一次点只进入确认，并说清要删几篇",
  undoCalls === 0 && undoBtn.textContent.includes("确认删除 2 篇"),
  undoBtn.textContent,
);
undoBtn.dispatchEvent(new dom.window.Event("click"));
await new Promise((resolve) => setTimeout(resolve, 30));
check("第二次点才真撤销", undoCalls === 1);
check("撤销后显示外层给的结果", undoBtn.textContent === "已删除 2 篇", undoBtn.textContent);
check(
  "撤销后「打开第一篇」置灰（文档已经删了）",
  document.querySelector('[data-act="open"]').disabled === true,
);

// 覆盖 + 拿到快照 → 撤销按钮出现，且说的是「还原」
card.show(
  { ...summary, ok: [{ ...summary.ok[0], mode: "overwrite", before: "旧正文" }], failed: [], skipped: [] },
  { onUndo: async () => "已还原 1 篇" },
);
const restoreBtn = document.querySelector('[data-act="undo"]');
check("覆盖拿到快照后可以撤销", Boolean(restoreBtn));
restoreBtn.dispatchEvent(new dom.window.Event("click"));
check("确认文案说「还原」", restoreBtn.textContent.includes("确认还原 1 篇"), restoreBtn.textContent);

// 混合批次：删除 + 还原都写进确认文案
card.show(
  {
    ...summary,
    ok: [summary.ok[0], { ...summary.ok[1], mode: "append", before: "旧正文" }],
    failed: [],
    skipped: [],
  },
  { onUndo: async () => "已删除 1 篇 · 已还原 1 篇" },
);
const mixedBtn = document.querySelector('[data-act="undo"]');
mixedBtn.dispatchEvent(new dom.window.Event("click"));
check(
  "混合批次确认文案分开说",
  mixedBtn.textContent.includes("确认删除 1 篇 · 还原 1 篇"),
  mixedBtn.textContent,
);

// 覆盖但没拿到快照（比如取 kramdown 失败）→ 不给撤销入口
card.show({ ...summary, ok: [{ ...summary.ok[0], mode: "overwrite" }] }, { onUndo: async () => "" });
check("覆盖但没有快照时不给撤销按钮", document.querySelector('[data-act="undo"]') === null);

// 快照超限：不给撤销，并且说明原因
card.show({ ...summary, undoOff: true }, { onUndo: async () => "" });
check(
  "超限时不出现撤销按钮",
  document.querySelector('[data-act="undo"]') === null,
);
check(
  "超限时说明原因",
  (document.querySelector(".sdi-card__note")?.textContent ?? "").includes("100MB"),
  document.querySelector(".sdi-card__note")?.textContent,
);

card.show(summary, { onUndo: async () => 0, undoWindowMs: 0 });
const expiredBtn = document.querySelector('[data-act="undo"]');
check(
  "过期后按钮置灰",
  expiredBtn.disabled === true && expiredBtn.textContent === "撤销已过期",
  expiredBtn.textContent,
);

// 用户在冲突卡片上取消了（还没开始导，一篇都没建）
card.show({ ...summary, ok: [], failed: [], skipped: [], cancelled: true });
const cancelEl = document.querySelector(".sdi-card");
check("取消态标题", cancelEl.querySelector(".sdi-card__title").textContent === "已取消导入");
check("取消态不再重复解释（标题已说完）", cancelEl.querySelector(".sdi-card__hint") === null);
check("取消态不显示计数与按钮", cancelEl.querySelector(".sdi-card__counts") === null && cancelEl.querySelector('[data-act="open"]') === null);

// 导入中途取消 = 撤销：整批不留痕迹，卡片说明撤回了什么
card.show({
  ...summary,
  ok: [],
  failed: [],
  skipped: [],
  cancelled: true,
  rolledBack: { removed: 2, restored: 1, failed: 0, unrestored: 0 },
});
const rollbackEl = document.querySelector(".sdi-card");
check(
  "取消后标题是「已取消导入」",
  rollbackEl.querySelector(".sdi-card__title").textContent === "已取消导入",
);
check(
  "取消后说明撤回了什么",
  (rollbackEl.querySelector(".sdi-card__hint")?.textContent ?? "").includes("已撤销本次导入"),
  rollbackEl.querySelector(".sdi-card__hint")?.textContent,
);
check(
  "取消后没有「打开第一篇」（文档已被删）",
  rollbackEl.querySelector('[data-act="open"]') === null,
);
check("取消后没有撤销按钮（已经撤过了）", rollbackEl.querySelector('[data-act="undo"]') === null);

// 撤不回来的要点名：用户得知道哪几篇正文还留着被改过的样子
card.show({
  ...summary,
  ok: [],
  failed: [],
  skipped: [],
  cancelled: true,
  rolledBack: { removed: 2, restored: 0, failed: 0, unrestored: 1 },
  problems: [{ name: "被覆盖的那篇", reason: "这些文档在导入前被覆盖或追加过，但没有留下原文快照" }],
});
const problemEl = document.querySelector(".sdi-card");
check(
  "撤不回来的文档列出来",
  (problemEl.querySelector(".sdi-card__list")?.textContent ?? "").includes("被覆盖的那篇"),
  problemEl.querySelector(".sdi-card__list")?.textContent,
);
check(
  "撤不回来的算「有失败」，卡片不自己消失",
  problemEl.classList.contains("sdi-card--has-fail"),
);

// 拖了个没有 md 的文件夹
card.show({
  ...summary,
  ok: [],
  failed: [],
  skipped: [{ name: "项目A", reason: "文件夹里没有 md 文件", kind: "empty" }],
});
check("空文件夹标题明确", document.querySelector(".sdi-card__title").textContent === "文件夹里没有 md 文件");

// 单独拖一张图片
card.show({
  ...summary,
  ok: [],
  failed: [],
  skipped: [{ name: "Pasted image 20261024211413.png", reason: "非 Markdown（.png）", kind: "image" }],
});
check("单独拖图片时标题明确", document.querySelector(".sdi-card__title").textContent === "图片不能单独导入");
check(
  "图片只留一句「怎么办」",
  (document.querySelector(".sdi-card__hint")?.textContent ?? "") === "和 md 放一起、正文里引用即可。",
  document.querySelector(".sdi-card__hint")?.textContent,
);

/* ---------- 收缩态（0.6.5）：结果卡片不该一直占着右下角 ---------- */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mini = () => document.querySelector(".sdi-card__mini");
const full = () => document.querySelector(".sdi-card__full");
const click = (node) => node?.dispatchEvent(new dom.window.Event("click"));

card.show(summary, { collapseMs: 20, undoWindowMs: 60000, onUndo: async () => 0 });
check("刚出来是完整卡片", full().hidden === false && mini().hidden === true);
await wait(40);
check("到点收缩成一行", mini().hidden === false && full().hidden === true);
check("收起来后不占整块宽度", document.querySelector(".sdi-card").classList.contains("sdi-card--mini"));
check(
  "小条写清结果",
  mini().querySelector(".sdi-card__mini-text").textContent === "成功 2 · 跳过 2 · 失败 1",
  mini().querySelector(".sdi-card__mini-text").textContent,
);
check("有失败时带红点", Boolean(mini().querySelector(".sdi-card__mini-dot.is-bad")));
check(
  "小条上有撤销倒计时",
  (mini().querySelector(".sdi-card__mini-undo")?.textContent ?? "").startsWith("撤销 "),
  mini().querySelector(".sdi-card__mini-undo")?.textContent,
);

click(mini().querySelector(".sdi-card__mini-main"));
check("点小条展开回完整卡片", full().hidden === false && mini().hidden === true);
await wait(40);
check("展开后到点还会再收起来", mini().hidden === false);

click(mini().querySelector(".sdi-card__mini-close"));
check("小条上的 × 能关掉", document.querySelector(".sdi-card") === null);

// 覆盖 / 追加不可撤销，但「没待办」不等于「没内容」：卡片必须照常出现
card.show(
  { ...summary, ok: [{ ...summary.ok[0], mode: "overwrite" }], failed: [], skipped: [] },
  { collapseMs: 20, onUndo: async () => 0 },
);
check("覆盖时卡片照常出现", document.querySelector(".sdi-card") !== null && full().hidden === false);
await wait(30);
check("覆盖后收缩成小条，而不是直接消失", document.querySelector(".sdi-card--mini") !== null);
card.destroy();

// 干净结果（无失败）+ 没有撤销窗口：先收缩，再待一会儿才退场（不能一收缩就没了）
card.show({ ...summary, failed: [], skipped: [] }, { collapseMs: 20 });
await wait(30);
check("没有待办时也先收缩成小条", document.querySelector(".sdi-card--mini") !== null);
await wait(80);
check("小条待一会儿再退场", document.querySelector(".sdi-card") === null);

// 有失败但没有撤销窗口：小条留着，人得知道有东西没进去
card.show({ ...summary, ok: [], skipped: [] }, { collapseMs: 20 });
await wait(40);
check("只剩失败项时小条保留", mini()?.hidden === false);
check("没有撤销时不显示倒计时", mini().querySelector(".sdi-card__mini-undo") === null);

// 撤销窗口已经过期 + 无失败：小条也没有动作，但同样要先让人看见结果
card.show({ ...summary, failed: [] }, { collapseMs: 20, undoWindowMs: 0, onUndo: async () => 0 });
await wait(30);
check("撤销过期后小条还在（结果要让人看见）", document.querySelector(".sdi-card--mini") !== null);
await wait(80);
check("看过之后再退场，不留死按钮小条", document.querySelector(".sdi-card") === null);

card.destroy();
check("destroy 清干净", document.querySelector(".sdi-card") === null);

/* ---------- 零结果卡片（0.7.1）：不收缩，到点直接消失 ---------- */

// 冲突时全选「跳过」：文件类型没问题，别说成「格式不支持」
card.show(
  {
    ...summary,
    ok: [],
    failed: [],
    skipped: [{ name: "周报.md", reason: "同名，已跳过", kind: "other", code: "same-name" }],
  },
  { collapseMs: 20, nothingMs: 60 },
);
check("全跳过时标题是「已全部跳过」", document.querySelector(".sdi-card__title").textContent === "已全部跳过");
check(
  "全跳过时不提「扩展名不支持」",
  !(document.querySelector(".sdi-card__hint")?.textContent ?? "").includes("扩展名"),
  document.querySelector(".sdi-card__hint")?.textContent,
);
await wait(30);
check("零结果卡片不收缩成小条", document.querySelector(".sdi-card--mini") === null);
check("零结果卡片这会儿还在（留时间读提示）", document.querySelector(".sdi-card") !== null);
await wait(50);
check("零结果卡片到点直接消失", document.querySelector(".sdi-card") === null);

// 点「取消导入」（冲突卡片那次，压根没开始导）：没有小条这一站
card.show({ ...summary, ok: [], failed: [], skipped: [], cancelled: true }, { collapseMs: 20, nothingMs: 60 });
await wait(30);
check(
  "取消导入不收缩",
  document.querySelector(".sdi-card--mini") === null && document.querySelector(".sdi-card") !== null,
);
await wait(50);
check("取消导入到点消失", document.querySelector(".sdi-card") === null);

// 导入中途取消（已回滚）：有撤销结果要看，照常收缩成小条
card.show(
  {
    ...summary,
    ok: [],
    failed: [],
    skipped: [],
    cancelled: true,
    rolledBack: { removed: 3, restored: 1, failed: 0, unrestored: 0 },
  },
  { collapseMs: 20, nothingMs: 60 },
);
await wait(40);
check("取消回滚后收缩成小条", document.querySelector(".sdi-card--mini") !== null);
check(
  "小条上写「已撤销」而不是「成功 0」",
  (document.querySelector(".sdi-card__mini-text")?.textContent ?? "") === "已撤销",
  document.querySelector(".sdi-card__mini-text")?.textContent,
);
await wait(60);
check("取消回滚后没有待办，小条自己退场", document.querySelector(".sdi-card") === null);

// 回归：零结果卡片的计时是「退场计时」，不能被 hover 取消，否则鼠标停着就永远不走
const pointerEnter = (node) => node.dispatchEvent(new dom.window.Event("pointerenter"));
const pointerLeave = (node) => node.dispatchEvent(new dom.window.Event("pointerleave"));

card.show(
  {
    ...summary,
    ok: [],
    failed: [],
    skipped: [{ name: "a.png", reason: "非 Markdown（.png）", kind: "image" }],
  },
  { collapseMs: 20, nothingMs: 60 },
);
pointerEnter(document.querySelector(".sdi-card"));
await wait(90);
check("鼠标停在零结果卡片上也会到点消失", document.querySelector(".sdi-card") === null);

// 反过来：普通结果卡片的 hover 暂停要保住（人在看就别收）
card.show(summary, { collapseMs: 40, undoWindowMs: 60000, onUndo: async () => 0 });
pointerEnter(document.querySelector(".sdi-card"));
await wait(80);
check("普通卡片 hover 时不收缩", document.querySelector(".sdi-card--mini") === null);
pointerLeave(document.querySelector(".sdi-card"));
await wait(60);
check("移开鼠标后照常收缩", document.querySelector(".sdi-card--mini") !== null);
card.destroy();

/* ---------- 点页面别处就收缩（0.7.1） ---------- */
// 捕获阶段监听 document 的 pointerdown，卡片外人一动手就让开
const pointerDown = (node) => {
  node.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
};

card.show(summary, { collapseMs: 0, undoWindowMs: 60000, onUndo: async () => 0 });
check("展开态就位", full().hidden === false && mini().hidden === true);
pointerDown(document.querySelector(".sdi-card__title"));
check("点卡片内部不收缩", document.querySelector(".sdi-card--mini") === null);
pointerDown(document.body);
check("点页面别处收缩成小条", document.querySelector(".sdi-card--mini") !== null);

// 无待办（覆盖、没快照）：点外面直接收掉，不用再留一条小条
card.show(
  { ...summary, ok: [{ ...summary.ok[0], mode: "overwrite" }], failed: [], skipped: [] },
  { collapseMs: 0, onUndo: async () => 0 },
);
pointerDown(document.body);
check("没事可做时点外面直接收掉", document.querySelector(".sdi-card") === null);

// 确认态被「点外面」打断后要复位，否则展开后手一快点一下就真删了
card.show(summary, { collapseMs: 0, undoWindowMs: 60000, onUndo: async () => "已删除 2 篇" });
const confirmBtn = document.querySelector('[data-act="undo"]');
click(confirmBtn);
check("第一次点进入确认态", confirmBtn.textContent.startsWith("确认删除"), confirmBtn.textContent);
pointerDown(document.body);
check("点外面把卡片收起", document.querySelector(".sdi-card--mini") !== null);
click(mini().querySelector(".sdi-card__mini-main"));
check(
  "展开后确认态已复位",
  confirmBtn.textContent.startsWith("撤销本次导入"),
  confirmBtn.textContent,
);
/* ---------- 失败项重试 ---------- */
let retries = 0;
card.show(
  {
    ...summary,
    failed: [
      { name: "坏文件.md", reason: "无读取权限（可能被其他程序占用）", retryable: true },
      { name: "巨大.md", reason: "文件超过 20 MB，已跳过", retryable: false },
    ],
  },
  {
    collapseMs: 0,
    onRetry: async () => {
      retries += 1;
    },
  },
);

const retryBtn = document.querySelector('[data-act="retry"]');
check("能重试的失败才给按钮", Boolean(retryBtn));
check("按钮只数可重试的篇数", retryBtn?.textContent === "重试这 1 篇", retryBtn?.textContent);
click(retryBtn);
await new Promise((resolve) => setTimeout(resolve, 30));
check("点了会重跑一次", retries === 1);
check(
  "重试期间按钮锁住",
  retryBtn.disabled === true && retryBtn.textContent === "正在重试…",
  retryBtn.textContent,
);

// 全都不可重试（比如都超了大小上限）：不给按钮，省得点了白点
card.show(
  { ...summary, failed: [{ name: "巨大.md", reason: "文件超过 20 MB，已跳过", retryable: false }] },
  { collapseMs: 0, onRetry: async () => {} },
);
check("全都不可重试时不出现按钮", document.querySelector('[data-act="retry"]') === null);

// 没接回调时也不出现（比如重试批次里又失败，但上层没接）
card.show(
  { ...summary, failed: [{ name: "坏文件.md", reason: "读不出来", retryable: true }] },
  { collapseMs: 0 },
);
check("没接重试回调时不出现按钮", document.querySelector('[data-act="retry"]') === null);

card.destroy();

// 顺手确认样式文件里两种状态都有定义（避免卡片出来是裸的）
const css = readFileSync("index.css", "utf-8");
check("样式含卡片基础类", css.includes(".sdi-card {"));
check("样式含禁用态", css.includes(".sdi-card__btn[disabled]"));

console.log(`\n${passed} 项通过${failures.length ? `，${failures.length} 项失败` : ""}`);
if (failures.length) {
  console.log("\n失败明细：");
  for (const item of failures) {
    console.log(`  ✗ ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("结果卡片：全部通过");
}
