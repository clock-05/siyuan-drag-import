import { readFileSync, readdirSync } from "node:fs";

const DIR = "D:/Program Files/SiYuan/resources/stage/build/app";
const files = readdirSync(DIR).filter((f) => f.endsWith(".js"));
const main = "common.7fbfb452b8d406a9153a.js";
const s = readFileSync(DIR + "/" + main, "utf8");

function targets(ev) {
  const re = new RegExp(String.raw`([A-Za-z0-9_$\.\[\]]{0,36})\.addEventListener\("` + ev + `"`, "g");
  const rows = [];
  let m;
  while ((m = re.exec(s))) {
    rows.push({ target: m[1], at: m.index, capture: s.slice(m.index, m.index + 180).includes("capture") });
  }
  return rows;
}

for (const ev of ["drop", "dragover", "dragenter", "dragleave"]) {
  console.log("\n######## " + ev);
  for (const r of targets(ev)) console.log(`  ${r.target}   @${r.at}  capture?${r.capture}`);
}

console.log("\n######## .sy__file 次数: " + (s.match(/sy__file/g) || []).length);
let i = -1;
let n = 0;
while ((i = s.indexOf("sy__file", i + 1)) >= 0 && n < 4) {
  n++;
  console.log(`\n-- @${i}\n` + s.slice(i - 260, i + 200).replace(/\n/g, " "));
}

console.log("\n######## scrollFileTree 次数: " + (s.match(/scrollFileTree/g) || []).length);
i = s.indexOf("scrollFileTree");
if (i > 0) console.log(s.slice(i - 200, i + 200).replace(/\n/g, " "));
