import { readFileSync } from "node:fs";
const DIR = "D:/Program Files/SiYuan/resources/stage/build/app";
const s = readFileSync(DIR + "/common.7fbfb452b8d406a9153a.js", "utf8");

function show(label, at, before = 500, after = 900) {
  console.log("\n\n================ " + label + " @" + at + " ================");
  console.log(s.slice(at - before, at + after).replace(/\n/g, " "));
}

show("window capture drop", 2698506, 300, 700);
show("fileTree drop/dragover", 1250858, 2500, 1200);
show("window dragover (bubble)", 218102, 600, 600);
