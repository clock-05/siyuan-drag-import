/**
 * 文案守卫：`src/` 里除了 `src/i18n/` 之外，不许再出现中文字面量。
 *
 * 为什么需要它：0.8.0 加中英双语时，界面文案确实都抽走了，但漏了拖拽横幅、
 * 压缩包报错、日志路径兜底这些角落 —— 中文环境完全看不出来，切成英文才会露馅。
 * 靠人肉复核迟早再漏一次，所以让它在 `npm test` 里直接失败。
 *
 * 判据只认「字符串字面量 / 模板字符串」，注释里的中文不算（那是给维护者看的）；
 * `console.*` 的参数豁免（那是日志，不是界面文案）。
 * 唯一的约定：诊断信息统一写英文，这样豁免范围不用再细分。
 */

import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "src";
const I18N = join(ROOT, "i18n");
const CJK = /[\u3400-\u9fff]/;

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? `（${detail}）` : ""}`);
  }
};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/** `console.log(...)` 是诊断输出，不参与界面文案检查 */
function isConsoleCall(node) {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const fn = node.expression;
  return (
    ts.isPropertyAccessExpression(fn) &&
    ts.isIdentifier(fn.expression) &&
    fn.expression.text === "console"
  );
}

function isCopyNode(node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
}

/** 一个文件里所有「中文出现在文案位置」的地方 */
function scanCopy(file, { skipConsole = true } = {}) {
  const text = readFileSync(file, "utf-8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];

  const visit = (node, inConsole) => {
    const quiet = skipConsole && (inConsole || isConsoleCall(node));
    if (!quiet && isCopyNode(node) && CJK.test(node.text)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      found.push(`${relative(".", file)}:${line}  ${node.text.trim().slice(0, 40)}`);
    }
    ts.forEachChild(node, (child) => visit(child, quiet));
  };
  visit(source, false);
  return found;
}

const files = walk(ROOT).filter((file) => !file.startsWith(I18N + "\\") && !file.startsWith(I18N + "/"));
const offenders = files.flatMap((file) => scanCopy(file));

check("扫描到了源码文件（防止 glob 失效后一片绿）", files.length >= 20, `${files.length} 个文件`);
check("src 里除 i18n 外没有中文字面量", offenders.length === 0, offenders.join(" / "));

// 反向确认：中文词典确实有中文、英文词典一条不留（否则上面那条可能是「扫了个寂寞」）
const zhCopy = scanCopy(join(I18N, "messages.zh.ts"), { skipConsole: false });
const enCopy = scanCopy(join(I18N, "messages.en.ts"), { skipConsole: false });
check("中文词典里确实有中文", zhCopy.length > 50, `${zhCopy.length} 条`);
check("英文词典里没有残留中文", enCopy.length === 0, enCopy.slice(0, 5).join(" / "));

console.log(`\n${passed} 项通过`);
if (failures.length > 0) {
  console.log("失败明细：");
  for (const item of failures) {
    console.log(`  ✗ ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("文案守卫：全部通过");
}
