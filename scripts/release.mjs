// 一键发版：改版本号 → 构建 → 打包检查 → 提交 → 打 tag → 推送
//
//   node scripts/release.mjs 1.0.2
//   node scripts/release.mjs 1.0.2 --dry-run   # 只做本地改动，不提交不推送
//
// 规则（见 docs/RELEASE.md）：
//   - package.json / plugin.json / git tag 三处版本号必须一致，集市按这个对版本
//   - tag 一推上去，GitHub Actions 自动构建 package.zip 并建 Release
//   - 已上架的插件不需要再提交集市 PR：集市自动取最新 Release
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("用法: node scripts/release.mjs <版本号，如 1.0.2> [--dry-run]");
  process.exit(1);
}

const run = (cmd, args) =>
  execFileSync(cmd, args, {
    cwd: root,
    encoding: "utf-8",
    stdio: "pipe",
    // Windows 上 npm 是 npm.cmd，execFileSync 不带 shell 找不到
    shell: process.platform === "win32",
  }).trim();
const say = (msg) => console.log(msg);

// 1. 版本号：package.json + plugin.json
const pkgPath = path.join(root, "package.json");
const manPath = path.join(root, "plugin.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const man = JSON.parse(fs.readFileSync(manPath, "utf-8"));
const old = pkg.version;
if (old === version) {
  say(`版本号已经是 ${version}，请给一个新版本号。`);
  process.exit(1);
}
pkg.version = version;
man.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + "\n");
say(`版本号 ${old} → ${version}`);

// 2. 构建并检查产物结构
run("npm", ["run", "build"]);
const dist = path.join(root, "dist");
const files = fs.readdirSync(dist).sort();
const need = ["index.js", "index.css", "plugin.json"];
const missing = need.filter((f) => !files.includes(f));
if (missing.length) {
  console.error(`dist 缺少必需文件: ${missing.join(", ")}`);
  process.exit(1);
}
say(`dist 内容: ${files.join(", ")}`);
if (files.some((f) => f.includes("/") || f.endsWith(".ts"))) {
  console.error("dist 里有子目录或 .ts 文件，打包会多套一层，检查一下。");
  process.exit(1);
}

if (dryRun) {
  say("\n--dry-run：到此为止，未提交未推送。");
  process.exit(0);
}

// 3. 提交
run("git", ["add", "-A"]);
run("git", ["commit", "-m", `release: ${version}`]);
say(`已提交 release: ${version}`);

// 4. 打 tag（同名 tag 存在就先删本地）
try {
  run("git", ["rev-parse", "-q", "--verify", `refs/tags/v${version}`]);
  run("git", ["tag", "-d", `v${version}`]);
} catch {
  /* 本地没有这个 tag，正常 */
}
run("git", ["tag", "-a", `v${version}`, "-m", version]);
say(`已打 tag v${version}`);

// 5. 推送（先推分支，再推 tag）
run("git", ["push", "origin", "HEAD"]);
run("git", ["push", "origin", `v${version}`]);
say(`已推送分支与 tag v${version}`);

say(`
下一步：
  1. 看 CI：https://github.com/clock-05/siyuan-drag-import/actions
     Release 工作流会构建 package.zip 并建 Release，tag 与 plugin.json 版本不一致会失败。
  2. 校验 Release 里的 package.zip 解压后根目录是 index.js / index.css / plugin.json / README*。
  3. 集市会自动取最新 Release，不用再提 PR；等几分钟看「设置 → 集市 → 插件」里能不能搜到。
`);
