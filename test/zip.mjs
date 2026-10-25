/**
 * ZIP 解析单测：结构还原、GBK 文件名、安全闸门、损坏包。
 * 用 test/zip-fixture.mjs 现场造包，不依赖外部 zip 工具。
 */

import esbuild from "esbuild";
import { rmSync } from "node:fs";
import { GBK_ZHONGWEN_MD, makeZip } from "./zip-fixture.mjs";

const BUILD = "test/.build";
rmSync(`${BUILD}/source/archive.mjs`, { force: true });
await esbuild.build({
  entryPoints: ["src/source/archive.ts"],
  bundle: true,
  format: "esm",
  outdir: BUILD,
  outbase: "src",
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});

global.window = { require: () => null };

const { unpackZip } = await import(`../${BUILD}/source/archive.mjs?t=${Date.now()}`);

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? `（${detail}）` : ""}`);
  }
};

/* ---------- 结构还原：单个顶层目录不套娃 ---------- */
const normal = makeZip([
  { name: "项目A/", data: "" },
  { name: "项目A/a.md", data: "# a\n\n甲" },
  { name: "项目A/b.md", data: "# b\n\n乙" },
  { name: "项目A/spec/", data: "" },
  { name: "项目A/spec/c.md", data: "# c\n\n丙" },
  { name: "项目A/note.txt", data: "txt" },
  { name: "项目A/img/x.png", data: "png" },
  { name: "项目A/Thumbs.db", data: "junk" },
  { name: "__MACOSX/._a.md", data: "junk" },
  { name: ".DS_Store", data: "junk" },
]);
const normalResult = unpackZip("项目A.zip", normal);
check("没有致命错误", !normalResult.fatal, normalResult.fatal);
check("收进 3 个 md", normalResult.files.length === 3, String(normalResult.files.length));
check(
  "顶层目录不额外套一层",
  normalResult.files.every((file) => file.dirs[0] === "项目A"),
  JSON.stringify(normalResult.files.map((f) => f.dirs)),
);
check(
  "子目录层级正确",
  normalResult.files.some((file) => file.dirs.join("/") === "项目A/spec"),
  JSON.stringify(normalResult.files.map((f) => f.dirs)),
);
check("正文解出来了", normalResult.files.some((file) => new TextDecoder().decode(file.bytes).includes("甲")));
check("非 md 计数", normalResult.nonMd === 1, String(normalResult.nonMd));
check("资源目录按文件数计", normalResult.assets === 1, String(normalResult.assets));
check("垃圾文件不计数", normalResult.nonMd + normalResult.assets === 2);

/* ---------- 多个顶层条目：套一层压缩包名 ---------- */
const flat = makeZip([
  { name: "a.md", data: "A" },
  { name: "b/b.md", data: "B" },
]);
const flatResult = unpackZip("打包.zip", flat);
check(
  "多个顶层时按压缩包名分层",
  flatResult.files.every((file) => file.dirs[0] === "打包"),
  JSON.stringify(flatResult.files.map((f) => f.dirs)),
);
check(
  "包内相对路径保留",
  flatResult.files.some((file) => file.dirs.join("/") === "打包/b"),
  JSON.stringify(flatResult.files.map((f) => f.dirs)),
);

/* ---------- GBK 文件名（未置 UTF-8 标志位） ---------- */
const gbk = makeZip([
  { name: "中文.md", nameBytes: GBK_ZHONGWEN_MD, data: "内容", utf8Flag: false },
]);
const gbkResult = unpackZip("gbk.zip", gbk);
check("GBK 文件名不乱码", gbkResult.files[0]?.name === "中文.md", gbkResult.files[0]?.name);
check("GBK 包也要套一层包名", gbkResult.files[0]?.dirs[0] === "gbk", JSON.stringify(gbkResult.files[0]?.dirs));

/* ---------- store（不压缩）也要能解 ---------- */
const stored = makeZip([{ name: "存.md", data: "不压缩", store: true }]);
const storedResult = unpackZip("store.zip", stored);
check("store 方式可解", new TextDecoder().decode(storedResult.files[0]?.bytes ?? new Uint8Array()).includes("不压缩"));

/* ---------- 安全闸门 ---------- */
const traversal = makeZip([{ name: "../逃逸.md", data: "x" }]);
check("路径穿越整包拒收", /上级目录/.test(unpackZip("t.zip", traversal).fatal ?? ""), unpackZip("t.zip", traversal).fatal);

const absolute = makeZip([{ name: "/etc/passwd.md", data: "x" }]);
check("绝对路径整包拒收", /绝对路径/.test(unpackZip("a.zip", absolute).fatal ?? ""));

const encrypted = makeZip([{ name: "加密.md", data: "x", encrypted: true }]);
check("加密包整包拒收", /加密/.test(unpackZip("e.zip", encrypted).fatal ?? ""));

const truncated = normal.slice(0, Math.floor(normal.length / 2));
check("截断的包拒收", Boolean(unpackZip("broken.zip", truncated).fatal));

const notZip = new TextEncoder().encode("这根本不是压缩包");
check("不是 zip 的文件拒收", /损坏/.test(unpackZip("fake.zip", notZip).fatal ?? ""));

/* ---------- 空包 / 只有垃圾 ---------- */
const junkOnly = makeZip([
  { name: "__MACOSX/._x.md", data: "junk" },
  { name: ".DS_Store", data: "junk" },
]);
const junkResult = unpackZip("junk.zip", junkOnly);
check("只有垃圾时没有文件", junkResult.files.length === 0 && !junkResult.fatal);

/* ---------- 条目数上限 ---------- */
const tooMany = makeZip(
  Array.from({ length: 5001 }, (_, index) => ({ name: `f${index}.md`, data: "x", store: true })),
);
check("超过 5000 条整包拒收", /条目过多/.test(unpackZip("big.zip", tooMany).fatal ?? ""));

console.log(`\n${passed} 项通过${failures.length ? `，${failures.length} 项失败` : ""}`);
if (failures.length) {
  console.log("\n失败明细：");
  for (const item of failures) {
    console.log(`  ✗ ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("ZIP 解析：全部通过");
}
