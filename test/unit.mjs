/**
 * 纯逻辑单测：命名 + md 解析。
 * 这两块最容易出「看起来对、实际入库错」的问题，用脚本盯着比手拖文件快。
 * 直接跑：npm test
 */

import esbuild from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

process.env.NODE_ENV = "test";

const BUILD = "test/.build";
rmSync(BUILD, { recursive: true, force: true });
await esbuild.build({
  entryPoints: [
    "src/import/naming.ts",
    "src/import/markdown.ts",
    "src/labels.ts",
    "src/settings.ts",
    "src/util/mapLimit.ts",
    "src/util/serialQueue.ts",
    "src/drop/selectors.ts",
    "src/i18n/index.ts",
  ],
  bundle: true,
  format: "esm",
  outdir: BUILD,
  outbase: "src",
  outExtension: { ".js": ".mjs" },
  // settings.ts 里 `import { Setting } from "siyuan"`，单测用桩替换掉
  alias: { siyuan: "./test/siyuan-stub.mjs" },
  logLevel: "silent",
});

// 设置面板要建真实控件，得有个 DOM
const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;
// selectors.ts 里用全局 getComputedStyle，Node 里没有
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const naming = await import(`../${BUILD}/import/naming.mjs?t=${Date.now()}`);
const markdown = await import(`../${BUILD}/import/markdown.mjs?t=${Date.now()}`);
const labels = await import(`../${BUILD}/labels.mjs?t=${Date.now()}`);
const settings = await import(`../${BUILD}/settings.mjs?t=${Date.now()}`);
const { mapLimit } = await import(`../${BUILD}/util/mapLimit.mjs?t=${Date.now()}`);
const { SerialQueue } = await import(`../${BUILD}/util/serialQueue.mjs?t=${Date.now()}`);
const selectors = await import(`../${BUILD}/drop/selectors.mjs?t=${Date.now()}`);
const i18n = await import(`../${BUILD}/i18n/index.mjs?t=${Date.now()}`);

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  if (actual === expected) {
    passed += 1;
    return;
  }
  failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
}

