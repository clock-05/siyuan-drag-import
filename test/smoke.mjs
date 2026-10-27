/**
 * 冒烟测试：在 jsdom 里把打包产物当成真的插件加载一遍。
 * 验的是「产物能不能被加载」「监听有没有挂上」「命中判定/视觉/卸载对不对」，
 * 不涉及真实文件拖拽（那个只能人工验）。
 */

import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const Module = require("node:module");

const workspace = mkdtempSync(join(tmpdir(), "sdi-"));
const dom = new JSDOM(
  `<!doctype html><html><body>
    <div class="sy__file">
      <div class="file-tree__items">
        <ul data-url="nb-1">
          <li class="b3-list-item" data-node-id="nb-1" data-type="navigation-root"><span class="b3-list-item__text">知识类</span></li>
          <li class="b3-list-item" data-node-id="doc-1" data-type="navigation-file"><span class="b3-list-item__text">读书笔记</span></li>
        </ul>
      </div>
    </div>
    <div class="protyle"><div class="protyle-content">正文</div></div>
  </body></html>`,
  { url: "http://127.0.0.1:6806/" },
);

const { window } = dom;
global.window = window;
global.document = window.document;
global.Node = window.Node;
global.Element = window.Element;
global.HTMLElement = window.HTMLElement;
global.File = window.File;
// jsdom 的 addEventListener 只认自己 realm 里的 AbortSignal，必须把构造器换掉
global.AbortController = window.AbortController;
global.AbortSignal = window.AbortSignal;
window.require = require;
window.siyuan = { config: { system: { workspaceDir: workspace } } };

