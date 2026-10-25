/**
 * Obsidian 双链 `[[笔记]]` / `[[笔记|别名]]` / `[[目录/笔记]]` → 思源块引用 `((id "文字"))`。
 *
 * 为什么要转：md 里的 `[[...]]` 内核不认，导入后会原样显示成一段文本 ——
 * 从 Obsidian 迁过来的一整库笔记，内部链接会全部变成死文本。
 * 思源的块引用能点开、能悬浮预览，是最接近的对应物（实测 `((id "别名"))` 渲染成 block-ref）。
 *
 * 边界（宁可不动，也不要把链接指错地方）：
 * - 只转**本批一起导入**的笔记：目标名 / 相对路径能在本批里唯一命中；
 *   库里已有但不在本批的笔记不去猜（那是全库搜索，猜错比不转更糟）。
 * - `[[笔记#标题]]` 不转：块引用只能指到文档，没法指到某个标题，硬转会跳到文档开头。
 * - 代码里的 `[[...]]` 不转；`![[...]]` 是嵌入，交给 assets.ts。
 * - 别名里有引号 / 换行不转：块引用的文字是用引号包的，塞不进去。
 */

import { codeRanges, inCode } from "./scanLinks";

export interface WikiLink {
  start: number;
  end: number;
  /** 目标原文（可能带目录与 `.md`，也可能带 `#标题`） */
  target: string;
  /** `|` 后面的显示文字；没有就是空串 */
  alias: string;
}

/** 按第一个未被转义的 `|` 拆成目标和别名（表格里常写成 `\|`） */
function splitAlias(inner: string): { target: string; alias: string } {
  for (let index = 0; index < inner.length; index += 1) {
    if (inner[index] !== "|") {
      continue;
    }
    if (inner[index - 1] === "\\") {
      // 转义的竖线是正文，不是分隔符；把它还原掉
      return { target: `${inner.slice(0, index - 1)}|${inner.slice(index + 1)}`, alias: "" };
    }
    return { target: inner.slice(0, index), alias: inner.slice(index + 1) };
  }
  return { target: inner, alias: "" };
}

/** 扫出所有可考虑转换的双链（是否真的转，还要看目标能不能解析） */
export function scanWikilinks(markdown: string): WikiLink[] {
  if (!markdown.includes("[[")) {
    return [];
  }
  const code = codeRanges(markdown);
  const out: WikiLink[] = [];
  let index = 0;

  while (index < markdown.length) {
    const open = markdown.indexOf("[[", index);
    if (open < 0) {
      break;
    }
    index = open + 2;

    // `![[...]]` 是嵌入，不是链接
    if (markdown[open - 1] === "!" && markdown[open - 2] !== "\\") {
      continue;
    }
    if (inCode(code, open)) {
      continue;
    }

    const close = markdown.indexOf("]]", open + 2);
    if (close < 0) {
      break;
    }
    const inner = markdown.slice(open + 2, close);
    // 嵌套方括号、跨行的都不是合法双链，跳过这一段
    if (!inner.trim() || inner.includes("[") || inner.includes("]") || /[\n\r]/.test(inner)) {
      index = close + 2;
      continue;
    }

    const { target, alias } = splitAlias(inner);
    const cleanTarget = target.trim();
    if (!cleanTarget) {
      index = close + 2;
      continue;
    }
    out.push({ start: open, end: close + 2, target: cleanTarget, alias: alias.trim() });
    index = close + 2;
  }

  return out;
}

/** 解析用的键：去 `./`、统一斜杠、去 `.md`、NFC + 小写 */
export function linkKey(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\.md$/i, "")
    .trim()
    .normalize("NFC")
    .toLowerCase();
}

/** 块引用里显示的文字：别名优先，否则取目标最后一段（Obsidian 也是这么显示的） */
function linkLabel(link: WikiLink): string {
  if (link.alias) {
    return link.alias;
  }
  const base = link.target.replace(/\\/g, "/").split("/").pop() ?? link.target;
  return base.replace(/\.md$/i, "");
}

/**
 * 把能解析到的双链换成块引用。
 * `resolve` 返回 undefined 表示这篇不在本批里（或重名歧义），原样保留。
 */
export function applyWikilinks(
  markdown: string,
  links: WikiLink[],
  resolve: (target: string) => string | undefined,
): { text: string; converted: number } {
  let out = "";
  let last = 0;
  let converted = 0;

  for (const link of links) {
    // 带标题锚点的指不到具体位置，宁可不转
    if (link.target.includes("#")) {
      continue;
    }
    const label = linkLabel(link);
    // 引号 / 换行会破坏 `((id "文字"))` 的结构
    if (!label || /["\n\r]/.test(label)) {
      continue;
    }
    const id = resolve(link.target);
    if (!id) {
      continue;
    }
    out += markdown.slice(last, link.start);
    out += `((${id} "${label}"))`;
    last = link.end;
    converted += 1;
  }

  if (converted === 0) {
    return { text: markdown, converted: 0 };
  }
  out += markdown.slice(last);
  return { text: out, converted };
}
