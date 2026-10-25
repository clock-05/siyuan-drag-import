/**
 * 文件夹遍历单测：只管「磁盘长这样 → 收进来什么」。
 * 不碰思源，纯 fs 夹具。
 */

import esbuild from "esbuild";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const BUILD = "test/.build";
await esbuild.build({
  entryPoints: ["src/source/fsWalk.ts"],
  bundle: true,
  format: "esm",
  outdir: BUILD,
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});

global.window = { require };

const { walkFolder } = await import(`../${BUILD}/fsWalk.mjs?t=${Date.now()}`);

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? `（${detail}）` : ""}`);
  }
};

const root = mkdtempSync(join(tmpdir(), "sdi-walk-"));
const project = join(root, "项目A");

try {
  mkdirSync(join(project, "spec", "deep"), { recursive: true });
  mkdirSync(join(project, "empty"), { recursive: true });
  mkdirSync(join(project, "empty", "nested"), { recursive: true });
  mkdirSync(join(project, "img"), { recursive: true });
  mkdirSync(join(project, ".obsidian"), { recursive: true });
  mkdirSync(join(project, "node_modules", "pkg"), { recursive: true });

  writeFileSync(join(project, "a.md"), "# a\n\n正文");
  writeFileSync(join(project, "b.MD"), "# b");
  writeFileSync(join(project, "spec", "c.markdown"), "# c");
  writeFileSync(join(project, "spec", "deep", "d.mkd"), "# d");
  writeFileSync(join(project, "note.txt"), "not markdown");
  writeFileSync(join(project, "Thumbs.db"), "junk");
  writeFileSync(join(project, "img", "x.png"), "png");
  writeFileSync(join(project, "img", "y.jpg"), "jpg");
  writeFileSync(join(project, ".obsidian", "workspace.md"), "# should not import");
  writeFileSync(join(project, "node_modules", "pkg", "readme.md"), "# should not import");

  const result = walkFolder(project);
  const names = result.files.map((f) => f.name).sort();
  check("收进 4 个 md（含大写扩展名）", names.join(",") === "a.md,b.MD,c.markdown,d.mkd", names.join(","));
  check("隐藏目录整棵跳过", !names.includes("workspace.md"));
  check("node_modules 整棵跳过", !names.includes("readme.md"));

  const dirsOf = (name) => result.files.find((f) => f.name === name)?.dirs.join("/") ?? "";
  check("根级文件的目录段为空", dirsOf("a.md") === "", dirsOf("a.md"));
  check("一层子目录", dirsOf("c.markdown") === "spec", dirsOf("c.markdown"));
  check("两层子目录", dirsOf("d.mkd") === "spec/deep", dirsOf("d.mkd"));

  check("非 md 计数", result.nonMd === 1, String(result.nonMd));
  check("资产目录按文件数计", result.assets === 2, String(result.assets));
  check("资产文件按扩展名计数", result.assetKinds[".png"] === 1 && result.assetKinds[".jpg"] === 1, JSON.stringify(result.assetKinds));
  check("非 md 文件按扩展名计数", result.nonMdKinds[".txt"] === 1, JSON.stringify(result.nonMdKinds));
  check("Thumbs.db 不计数", !result.problems.some((p) => p.name === "Thumbs.db"));
  check(
    "空目录只报最上层",
    result.emptyDirs.length === 1 && result.emptyDirs[0] === "empty",
    JSON.stringify(result.emptyDirs),
  );
  check(
    "被忽略的目录记下来（只进日志）",
    result.ignoredDirs.includes(".obsidian") && result.ignoredDirs.includes("node_modules"),
    JSON.stringify(result.ignoredDirs),
  );
  check("没有报错项", result.problems.length === 0, JSON.stringify(result.problems));
  check("文件大小读到了", (result.files.find((f) => f.name === "a.md")?.size ?? 0) > 0);

  // 只含图片的目录：整棵子树没有 md → 按空目录处理，但资产数要算上
  const onlyImages = join(root, "只有图");
  mkdirSync(join(onlyImages, "assets"), { recursive: true });
  writeFileSync(join(onlyImages, "assets", "p.png"), "png");
  const bare = walkFolder(onlyImages);
  check("只有图片的目录没有 md", bare.files.length === 0);
  check("资产文件仍然计数", bare.assets === 1, String(bare.assets));

  // 空目录
  const emptyOnly = join(root, "纯空");
  mkdirSync(emptyOnly);
  const empty = walkFolder(emptyOnly);
  check("空目录零文件", empty.files.length === 0 && empty.emptyDirs.length === 0);

  // 不存在的路径：报一条 problem，不抛
  const missing = walkFolder(join(root, "不存在的目录"));
  check("读不到的目录给出 problem", missing.problems.length === 1, JSON.stringify(missing.problems));
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
  console.log("文件夹遍历：全部通过");
}
