import { readFileSync, readdirSync } from "node:fs";
const DIR = "D:/Program Files/SiYuan/resources/stage/build/app";
const s = readFileSync(DIR + "/common.7fbfb452b8d406a9153a.js", "utf8");

// 1) 找到 @2457322 处 p 的来源
console.log("===== 定位 p 的赋值（2420000-2457400 之间所有 'p=' 且带 document/window）=====");
const seg = s.slice(2430000, 2457500);
const re = /p=(document|window)[^,;]{0,40}/g;
let m;
while ((m = re.exec(seg))) console.log("  " + m[0] + "  @" + (2430000 + m.index));

// 2) sy__file / scrollFileTree 是否存在
for (const k of ["sy__file", "scrollFileTree", "fileTree", "#fileTree", "sy__outline"]) {
  console.log(`\n===== ${k}: ${(s.match(new RegExp(k.replace(/[#]/g, "\\$&"), "g")) || []).length}`);
}

// 3) 文件树类的 isSupportedDrop 覆盖
console.log("\n===== isSupportedDrop 出现位置 =====");
let i = -1;
while ((i = s.indexOf("isSupportedDrop", i + 1)) >= 0) console.log("  @" + i);

// 4) 找 FileTree 类定义痕迹
for (const k of ['getAttribute("data-type")==="tree"', 'data-type="file"', "filetree"]) {
  console.log(`\n===== ${k}: ${(s.split(k).length - 1)}`);
}
