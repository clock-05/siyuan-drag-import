import { readFileSync } from "node:fs";
const DIR = "D:/Program Files/SiYuan/resources/stage/build/app";
const s = readFileSync(DIR + "/common.7fbfb452b8d406a9153a.js", "utf8");

function all(key, before = 120, after = 200, limit = 8) {
  console.log("\n\n############### " + key);
  let i = -1;
  let n = 0;
  while ((i = s.indexOf(key, i + 1)) >= 0 && n < limit) {
    n++;
    console.log(`-- @${i}: ...` + s.slice(i - before, i + after).replace(/\n/g, " ") + "...");
  }
}

all("bindDropEvent", 150, 120);
all("sy__file", 150, 150, 6);

// p 的定义：在 @2457322 附近回溯 3000 字符找 "p="
console.log("\n\n############### p= 在 2445000~2457400");
const seg = s.slice(2445000, 2457400);
const re = /\bp=(?!>)/g;
let m;
while ((m = re.exec(seg))) {
  console.log(`  @${2445000 + m.index}: ` + seg.slice(m.index - 60, m.index + 70).replace(/\n/g, " "));
}
