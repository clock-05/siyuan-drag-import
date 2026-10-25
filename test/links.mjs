/**
 * 行内链接扫描器单测（scanLinks）。纯函数，不碰内核也不碰文件。
 * 这里锁的是「哪些写法必须被认成链接」，改扫描器时先看这组用例。
 */

import esbuild from "esbuild";
import { rmSync } from "node:fs";

const BUILD = "test/.build";
rmSync(`${BUILD}/import/scanLinks.mjs`, { force: true });
await esbuild.build({
  entryPoints: ["src/import/scanLinks.ts"],
  bundle: true,
  format: "esm",
  outdir: BUILD,
  outbase: "src",
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});

const { scanLinks, fencedRanges, codeRanges, inCode } = await import(
  `../${BUILD}/import/scanLinks.mjs?t=${Date.now()}`,
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

/** 只关心第一个命中的形状，省得每条都写一遍 */
const one = (markdown) => {
  const list = scanLinks(markdown);
  return list.length === 1 ? list[0] : null;
};

/* ---------- A.1 表里复现过的失败形状 ---------- */
{
  const m = one("[规格书](files/讲义.pdf)");
  check("裸链接", m?.ref === "files/讲义.pdf" && m?.kind === "link", JSON.stringify(m));
}
{
  const m = one("详见[规格书](files/讲义.pdf)");
  check("前面有别的字", m?.ref === "files/讲义.pdf" && m?.start === 2, JSON.stringify(m));
}
{
  const m = one("**重要**：[规格书](files/讲义.pdf)");
  check("加粗后的链接", m?.ref === "files/讲义.pdf", JSON.stringify(m));
}
{
  const m = one("- [规格书](files/讲义.pdf)");
  check("列表项里的链接", m?.ref === "files/讲义.pdf", JSON.stringify(m));
}
{
  const m = one("> [规格书](files/讲义.pdf)");
  check("引用块里的链接", m?.ref === "files/讲义.pdf", JSON.stringify(m));
}
{
  const m = one("| 列 |\n|---|\n| [规格书](files/讲义.pdf) |");
  check("表格里的链接", m?.ref === "files/讲义.pdf", JSON.stringify(m));
}
{
  const m = one("[规格书[2024]](files/讲义.pdf)");
  check("链接文字里有方括号", m?.text === "规格书[2024]" && m?.ref === "files/讲义.pdf", JSON.stringify(m));
}
{
  const m = one("[规格书](files/讲义(1).pdf)");
  check("路径里有圆括号", m?.ref === "files/讲义(1).pdf", JSON.stringify(m));
}
{
  const m = one("[规格书](files/讲义 2024.pdf)");
  check("路径里有空格", m?.ref === "files/讲义 2024.pdf", JSON.stringify(m));
}
{
  const m = one("[规格书](<files/讲义 2024.pdf>)");
  check("尖括号包裹 + 空格", m?.ref === "files/讲义 2024.pdf", JSON.stringify(m));
}
{
  const m = one("下载![规格书](files/讲义.pdf)");
  check("感叹号紧贴的是图片语法", m?.kind === "image" && m?.start === 2, JSON.stringify(m));
}
{
  // Zotero 复制出来的文献名就长这样
  const m = one("[\\[Zwonek 2012\\] GEOMETRIC.pdf](files/a.pdf)");
  check("转义方括号的文字原样保留", m?.text === "\\[Zwonek 2012\\] GEOMETRIC.pdf", JSON.stringify(m));
}

/* ---------- 标题 ---------- */
{
  const m = one('[文字](a.pdf "标题")');
  check("双引号标题", m?.ref === "a.pdf" && m?.title === ' "标题"', JSON.stringify(m));
}
{
  const m = one("[文字](a.pdf '标题')");
  check("单引号标题", m?.ref === "a.pdf" && m?.title === " '标题'", JSON.stringify(m));
}
{
  const m = one("[文字](a.pdf (标题))");
  check("括号标题", m?.ref === "a.pdf" && m?.title === " (标题)", JSON.stringify(m));
}
{
  // 括号是路径的一部分，不是标题
  const m = one("[文字](files/a (1).pdf)");
  check("空格+圆括号是路径不是标题", m?.ref === "files/a (1).pdf" && m?.title === "", JSON.stringify(m));
}
{
  const m = one('[文字](<files/a b.pdf> "标题")');
  check("尖括号配标题", m?.ref === "files/a b.pdf" && m?.title === ' "标题"', JSON.stringify(m));
}

/* ---------- 相邻、多个 ---------- */
{
  const list = scanLinks("![图](a.png)[pdf](b.pdf)");
  check("图片紧贴链接能分开", list.length === 2 && list[0].kind === "image" && list[1].kind === "link", JSON.stringify(list));
  check("两个的起点各自正确", list[0]?.start === 0 && list[1]?.start === 11, JSON.stringify(list));
}
{
  const list = scanLinks("[a](1.pdf) 和 [b](<2 3.pdf>) 和 ![c](4.png)");
  check("一行多个链接", list.length === 3 && list.map((m) => m.ref).join("|") === "1.pdf|2 3.pdf|4.png", JSON.stringify(list));
}

/* ---------- 不该命中的 ---------- */
{
  const list = scanLinks("```\n[x](a.pdf)\n```");
  check("围栏代码里的链接不动", list.length === 0, JSON.stringify(list));
  check("围栏区间能算出来", fencedRanges("```\n[x](a.pdf)\n```").length === 1);
}
{
  const list = scanLinks("~~~md\n[x](a.pdf)\n~~~");
  check("波浪号围栏也不动", list.length === 0, JSON.stringify(list));
}
{
  const list = scanLinks("行内 `[x](a.pdf)` 代码");
  check("行内代码里的链接不动", list.length === 0, JSON.stringify(list));
}
{
  const list = scanLinks("\\[x](a.pdf)");
  check("被转义的方括号不算链接", list.length === 0, JSON.stringify(list));
}
{
  const list = scanLinks("[只有文字] 和 [x] 和 **粗体**");
  check("没有 ( 的方括号不算链接", list.length === 0, JSON.stringify(list));
}
{
  const list = scanLinks("[x](a.pdf");
  check("没有收尾括号不算链接", list.length === 0, JSON.stringify(list));
}
{
  const list = scanLinks("[[另一篇笔记]]");
  check("Obsidian 双链不误判", list.length === 0, JSON.stringify(list));
}
{
  const list = scanLinks("![[a.png]]");
  check("Obsidian 嵌入不误判", list.length === 0, JSON.stringify(list));
}
{
  const list = scanLinks("![[文件 (1).png]]");
  check("嵌入文件名带圆括号也不误判", list.length === 0, JSON.stringify(list));
}
{
  const list = scanLinks("[a](1.pdf) 和 ");
  check("末尾多余文本不影响", list.length === 1 && list[0].ref === "1.pdf");
}

/* ---------- 偏移量：切片必须能还原原文 ---------- */
{
  const md = "前 ![a](1.png) 中 [b](2.pdf) 后";
  const list = scanLinks(md);
  check("切片还原第一段", md.slice(list[0].start, list[0].end) === "![a](1.png)", md.slice(list[0].start, list[0].end));
  check("切片还原第二段", md.slice(list[1].start, list[1].end) === "[b](2.pdf)", md.slice(list[1].start, list[1].end));
}
{
  const md = "😀[a](1.pdf)";
  const list = scanLinks(md);
  check("emoji 后的偏移正确", md.slice(list[0].start, list[0].end) === "[a](1.pdf)", md.slice(list[0].start, list[0].end));
}

/* ---------- 转义 ---------- */
{
  const m = one("[a](files/a\\(1\\).pdf)");
  check("地址里的转义括号解开", m?.ref === "files/a(1).pdf", JSON.stringify(m));
}
{
  // Windows 路径里的反斜杠不能被当成转义吃掉
  const m = one("[a](C:\\Users\\x\\a.pdf)");
  check("Windows 路径的反斜杠保留", m?.ref === "C:\\Users\\x\\a.pdf", JSON.stringify(m));
}

/* ---------- 代码区间：围栏 + 行内，给 assets 的嵌入扫描用 ---------- */
{
  const text = "a `x` b\n```\n![[a.png]]\n```\n尾";
  const ranges = codeRanges(text);
  check("围栏与行内各一段", ranges.length === 2, JSON.stringify(ranges));
  check("行内代码被覆盖", inCode(ranges, 3) === true);
  check("围栏内容被覆盖", inCode(ranges, text.indexOf("![[") ) === true);
  check("正文没被覆盖", inCode(ranges, 0) === false);
}

console.log(`\n${passed} 项通过${failures.length ? `，${failures.length} 项失败` : ""}`);
if (failures.length) {
  console.log("\n失败明细：");
  for (const item of failures) {
    console.log(`  ✗ ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("行内链接扫描：全部通过");
}
