/**
 * 冲突卡片单测：默认值、逐条选择、一键全部、取消语义、超 5 条折叠。
 * 组件只依赖 DOM，不需要思源。
 */

import esbuild from "esbuild";
import { JSDOM } from "jsdom";

const BUILD = "test/.build";
await esbuild.build({
  entryPoints: ["src/ui/conflict.ts"],
  bundle: true,
  format: "esm",
  outfile: `${BUILD}/conflict.mjs`,
  logLevel: "silent",
});

const { ConflictCard } = await import(`../${BUILD}/conflict.mjs?t=${Date.now()}`);

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

const q = (selector) => document.querySelector(selector);
const click = (el) => el.dispatchEvent(new dom.window.Event("click", { bubbles: true, cancelable: true }));
const rows = () => Array.from(document.querySelectorAll(".sdi-conflict__row"));
const activeOf = (row) => row.querySelector(".sdi-conflict__op.is-active")?.dataset.choice;
const allActive = () => rows().map(activeOf);

const entries = [
  { name: "笔记", hpath: "/笔记" },
  { name: "a", hpath: "/项目A/a" },
  { name: "b", hpath: "/项目A/b" },
];

const card = new ConflictCard();

/* ---------- 默认状态 ---------- */
const first = card.ask(entries, "知识类");
check("卡片已挂到 body", Boolean(q(".sdi-conflict")));
check("标题带冲突数", q(".sdi-card__title").textContent === "有 3 篇同名");
check("显示目标笔记本", q(".sdi-card__counts").textContent.includes("知识类"));
check("逐条列出 3 行", rows().length === 3);
check("默认全选「加后缀」", allActive().every((value) => value === "suffix"), allActive().join(","));
check("覆盖警告默认收起", q(".sdi-conflict__warn").hidden === true);

/* ---------- 逐条改 + 一键全部 ---------- */
click(rows()[0].querySelector('[data-choice="skip"]'));
check("单行改成跳过", activeOf(rows()[0]) === "skip");
check("其它行不受影响", activeOf(rows()[1]) === "suffix");

click(q('[data-all="overwrite"]'));
check("一键全部覆盖", allActive().every((value) => value === "overwrite"), allActive().join(","));
check("出现覆盖警告", q(".sdi-conflict__warn").hidden === false);

click(rows()[1].querySelector('[data-choice="suffix"]'));
check("改回一行后警告仍在", q(".sdi-conflict__warn").hidden === false);

click(q('[data-act="go"]'));
const answer = await first;
check("返回完整决策表", answer instanceof Map && answer.size === 3, String(answer?.size));
check("第一行是覆盖", answer.get("/笔记") === "overwrite", answer.get("/笔记"));
check("第二行是加后缀", answer.get("/项目A/a") === "suffix", answer.get("/项目A/a"));
check("确定后卡片移除", q(".sdi-conflict") === null);

/* ---------- 追加选项与默认值 ---------- */
const appendFirst = card.ask(entries, "知识类", { defaultChoice: "append" });
check("默认策略可选追加", allActive().every((value) => value === "append"), allActive().join(","));
check("每行有四个选项", rows()[0].querySelectorAll(".sdi-conflict__op").length === 4);
check("追加也显示风险提示", q(".sdi-conflict__warn").hidden === false);
click(q('[data-act="cancel"]'));
await appendFirst;

/* ---------- 取消语义 ---------- */
const second = card.ask(entries, "知识类");
click(q('[data-act="cancel"]'));
check("点「取消导入」返回 null", (await second) === null);
check("取消后卡片移除", q(".sdi-conflict") === null);

const third = card.ask(entries, "知识类");
click(q(".sdi-card__close"));
check("右上角关闭也等于取消", (await third) === null);

/* ---------- 只有一条冲突：不给「全部」 ---------- */
const single = card.ask([{ name: "笔记", hpath: "/笔记" }], "知识类");
check("单条时不出现批量按钮", q(".sdi-conflict__bulk") === null);
check("单条标题换成「已存在」", q(".sdi-card__title").textContent === "这篇文档已存在", q(".sdi-card__title").textContent);
check(
  "单条时换一句提示",
  (q(".sdi-card__counts")?.textContent ?? "").includes("选一种处理方式"),
  q(".sdi-card__counts")?.textContent,
);
check("单条仍有四个选项", rows()[0].querySelectorAll(".sdi-conflict__op").length === 4);
click(rows()[0].querySelector('[data-choice="append"]'));
click(q('[data-act="go"]'));
const singleAnswer = await single;
check("单条也能正常提交", singleAnswer.get("/笔记") === "append", JSON.stringify([...singleAnswer]));

/* ---------- 超过 5 条 ---------- */
const many = Array.from({ length: 8 }, (_, index) => ({ name: `n${index}`, hpath: `/n${index}` }));
const fourth = card.ask(many, "知识类");
check("超过 5 条才出现批量按钮", Boolean(q(".sdi-conflict__bulk")));
check("最多列 5 行", rows().length === 5, String(rows().length));
check("提示另有 3 项", (q(".sdi-conflict__more")?.textContent ?? "").includes("3"));
click(q('[data-all="skip"]'));
click(q('[data-act="go"]'));
const answerMany = await fourth;
check("全部按钮作用于全部 8 项", answerMany.size === 8, String(answerMany.size));
check("未列出的项也按跳过错", [...answerMany.values()].every((value) => value === "skip"));

/* ---------- 挂起时被销毁 ---------- */
const fifth = card.ask(entries, "知识类");
card.destroy();
check("销毁时按取消收尾", (await fifth) === null);
check("没有残留 DOM", q(".sdi-conflict") === null);

console.log(`\n${passed} 项通过${failures.length ? `，${failures.length} 项失败` : ""}`);
if (failures.length) {
  console.log("\n失败明细：");
  for (const item of failures) {
    console.log(`  ✗ ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("冲突卡片：全部通过");
}
