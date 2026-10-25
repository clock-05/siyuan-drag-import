/**
 * 附件引用路径归一化 + 磁盘读取。
 * 盯的是「从 Word / 浏览器复制出来的 md 里那些 file:///C:/… 绝对路径」——
 * 之前会被拼成 …\file:\C:\x\a.png，最后报「附件找不到」。
 */

import esbuild from "esbuild";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
// platform.ts 走的是 window.require，测试里把它接到真的 require 上
global.window = { require: (id) => require(id) };

const BUILD = "test/.build";
rmSync(`${BUILD}/source/assetReader.mjs`, { force: true });
await esbuild.build({
  entryPoints: ["src/source/assetReader.ts"],
  bundle: true,
  format: "esm",
  outdir: BUILD,
  outbase: "src",
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});

const { normalizeAssetRef, createDiskAssetReader } = await import(
  `../${BUILD}/source/assetReader.mjs?t=${Date.now()}`
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

const same = (name, actual, expected) => check(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);

/* ---------- 归一化 ---------- */
same("普通相对路径不动", normalizeAssetRef("img/a.png"), "img/a.png");
same("去掉尖括号", normalizeAssetRef("<a b.png>"), "a b.png");
same("URL 编码解成空格", normalizeAssetRef("a%20b.png"), "a b.png");
same("去掉 #锚点", normalizeAssetRef("a.png#page=2"), "a.png");
same("去掉前后空白", normalizeAssetRef("  img/a.png  "), "img/a.png");
same("非法的 % 不去动它", normalizeAssetRef("100%.png"), "100%.png");

same("file:/// 盘符路径", normalizeAssetRef("file:///C:/x/a.png"), "C:/x/a.png");
same("file:/// + URL 编码", normalizeAssetRef("file:///C:/x/a%20b.png"), "C:/x/a b.png");
same("file:/// 小写盘符", normalizeAssetRef("file:///d:/x/a.png"), "d:/x/a.png");
same("file:// UNC 保留双斜杠", normalizeAssetRef("file://server/share/a.png"), "//server/share/a.png");
same("外链原样返回（由 isLocalRef 拦）", normalizeAssetRef("https://x.com/a.png"), "https://x.com/a.png");

/* ---------- 磁盘读取（含带空格的目录） ---------- */
const root = mkdtempSync(join(tmpdir(), "sdi-ref-"));
try {
  const folder = join(root, "带 空格");
  mkdirSync(join(folder, "img"), { recursive: true });
  writeFileSync(join(folder, "img", "a.png"), Buffer.from([1, 2, 3]));
  const mdPath = join(folder, "note.md");
  writeFileSync(mdPath, "# 笔记");

  const reader = createDiskAssetReader(mdPath, folder);
  check("reader 建得出来", Boolean(reader));

  const plain = reader.read("img/a.png");
  check("相对路径读得到", plain?.bytes?.byteLength === 3, JSON.stringify(plain?.name));

  // Word / 浏览器复制过来的那种写法
  const abs = `${folder.replace(/\\/g, "/")}/img/a.png`;
  const viaFile = reader.read(`file:///${abs}`);
  check("file:/// 绝对路径也读得到", viaFile?.bytes?.byteLength === 3, JSON.stringify(viaFile?.name));
  check("文件名取真实 basename", viaFile?.name === "a.png", String(viaFile?.name));

  // 路径里有空格时，正文常常写成 %20
  const encoded = reader.read(`file:///${abs.replace(/ /g, "%20")}`);
  check("file:/// + %20 也读得到", encoded?.bytes?.byteLength === 3, JSON.stringify(encoded?.name));

  check("不存在的文件返回 null", reader.read("img/没有.png") === null);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} 项通过${failures.length ? `，${failures.length} 项失败` : ""}`);
if (failures.length) {
  console.log("\n失败明细：");
  for (const item of failures) {
    console.log(`  ✗ ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("附件引用路径：全部通过");
}