function checkTrue(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail ? `\n    ${detail}` : ""}`);
}

/* ---------- 命名 ---------- */
check("去扩展名", naming.cleanName("笔记.md"), "笔记");
check("多点文件名只去最后一段", naming.cleanName("v1.2 计划.md"), "v1.2 计划");
check("倒引号/斜杠等非法字符", naming.cleanName('a<b>c:d"e/f\\g|h?i*j.md'), "a_b_c_d_e_f_g_h_i_j");
check("路径上跳段被剔除", naming.cleanName("a/../b.md"), "a_b");
check("纯 .. 兜底", naming.cleanName("...md"), "未命名");
check("结尾的点被去掉", naming.cleanName("草稿...md"), "草稿");
check("空白标题兜底", naming.cleanName("   .md"), "未命名");
check("Windows 保留名加前缀", naming.cleanName("CON.md"), "_CON");
check("NFC 归一化（NFD 输入）", naming.cleanName("e\u0301tude.md"), "étude");

const longName = naming.cleanName(`${"很长的标题".repeat(60)}.md`);
checkTrue("超长标题截断到 121 字符", longName.length === 121 && longName.endsWith("…"), `长度 ${longName.length}`);

check("重名后缀", naming.withSuffix("笔记", 2), "笔记 (2)");
check("重名后缀第三次", naming.withSuffix("笔记", 3), "笔记 (3)");
checkTrue(
  "加后缀后仍不超长",
  naming.withSuffix(`${"长".repeat(121)}`, 12).length <= 121,
  `长度 ${naming.withSuffix(`${"长".repeat(121)}`, 12).length}`,
);
check("判重口径：大小写 + 空格", naming.normalizeKey("  ReadMe "), "readme");

/* ---------- md 解析 ---------- */
const enc = new TextEncoder();
const GBK_ZHONGWEN = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]); // "中文" 的 GBK 编码

check(
  "UTF-8 直读",
  markdown.parseMarkdown(enc.encode("你好").buffer, "a").markdown,
  "你好",
);
checkTrue(
  "UTF-8 BOM 被识别",
  markdown.parseMarkdown(
    Uint8Array.from([0xef, 0xbb, 0xbf, ...enc.encode("带 BOM")]).buffer,
    "a",
  ).encoding === "utf-8-bom",
);
check(
  "GBK 兜底不乱码",
  markdown.parseMarkdown(GBK_ZHONGWEN.buffer, "a").markdown,
  "中文",
);

const withFm = "---\ntitle: 标题\ntags: [a]\n---\n\n正文第一段";
const fm = markdown.parseMarkdown(enc.encode(withFm).buffer, "标题");
check("frontmatter 被剥离", fm.markdown, "正文第一段");
checkTrue("frontmatter 有标记", fm.removedFrontmatter);

const h1 = markdown.parseMarkdown(enc.encode("# 笔记\n\n正文").buffer, "笔记");
check("重复的 H1 被去掉", h1.markdown, "正文");
checkTrue("H1 有标记", h1.removedH1);

const keepH1 = markdown.parseMarkdown(enc.encode("# 完全不同的标题\n\n正文").buffer, "笔记");
check("不相似的 H1 保留", keepH1.markdown, "# 完全不同的标题\n\n正文");

const midRule = markdown.parseMarkdown(enc.encode("第一段\n\n---\n\n第二段").buffer, "笔记");
check("正文中间的分隔线不动", midRule.markdown, "第一段\n\n---\n\n第二段");

/* ---------- 附件后缀：卡片统一说「附件（.png、.pdf）」 ---------- */
check("单个后缀", labels.summarizeExts({ ".pdf": 3 }), "（.pdf）");
check("多个后缀按数量降序", labels.summarizeExts({ ".png": 1, ".pdf": 3 }), "（.pdf、.png）");
check("数量相同按字母序", labels.summarizeExts({ ".png": 1, ".jpg": 1 }), "（.jpg、.png）");
check(
  "超过三种就省略",
  labels.summarizeExts({ ".pdf": 4, ".docx": 3, ".xlsx": 2, ".zip": 1 }),
  "（.pdf、.docx、.xlsx 等）",
);
check("没有附件时给空串", labels.summarizeExts({}), "");
check("没有扩展名时说无后缀", labels.summarizeExts({ "": 1 }), "（无后缀）");
check("零计数的类型不列", labels.summarizeExts({ ".pdf": 0, ".png": 1 }), "（.png）");

/* ---------- 设置归一化 / 撤销窗口单位迁移 ---------- */
const norm = settings.normalizeSettings;
check("默认撤销窗口 30 秒", norm({}).undoWindowSeconds, 30);
check("空配置用默认值", norm(null).undoWindowSeconds, 30);
// 0.6.x 存的是分钟：5 必须变成 300，不能读成 5 秒
check("旧配置 5 分钟 → 300 秒", norm({ undoWindowMinutes: 5 }).undoWindowSeconds, 300);
check("旧配置 1 分钟 → 60 秒", norm({ undoWindowMinutes: 1 }).undoWindowSeconds, 60);
check("旧配置 10 分钟被上限截断", norm({ undoWindowMinutes: 10 }).undoWindowSeconds, 300);
check("新键优先，旧键忽略", norm({ undoWindowMinutes: 5, undoWindowSeconds: 20 }).undoWindowSeconds, 20);
check("太小夹到 10 秒", norm({ undoWindowSeconds: 3 }).undoWindowSeconds, 10);
check("太大夹到 300 秒", norm({ undoWindowSeconds: 9999 }).undoWindowSeconds, 300);
check("坏值退回下限", norm({ undoWindowSeconds: "abc" }).undoWindowSeconds, 10);
check("迁移后不残留旧键", "undoWindowMinutes" in norm({ undoWindowMinutes: 5 }), false);
check("冲突默认值非法时回退", norm({ conflictDefault: "乱写" }).conflictDefault, "suffix");
check("stripFrontmatter 默认开", norm({}).stripFrontmatter, true);
check("stripFrontmatter 关掉后保持关", norm({ stripFrontmatter: false }).stripFrontmatter, false);
check("skipRootFolder 默认关（保持旧行为）", norm({}).skipRootFolder, false);
check("skipRootFolder 存 true 才开", norm({ skipRootFolder: true }).skipRootFolder, true);
check("skipRootFolder 非布尔值不误开", norm({ skipRootFolder: "yes" }).skipRootFolder, false);

/* ---------- 设置面板：恢复默认 ---------- */
// 桩 Setting 不会自己建控件，这里手动把每个 item 的元素建出来并挂进 DOM
const live = {
  ...settings.DEFAULT_SETTINGS,
  uploadImages: false,
  maxFileMB: 50,
  undoWindowSeconds: 120,
  conflictDefault: "overwrite",
};
let saves = 0;
const panel = settings.createSettingPanel(live, () => {
  saves += 1;
});
const nodes = panel.items.map((item) => item.createActionElement());
const box = document.createElement("div");
for (const node of nodes) {
  box.append(node);
}
document.body.append(box);

check("设置项共 9 项", panel.items.length, 9);
check("输入框初始显示 50", nodes[6].value, "50");
nodes[8].dispatchEvent(new dom.window.Event("click"));
check("恢复默认：大小上限回到 20", live.maxFileMB, 20);
check("恢复默认：撤销窗口回到 30 秒", live.undoWindowSeconds, 30);
check("恢复默认：冲突策略回到加后缀", live.conflictDefault, "suffix");
check("恢复默认：开关回到开", live.uploadImages, true);
check("恢复默认会保存一次", saves, 1);
// 控件本身也要跟着变，不然用户看到的是旧值
check("输入框同步成 20", nodes[6].value, "20");
check("下拉框同步成 suffix", nodes[0].value, "suffix");
check("开关同步成选中", nodes[1].checked, true);

/* ---------- mapLimit：查同名的并发器 ---------- */
{
  const items = Array.from({ length: 20 }, (_, index) => index);
  let active = 0;
  let peak = 0;
  const out = await mapLimit(items, 4, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    active -= 1;
    return value * 2;
  });
  check("结果顺序与输入一致", out.join(","), items.map((value) => value * 2).join(","));
  check("并发峰值为 4", peak, 4);
  check("空数组返回空", (await mapLimit([], 4, async (value) => value)).length, 0);
  check(
    "limit 大于总数也能跑完",
    (await mapLimit([1, 2], 99, async (value) => value + 1)).join(","),
    "2,3",
  );
  check(
    "单个任务抛错会冒出来（不能静默吞）",
    await mapLimit([1], 4, async () => {
      throw new Error("boom");
    }).then(
      () => "no-throw",
      (error) => error.message,
    ),
    "boom",
  );
}

/* ---------- 边缘滚动：找文档树里真正能滚的那一层 ---------- */
{
  // jsdom 没有布局，尺寸得自己塞
  const size = (el, scroll, client) => {
    Object.defineProperty(el, "scrollHeight", { value: scroll, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: client, configurable: true });
  };
  const makeTree = () => {
    const panel = document.createElement("div");
    panel.className = "sy__file";
    const items = document.createElement("div");
    items.className = "file-tree__items";
    panel.append(items);
    document.body.append(panel);
    return { panel, items };
  };

  const shortTree = makeTree();
  size(shortTree.items, 100, 100);
  size(shortTree.panel, 100, 100);
  check("内容没溢出时不给滚动容器", selectors.scrollHostOf(shortTree.panel), null);

  const scrollItems = makeTree();
  scrollItems.items.style.overflowY = "auto";
  size(scrollItems.items, 800, 200);
  size(scrollItems.panel, 800, 200);
  check("条目容器自己可滚就滚它", selectors.scrollHostOf(scrollItems.panel), scrollItems.items);

  const scrollPanel = makeTree();
  scrollPanel.panel.style.overflowY = "auto";
  size(scrollPanel.items, 800, 200);
  size(scrollPanel.panel, 800, 200);
  check("条目容器不可滚时往上一层找", selectors.scrollHostOf(scrollPanel.panel), scrollPanel.panel);

  const hidden = makeTree();
  hidden.items.style.overflowY = "hidden";
  size(hidden.items, 800, 200);
  size(hidden.panel, 800, 200);
  check("overflow:hidden 的不算滚动容器", selectors.scrollHostOf(hidden.panel), null);
}

/* ---------- 中英双语：两份字典必须结构一致 ---------- */
{
  // 把嵌套结构摊平成 "路径:类型"，两边逐项比对；漏翻一条就会在这里暴露
  const shape = (value, prefix = "") => {
    const out = [];
    for (const [key, item] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof item === "function") {
        out.push(`${path}:fn${item.length}`);
      } else if (item && typeof item === "object") {
        out.push(...shape(item, path));
      } else {
        out.push(`${path}:str`);
      }
    }
    return out.sort();
  };
  check("中英字典结构一致", shape(i18n.zh).join("|"), shape(i18n.en).join("|"));

  i18n.setLanguage("zh_CN");
  check("默认走中文", i18n.m().card.titleDone, "导入完成");
  check("中文带参数文案", i18n.m().card.okCount(3), "成功 3");

  i18n.setLanguage("en_US");
  check("切英文后标题", i18n.m().card.titleDone, "Import complete");
  check("英文带参数文案", i18n.m().card.okCount(3), "3 imported");
  check("英文单复数（附件）", i18n.m().asset.uploaded(1, " (.pdf)"), "1 attachment uploaded (.pdf)");
  check("英文单复数（多件）", i18n.m().asset.uploaded(2, " (.pdf)"), "2 attachments uploaded (.pdf)");

  globalThis.siyuan = { config: { appearance: { lang: "en_US" } } };
  check("语言从思源设置读", i18n.detectLanguage(), "en_US");
  delete globalThis.siyuan;
  check("拿不到思源配置时按中文", i18n.detectLanguage(), "zh_CN");

  i18n.setLanguage();
  check("传空字符串回中文", i18n.m().card.titleDone, "导入完成");
}

/* ---------- 串行队列：导入与重试不能并行 ---------- */
{
  const queue = new SerialQueue();
  const log = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = queue.push(async () => {
    log.push("a-start");
    await gate;
    log.push("a-end");
  });
  const second = queue.push(async () => {
    log.push("b-start");
    log.push("b-end");
  });
  checkTrue("排队时 busy 为真", queue.busy === true);
  check("第二个任务不会抢跑", log.join(","), "a-start");
  release();
  await Promise.all([first, second]);
  check("按入队顺序串行跑完", log.join(","), "a-start,a-end,b-start,b-end");
  checkTrue("跑完不再 busy", queue.busy === false);
}

{
  const queue = new SerialQueue();
  const reason = await queue.push(async () => {
    throw new Error("boom");
  }).then(
    () => "no-throw",
    (error) => error.message,
  );
  check("任务抛错会传给调用方", reason, "boom");
  const after = [];
  await queue.push(async () => {
    after.push(1);
  });
  check("一个任务抛错不影响后面的", after.length, 1);
}

{
  // 卸载：排队的直接丢掉（Promise 也要结算，否则调用方永远 await）
  const queue = new SerialQueue();
  const log = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const running = queue.push(async () => {
    log.push("a");
    await gate;
    log.push("a-end");
  });
  const queued = queue.push(async () => {
    log.push("b");
  });
  queue.stop();
  await queued;
  check("stop 丢掉还没开始的任务", log.join(","), "a");
  release();
  await running;
  check("在跑的那个能正常收尾", log.join(","), "a,a-end");

  const late = [];
  await queue.push(async () => {
    late.push(1);
  });
  check("stop 之后 push 直接返回、不再执行", late.length, 0);
}

/* ---------- 输出 ---------- */
console.log(`\n${passed} 项通过${failures.length ? `，${failures.length} 项失败` : ""}`);
if (failures.length) {
  console.log("\n失败明细：");
  for (const item of failures) {
    console.log(`  ✗ ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("命名与 md 解析：全部通过");
}
