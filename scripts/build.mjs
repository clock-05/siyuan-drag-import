import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_NAME = "siyuan-drag-import";
const watch = process.argv.includes("--watch");

/** 读取 .env 里的 SIYUAN_WORKSPACE：构建产物直接落到工作区，省掉手动拷贝 */
function readWorkspace() {
  if (process.env.SIYUAN_WORKSPACE) {
    return process.env.SIYUAN_WORKSPACE;
  }
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) {
    return "";
  }
  const line = fs
    .readFileSync(envPath, "utf-8")
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith("SIYUAN_WORKSPACE"));
  if (!line) {
    return "";
  }
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

const workspace = readWorkspace();
const outdir = path.join(root, "dist");
const syncDir = workspace ? path.join(workspace, "data", "plugins", PLUGIN_NAME) : "";

/**
 * 静态资源：集市要求 index.css / plugin.json / README*，图标与预览图由 plugin.json 声明。
 * 界面文案已经打进了 index.js，所以**不再**产出 i18n/*.ts（那只是源码）。
 */
const STATIC_FILES = [
  "plugin.json",
  "index.css",
  "icon.png",
  "preview.png",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
];

function copyStatic(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of STATIC_FILES) {
    const source = path.join(root, file);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(dir, file));
    } else if (STATIC_FILES.includes(file)) {
      console.warn(`[build] 缺少 ${file}，集市检查会失败`);
    }
  }
}

/**
 * 把 dist 整体同步到思源工作区。
 * 这里不用 fs.cpSync —— 在本机 D 盘上它会让 node 进程直接崩掉（exit 127，无任何报错），
 * 老老实实手写递归复制更稳。
 */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function syncToWorkspace() {
  // 防手滑：只允许删掉以插件名结尾的目录
  if (!syncDir.endsWith(path.sep + PLUGIN_NAME)) {
    throw new Error(`同步目录异常，已中止: ${syncDir}`);
  }
  fs.rmSync(syncDir, { recursive: true, force: true });
  copyDir(outdir, syncDir);
}

const options = {
  entryPoints: [path.join(root, "src", "index.ts")],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: ["chrome110"],
  outfile: path.join(outdir, "index.js"),
  external: ["siyuan"],
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  logLevel: "info",
};

// 清掉上次构建的残留（早期版本会产出 i18n/*.ts），不然会被原样打进 package.zip
if (!watch) {
  fs.rmSync(outdir, { recursive: true, force: true });
}

copyStatic(outdir);

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  if (syncDir) {
    syncToWorkspace();
  }
  console.log(`\nWatching... output: ${outdir}`);
  if (syncDir) {
    console.log(`同步目录: ${syncDir}`);
  }
} else {
  await esbuild.build(options);
  if (syncDir) {
    syncToWorkspace();
    console.log(`\nBuild done: ${outdir}\n已同步到: ${syncDir}`);
  } else {
    console.log(`\nBuild done: ${outdir}`);
    console.log("提示：在 .env 里设置 SIYUAN_WORKSPACE，可让构建产物自动同步到工作区。");
  }
}