const messages = [];
let topBarCalls = 0;
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === "siyuan") {
    return {
      Plugin: class Plugin {
        constructor(options) {
          this.options = options;
          this.name = "siyuan-drag-import";
          this.displayName = "拖拽导入";
          this.saved = [];
        }
        async loadData() {
          return {};
        }
        async saveData(key, value) {
          this.saved.push({ key, value });
        }
        addTopBar() {
          topBarCalls += 1;
          return document.createElement("div");
        }
        // 与思源基类一致：只有 this.setting 存在才开
        openSetting() {
          if (!this.setting) return false;
          this.setting.open(this.displayName || this.name);
          return true;
        }
      },
      Setting: class Setting {
        constructor(options) {
          this.options = options;
          this.items = [];
        }
        addItem(item) {
          this.items.push(item);
          this.lastItem = item;
        }
        open(name) {
          this.openedWith = name;
        }
      },
      showMessage: (message) => messages.push(message),
      openTab: () => {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? `（${detail}）` : ""}`);
  }
};

function dragEvent(type, target, { files = [], x = 0, y = 0 } = {}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: ["Files"], files, items: [], dropEffect: "none" },
  });
  Object.defineProperty(event, "clientX", { value: x });
  Object.defineProperty(event, "clientY", { value: y });
  target.dispatchEvent(event);
  return event;
}

const PluginClass = require("../dist/index.js");
check("产物导出的是插件类", typeof PluginClass === "function");

const plugin = new PluginClass({ name: "siyuan-drag-import", app: { fake: true } });
await plugin.onload();

/* ---------- T0/T1 日志落盘 ---------- */
const logsDir = join(workspace, "data", "storage", "petal", "siyuan-drag-import", "logs");
check("日志目录已创建", existsSync(logsDir), logsDir);
const logFiles = existsSync(logsDir) ? readdirSync(logsDir).filter((f) => f.endsWith(".jsonl")) : [];
check("生成了本次日志文件", logFiles.length === 1, logFiles.join(","));
const logText = logFiles.length ? readFileSync(join(logsDir, logFiles[0]), "utf-8") : "";
check("onload 已落盘", logText.includes('"action":"onload"'));
check("logger 步骤成功", logText.includes("logger: ok"));
check("drop 步骤成功", logText.includes("drop: ok"), logText.slice(-200));
check("settings 步骤成功", logText.includes("settings: ok"), logText.slice(-200));

/* ---------- 设置入口：只留思源插件菜单那一条，不再挂顶栏齿轮 ---------- */
check("不再注册顶栏图标", topBarCalls === 0, `addTopBar 调用了 ${topBarCalls} 次`);
check("设置面板挂在基类 setting 字段上", Boolean(plugin.setting));
check("设置项共 9 条（含恢复默认）", plugin.setting?.items.length === 9, String(plugin.setting?.items.length));
check("openSetting 能打开面板", plugin.openSetting() === true);
check(
  "面板标题用 displayName",
  plugin.setting?.openedWith === "拖拽导入",
  String(plugin.setting?.openedWith),
);

/* ---------- T2 命中与视觉 ---------- */
const panel = document.querySelector(".sy__file");
const docRow = panel.querySelector('[data-node-id="doc-1"]');
const nbRow = panel.querySelector('[data-node-id="nb-1"]');
const editor = document.querySelector(".protyle-content");
const frame = () => document.querySelector(".sdi-frame");
const banner = () => document.querySelector(".sdi-banner__text");

const overDoc = dragEvent("dragover", docRow, { y: 40 });
check("文档行 dragover 被接管（preventDefault）", overDoc.defaultPrevented);
check("出现面板描边层", Boolean(frame()));
check("横幅文字带目标名", (banner()?.textContent ?? "").includes("读书笔记"), banner()?.textContent ?? "");
check("目标行被高亮", docRow.classList.contains("sdi-row"));
check("文档行提示为「子文档」", document.querySelector(".sdi-banner__hint")?.textContent === "子文档");

const overNotebook = dragEvent("dragover", nbRow, { y: 20 });
check("切到笔记本行后高亮转移", nbRow.classList.contains("sdi-row") && !docRow.classList.contains("sdi-row"));
check("笔记本行提示为「根目录」", document.querySelector(".sdi-banner__hint")?.textContent === "根目录");

// 面板空白处：没有命中的行，回落到所在笔记本的根级
const overBlank = dragEvent("dragover", document.querySelector(".file-tree__items"), { y: 80 });
check("空白处也被接管", overBlank.defaultPrevented);
check("空白处回落到笔记本根级", (banner()?.textContent ?? "").includes("知识类"), banner()?.textContent ?? "");
check("空白处不高亮任何行", !docRow.classList.contains("sdi-row") && !nbRow.classList.contains("sdi-row"));

const overEditor = dragEvent("dragover", editor);
check("编辑器区域不接管（不 preventDefault）", !overEditor.defaultPrevented);

const dropped = dragEvent("drop", docRow, { y: 40 });
check("drop 被接管", dropped.defaultPrevented);
check("drop 后描边立即收起", !frame() || !frame().classList.contains("sdi-frame--visible"));
check("drop 后行高亮清掉", !docRow.classList.contains("sdi-row"));

// 上一批没跑完时再拖一次，也必须交出去：排队归 index.ts 管，
// controller 这一层拦掉的话第二批连队列都进不去（0.7.3 的 bug）
const originalHandler = plugin.controller.onDrop;
let drops = 0;
plugin.controller.onDrop = async () => {
  drops += 1;
};
const fakeFile = { name: "a.md" };
dragEvent("drop", docRow, { y: 40, files: [fakeFile] });
dragEvent("drop", docRow, { y: 40, files: [fakeFile] });
check("连续两次 drop 都交给上层（不在这里拦）", drops === 2, String(drops));
plugin.controller.onDrop = originalHandler;

const dropOutside = dragEvent("drop", editor);
check("编辑器里的 drop 完全放行（保持原生插图）", !dropOutside.defaultPrevented);

const dropOnBody = dragEvent("drop", document.body);
check("树和编辑器之外只做兜底 preventDefault", dropOnBody.defaultPrevented);

/* ---------- Esc ---------- */
dragEvent("dragover", docRow, { y: 40 });
const esc = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
document.dispatchEvent(esc);
check("Esc 收起视觉", !frame().classList.contains("sdi-frame--visible"));

/* ---------- onunload ---------- */
plugin.onunload();
check("卸载后覆盖层被移除", !frame());
const afterUnload = dragEvent("dragover", docRow, { y: 40 });
check("卸载后不再接管 dragover", !afterUnload.defaultPrevented);

check("没有误弹提示", messages.length === 0, messages.join("|"));

rmSync(workspace, { recursive: true, force: true });

console.log(`\n${passed} 项通过${failures.length ? `，${failures.length} 项失败` : ""}`);
if (failures.length) {
  console.log("\n失败明细：");
  for (const item of failures) {
    console.log(`  ✗ ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("插件加载与拖拽命中：全部通过");
}
