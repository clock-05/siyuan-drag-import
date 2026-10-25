/**
 * 资源链接重写单测：不碰内核，reader / uploader 都是假的。
 * 覆盖图片语法、Obsidian 嵌入、普通文件链接（pdf 等）、缺失与失败、批次去重。
 */

import esbuild from "esbuild";
import { rmSync } from "node:fs";

const BUILD = "test/.build";
rmSync(`${BUILD}/import/assets.mjs`, { force: true });
await esbuild.build({
  entryPoints: ["src/import/assets.ts"],
  bundle: true,
  format: "esm",
  outdir: BUILD,
  outbase: "src",
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});

global.window = { require: () => null };

const { rewriteAssets, emptyAssetStats } = await import(`../${BUILD}/import/assets.mjs?t=${Date.now()}`);

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? `（${detail}）` : ""}`);
  }
};

const files = new Map([
  ["img/a.png", { name: "a.png", bytes: new Uint8Array([1, 2, 3]), key: "/abs/img/a.png" }],
  ["img/b 空格.png", { name: "b 空格.png", bytes: new Uint8Array([4]), key: "/abs/img/b 空格.png" }],
  [
    "Pasted image 20261024211413.png",
    { name: "Pasted image 20261024211413.png", bytes: new Uint8Array([5]), key: "/abs/Pasted image 20261024211413.png" },
  ],
  ["files/讲义.pdf", { name: "讲义.pdf", bytes: new Uint8Array([6, 7]), key: "/abs/files/讲义.pdf" }],
  [
    "files/讲义(1).pdf",
    { name: "讲义(1).pdf", bytes: new Uint8Array([6, 8]), key: "/abs/files/讲义(1).pdf" },
  ],
  [
    "files/讲义 2024.pdf",
    { name: "讲义 2024.pdf", bytes: new Uint8Array([6, 9]), key: "/abs/files/讲义 2024.pdf" },
  ],
  [
    "[Zwonek 2012] GEOMETRIC PROPERTIES OF THE TETRABLOCK.pdf",
    {
      name: "[Zwonek 2012] GEOMETRIC PROPERTIES OF THE TETRABLOCK.pdf",
      bytes: new Uint8Array([9]),
      key: "/abs/zotero.pdf",
    },
  ],
]);

const reader = {
  read(ref) {
    return files.get(ref) ?? null;
  },
};

const uploads = [];
const upload = async (name, bytes) => {
  uploads.push({ name, bytes: bytes.byteLength });
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const base = ext ? name.slice(0, name.lastIndexOf(".")) : name;
  return `assets/${base}-20261024200000-x${ext}`;
};

const run = async (markdown) => {
  const stats = emptyAssetStats();
  const text = await rewriteAssets(markdown, reader, new Map(), stats, upload);
  return { text, stats };
};

/* ---------- 图片：上传 + 重写 ---------- */
{
  const { text, stats } = await run("前文\n\n![图](img/a.png)\n\n后文");
  check("图片被改写", text.includes("![图](assets/a-20261024200000-x.png)"), text);
  check("正文其它部分不动", text.startsWith("前文") && text.endsWith("后文"));
  check("图片计数", stats.images.uploaded === 1, JSON.stringify(stats));
  check("图片也进后缀统计", stats.kinds[".png"]?.uploaded === 1, JSON.stringify(stats.kinds));
}

/* ---------- 普通文件链接（pdf） ---------- */
{
  const { text, stats } = await run("[讲义](files/讲义.pdf) 和 [站外](https://x.com/a.pdf)");
  check("pdf 链接被改写", text.includes("[讲义](assets/讲义-20261024200000-x.pdf)"), text);
  check("外链不动", text.includes("https://x.com/a.pdf"));
  check("附件计数", stats.files.uploaded === 1 && stats.images.uploaded === 0, JSON.stringify(stats));
}

/* ---------- 0.6.3 回归：0.7-PLAN 里复现过的那批「链接不生效」 ---------- */
{
  // 用户报的就是这条：前面有别的字 + 链接文字里带方括号（Zotero 复制出来的）
  const { text, stats } = await run("详见[规格书[2024]](files/讲义.pdf) 那一节");
  check("链接文字带方括号也能改写", text.includes("[规格书[2024]](assets/讲义-20261024200000-x.pdf)"), text);
  check("前面有别的字不影响", text.startsWith("详见"), text);
  check("附件计数为 1", stats.files.uploaded === 1 && stats.kinds[".pdf"]?.uploaded === 1, JSON.stringify(stats));
}
{
  const { text } = await run("[规格书](files/讲义(1).pdf)");
  check("路径带圆括号", text.includes("assets/讲义(1)-20261024200000-x.pdf"), text);
}
{
  const { text, stats } = await run("[规格书](files/讲义 2024.pdf)");
  check("路径带空格", text.includes("assets/讲义 2024-20261024200000-x.pdf"), text);
  check("路径带空格也计数", stats.files.uploaded === 1, JSON.stringify(stats));
}
{
  const { text } = await run("[规格书](<files/讲义 2024.pdf>)");
  check("尖括号包裹带空格路径", text.includes("assets/讲义 2024-20261024200000-x.pdf"), text);
}
{
  // 图片语法 + 非图片后缀：旧版会产出 ![](assets/x.pdf) 这种坏图
  const { text, stats } = await run("下载![规格书](files/讲义.pdf)");
  check("pdf 的图片语法降级成链接", text === "下载[规格书](assets/讲义-20261024200000-x.pdf)", text);
  check("降级后仍算附件", stats.files.uploaded === 1 && stats.images.uploaded === 0, JSON.stringify(stats));
}
{
  // 找不到文件时，坏图仍然修成链接，至少点得开
  const { text, stats } = await run("![规格书](files/没有.pdf)");
  check("缺失的 pdf 图片语法也降级", text === "[规格书](files/没有.pdf)", text);
  check("降级后计缺失", stats.files.missing === 1, JSON.stringify(stats));
}
{
  const { text } = await run("![图](img/a.png)[pdf](files/讲义.pdf)");
  check("图片紧贴链接都能改写", text.includes("![图](assets/a-") && text.includes("[pdf](assets/讲义-"), text);
}
{
  const { text } = await run('![x](<img/b 空格.png> "标题")');
  check("图片带标题仍保留标题", text.includes('"标题"'), text);
}
{
  const code = "```md\n[规格书](files/讲义.pdf)\n```\n\n行内 `[x](files/讲义.pdf)` 也不动";
  const { text, stats } = await run(code);
  check("代码块里的链接不动", text === code, text);
  check("代码块里的链接不计数", stats.files.uploaded + stats.files.missing === 0, JSON.stringify(stats));
}

/* ---------- 已经是资源 / 锚点 / 协议链接 ---------- */
{
  const { text, stats } = await run(
    "[a](assets/a.pdf)\n[b](#标题)\n[c](siyuan://blocks/1)\n[d](mailto:x@y.com)\n[e](//cdn.com/a.pdf)",
  );
  check("已入库链接不动", text.includes("assets/a.pdf"));
  check("锚点不动", text.includes("(#标题)"));
  check("siyuan 协议不动", text.includes("siyuan://blocks/1"));
  check("mailto 不动", text.includes("mailto:x@y.com"));
  check("协议相对地址不动", text.includes("//cdn.com/a.pdf"));
  check("全部跳过时不计数", stats.files.uploaded + stats.files.missing === 0, JSON.stringify(stats));
}

/* ---------- 缺失：保留 + 分类计数 ---------- */
{
  const { text, stats } = await run("![](img/没有.png)\n\n[附件](files/没有.pdf)");
  check("缺失图片保留", text.includes("img/没有.png"));
  check("缺失附件保留", text.includes("files/没有.pdf"));
  check("图片缺失计数", stats.images.missing === 1, JSON.stringify(stats));
  check("附件缺失计数", stats.files.missing === 1, JSON.stringify(stats));
}

/* ---------- 批次去重：同一份文件只传一次 ---------- */
{
  const { stats } = await run("![1](img/a.png)\n![2](img/a.png)\n[下载](img/a.png)");
  check("同一份文件只上传一次", stats.images.uploaded === 1, JSON.stringify(stats));
}

/* ---------- Obsidian 嵌入（带空格 / 尺寸 / 缺失） ---------- */
{
  const spaced = await run("![[Pasted image 20261024211413.png]]");
  check("带空格的嵌入能上传", spaced.stats.images.uploaded === 1, JSON.stringify(spaced.stats));
  check("带空格的嵌入改写成功", spaced.text.includes("assets/Pasted image 20261024211413-"), spaced.text);
  check("不再残留嵌入语法", !spaced.text.includes("![["));
}
{
  const sized = await run("![[img/a.png|300]]");
  check("尺寸参数被丢掉", sized.text === "![](assets/a-20261024200000-x.png)", sized.text);
}
{
  const missing = await run("![[missing.png]]");
  check("嵌入找不到时保留原样", missing.text === "![[missing.png]]", missing.text);
  check("嵌入缺失也计数", missing.stats.images.missing === 1, JSON.stringify(missing.stats));
}

/* ---------- Obsidian 里的 PDF 嵌入：转成链接，不是图片 ---------- */
{
  const { text, stats } = await run("![[files/讲义.pdf]]");
  check("pdf 嵌入变成链接", text === "[讲义.pdf](assets/讲义-20261024200000-x.pdf)", text);
  check("pdf 计入文件而非图片", stats.files.uploaded === 1 && stats.images.uploaded === 0, JSON.stringify(stats));
  check("生成链接没被当成缺失", stats.files.missing === 0, JSON.stringify(stats));
  check("按扩展名细分计数", stats.kinds[".pdf"]?.uploaded === 1, JSON.stringify(stats.kinds));
}
{
  // 真机反馈：Zotero 导出的文献名带方括号，把旧正则卡死了
  const { text, stats } = await run("![[[Zwonek 2012] GEOMETRIC PROPERTIES OF THE TETRABLOCK.pdf]]");
  check("带方括号的文件名也能认出嵌入", text.includes("-20261024200000-x.pdf)"), text);
  check("链接文字里的方括号被转义", text.startsWith("[\\[Zwonek 2012\\] GEOMETRIC"), text);
  check("带方括号的嵌入也上传了", stats.files.uploaded === 1, JSON.stringify(stats));
}
{
  const note = await run("![[另一篇笔记]]");
  check("嵌入笔记不动", note.text === "![[另一篇笔记]]", note.text);
  check("嵌入笔记不计数", note.stats.files.uploaded + note.stats.files.missing === 0, JSON.stringify(note.stats));
}

/* ---------- 代码里的嵌入不能被改写（和行内链接同一套判定） ---------- */
{
  const fence = "```md\n![[img/a.png]]\n```";
  const out = await run(fence);
  check("围栏代码里的嵌入原样保留", out.text === fence, out.text);
  check("围栏代码里的嵌入不上传", out.stats.images.uploaded + out.stats.images.missing === 0, JSON.stringify(out.stats));
}
{
  const inline = "行内 `![[img/a.png]]` 示例";
  const out = await run(inline);
  check("行内代码里的嵌入原样保留", out.text === inline, out.text);
  check("行内代码里的嵌入不上传", out.stats.images.uploaded === 0, JSON.stringify(out.stats));
}
{
  const out = await run("`![[img/a.png]]` 和 ![[img/a.png]]");
  check("代码外的那条照旧改写", out.text.includes("![](assets/a-20261024200000-x.png)"), out.text);
  check("只上传一次", out.stats.images.uploaded === 1, JSON.stringify(out.stats));
}

/* ---------- 尖括号与标题 ---------- */
{
  const { text } = await run('![x](<img/b 空格.png> "标题")');
  check("带空格路径能解析", text.includes("assets/b 空格-20261024200000-x.png"), text);
  check("标题保留", text.includes('"标题"'), text);
}

/* ---------- data URI ---------- */
{
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const { text, stats } = await run(`![x](${png})`);
  check("data URI 被上传", stats.images.uploaded === 1, JSON.stringify(stats));
  check("data URI 被替换", !text.includes("base64"), text.slice(0, 60));
}

/* ---------- 上传失败 ---------- */
{
  const stats = emptyAssetStats();
  const text = await rewriteAssets("![a](img/a.png)", reader, new Map(), stats, async () => {
    throw new Error("boom");
  });
  check("上传失败保留原链接", text.includes("img/a.png"), text);
  check("失败计数", stats.images.failed === 1);
}

/* ---------- 没有链接时原样返回 ---------- */
{
  const plain = "# 标题\n\n没有图片也没有链接";
  const { text } = await run(plain);
  check("无链接时原样返回", text === plain, text);
}

console.log(`\n${passed} 项通过${failures.length ? `，${failures.length} 项失败` : ""}`);
if (failures.length) {
  console.log("\n失败明细：");
  for (const item of failures) {
    console.log(`  ✗ ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("资源链接重写：全部通过");
}
