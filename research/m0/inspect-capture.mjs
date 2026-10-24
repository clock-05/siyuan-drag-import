import { readFileSync, readdirSync } from "node:fs";
const DIR = "D:/Program Files/SiYuan/resources/stage/build/app";
const files = readdirSync(DIR).filter((f) => f.endsWith(".js"));

console.log("=== 全量扫描：捕获阶段的 drop/dragover 监听 ===");
for (const f of files) {
  const s = readFileSync(DIR + "/" + f, "utf8");
  const re = /([A-Za-z0-9_$\.\[\]]{0,40})\.addEventListener\("(drop|dragover|dragenter)",\s*[^)]{0,200}?\{[^}]{0,120}?capture\s*:\s*!0/g;
  let m;
  while ((m = re.exec(s))) {
    console.log(`  [${f}] target=${m[1]} ev=${m[2]} :: ${s.slice(m.index, m.index + 190).replace(/\n/g, " ")}`);
  }
}

console.log("\n=== window 上的 dragover 是否对 Files 做全局 preventDefault ===");
const s = readFileSync(DIR + "/common.7fbfb452b8d406a9153a.js", "utf8");
const seg = s.slice(218102, 222600);
const parts = seg.split("preventDefault");
console.log("  该窗口内 preventDefault 次数: " + (parts.length - 1));
for (let i = 1; i < Math.min(parts.length, 5); i++) {
  console.log("  --" + parts[i - 1].slice(-160).replace(/\n/g, " ") + " [preventDefault] " + parts[i].slice(0, 90).replace(/\n/g, " "));
}

console.log("\n=== 文件树容器与条目选择器 ===");
for (const k of [".file-tree__items", "file-tree__items", "sy__file"]) {
  console.log(`  ${k}: ${(s.split(k).length - 1)} 次`);
}
const i2 = s.indexOf("file-tree__items");
console.log("  上下文: " + s.slice(i2 - 300, i2 + 300).replace(/\n/g, " "));
