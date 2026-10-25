/**
 * Obsidian 双链 → 思源块引用：纯函数单测（不碰内核）。
 * 重点不是「能转」，而是「哪些情况宁可不转」——指错地方比不转更糟。
 */

import esbuild from "esbuild";
import { rmSync } from "node:fs";

const BUILD = "test/.build";
rmSync(`${BUILD}/import/wikilinks.mjs`, { force: true });
await esbuild.build({
  entryPoints: ["src/import/wikilinks.ts"],
  bundle: true,
  format: "esm",
  outdir: BUILD,
  outbase: "src",
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});

global.window = { require: () => null };

const { scanWikilinks, applyWikilinks, linkKey } = await import(
  `../${BUILD}/import/wikilinks.mjs?t=${Date.now()}`
);

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? `（${detail}）` : ""}`);
  }
};

const ids = {
  笔记: "20261025000000-aaaaaaa",
  别名目标: "20261025000000-bbbbbbb",
  "目录/子笔记": "20261025000000-ccccccc",
  "notes/deep": "20261025000000-ddddddd",
};
// 和 executor 里的做法一致：按 linkKey 归一化后查表，路径对不上再退回最后一段
const byKey = new Map(Object.entries(ids).map(([name, id]) => [linkKey(name), id]));
const resolve = (target) => {
  const key = linkKey(target);
  return byKey.get(key) ?? byKey.get(key.split("/").pop() ?? "");
};

const convert = (markdown) => {
  const links = scanWikilinks(markdown);
  return applyWikilinks(markdown, links, resolve);
};

/* ---------- 基本转换 ---------- */
{
  const out = convert("见 [[笔记]] 一节");
  check("基本双链转成块引用", out.text === '见 ((20261025000000-aaaaaaa "笔记")) 一节', out.text);
  check("转换计数", out.converted === 1);
}
{
  const out = convert("[[别名目标|显示文字]]");
  check("别名作为引用文字", out.text === '((20261025000000-bbbbbbb "显示文字"))', out.text);
}
{
  const out = convert("[[notes/deep]]");
  check("路径按最后一段兜底解析", out.text.includes("20261025000000-ddddddd"), out.text);
  check("显示文字取最后一段", out.text.includes('"deep"'), out.text);
}
{
  const out = convert("[[笔记.md]] 和 [[笔记]]");
  check("带 .md 也能对上", out.converted === 2, out.text);
}
{
  const out = convert("[[目录/子笔记]]");
  check("完整路径优先", out.text.includes("20261025000000-ccccccc"), out.text);
}

/* ---------- 宁可不转的情况 ---------- */
{
  const out = convert("[[笔记#某个标题]]");
  check("带标题锚点不转（块引用指不到标题）", out.text === "[[笔记#某个标题]]", out.text);
}
{
  const out = convert('[[笔记|带"引号"的别名]]');
  check("别名带引号不转（会破坏块引用结构）", out.text.startsWith("[[笔记|"), out.text);
}
{
  const out = convert("[[不存在的笔记]]");
  check("解析不到就保留原样", out.text === "[[不存在的笔记]]", out.text);
  check("没转就不计数", out.converted === 0);
}
{
  const out = convert("![[图.png]]");
  check("嵌入不动（交给 assets 那套）", out.text === "![[图.png]]", out.text);
}
{
  const fence = "```md\n[[笔记]]\n```";
  const out = convert(fence);
  check("围栏代码里的双链不动", out.text === fence, out.text);
}
{
  const inline = "写法是 `[[笔记]]`";
  const out = convert(inline);
  check("行内代码里的双链不动", out.text === inline, out.text);
}
{
  const out = convert("[[笔记 带 空格]]");
  check("目标带空格但解析不到时保留", out.text === "[[笔记 带 空格]]", out.text);
}

/* ---------- 结构与边界 ---------- */
{
  const out = convert("a [[笔记]] b [[别名目标|二]] c");
  check("一行多个链接都转", out.converted === 2 && out.text.includes('"二"') && out.text.includes('"笔记"'), out.text);
  check("链接外的文字原样保留", out.text.startsWith("a ") && out.text.endsWith(" c"), out.text);
}
{
  const out = convert("[[笔记");
  check("没闭合的方括号不崩", out.text === "[[笔记" && out.converted === 0, out.text);
}
{
  check("linkKey 去 .md、小写、统一斜杠", linkKey(".\\Notes\\A.md") === "notes/a", linkKey(".\\Notes\\A.md"));
}
{
  const links = scanWikilinks("[[笔记]] [[笔记|别名]]");
  check("扫描拿到两条", links.length === 2, JSON.stringify(links));
  check("扫描位置正确", links[0].start === 0 && links[0].end === 6, JSON.stringify(links[0]));
}

console.log(`\n${passed} 项通过${failures.length ? `，${failures.length} 项失败` : ""}`);
if (failures.length) {
  console.log("\n失败明细：");
  for (const item of failures) {
    console.log(`  ✗ ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("双链转换：全部通过");
}
