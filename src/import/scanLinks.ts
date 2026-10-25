/**
 * Markdown 行内链接扫描器（图片 + 普通链接）。
 *
 * 为什么不用正则：链接文字里允许出现方括号（Zotero 复制出来的
 * `[Zwonek 2012] GEOMETRIC….pdf`），路径里允许出现空格和圆括号
 * （`讲义(1).pdf`、`讲义 2024.pdf`）。旧正则的 `[^\]]*` + `[^)\s]+`
 * 表达不了这两种情况，会把整条链接判成「不是链接」然后静默跳过。
 *
 * 语法边界（按 CommonMark 的口径，个别地方放宽）：
 * 1. 链接文字按**方括号配对深度**找结尾：`[a[2024]]` 里外层才是链接；
 * 2. `\` 转义的下一个字符不当结构字符（`\[` 不算开括号）；
 * 3. 目标地址可以写成 `<...>`（中间允许空格），也可以裸写；裸写时
 *    空格与圆括号都算路径的一部分，只有「空白 + 引号/括号标题」或收尾的 `)`
 *    才结束地址 —— 这一条就是为了接住 `[x](files/讲义 2024.pdf)`；
 * 4. 标题支持 `"..."` / `'...'` / `(...)`，改写时原样保留；
 * 5. 行内代码与 ``` / ~~~ 围栏里的内容不参与匹配（代码块里的示例不能被改）；
 * 6. 图片判定看 `[` 前一位是不是未被转义的 `!`，是则吃进 start。
 *
 * 纯函数、无副作用，单测见 test/links.mjs。
 */

export interface LinkMatch {
  /** 起点：普通链接是 `[` 的下标，图片是 `!` 的下标 */
  start: number;
  /** 终点（不含）：`(` 的配对 `)` 之后 */
  end: number;
  kind: "image" | "link";
  /** 链接文字原样（不含外层方括号） */
  text: string;
  /** 目标地址：去掉尖括号、按 Markdown 规则解掉转义 */
  ref: string;
  /** 标题，含前导空格（`' "标题"'`）；没有就是空串。改写时直接拼在地址后面 */
  title: string;
}

/** CommonMark 的 ASCII 标点集合：只有这些字符才能被 `\` 转义 */
const ESCAPED = /\\([!-/:-@[-`{-~])/g;

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** `\` 转义只对 ASCII 标点生效，别把 Windows 路径的 `\U` 吃掉 */
function unescapeRef(value: string): string {
  return value.replace(ESCAPED, "$1");
}

function runLength(text: string, from: number, ch: string): number {
  let index = from;
  while (index < text.length && text[index] === ch) {
    index += 1;
  }
  return index - from;
}

/**
 * 围栏代码块区间 `[start, end)`。
 * 只认行首（最多 3 个空格）的 ``` 或 ~~~，闭合要求同字符且长度不短于开头；
 * 没闭合的围栏按 CommonMark 吃到文末。
 */
export function fencedRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: { ch: string; len: number; start: number } | null = null;
  let lineStart = 0;
  while (lineStart <= markdown.length) {
    const lineEnd = markdown.indexOf("\n", lineStart);
    const end = lineEnd < 0 ? markdown.length : lineEnd;
    const line = markdown.slice(lineStart, end);
    if (!open) {
      const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (match) {
        open = { ch: match[1][0], len: match[1].length, start: lineStart };
      }
    } else {
      const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (match && match[1][0] === open.ch && match[1].length >= open.len) {
        ranges.push([open.start, end]);
        open = null;
      }
    }
    if (lineEnd < 0) {
      break;
    }
    lineStart = lineEnd + 1;
  }
  if (open) {
    ranges.push([open.start, markdown.length]);
  }
  return ranges;
}

/** 行内代码结束位置（不含反引号）；找不到或跨了空行就当没开 */
function codeSpanEnd(markdown: string, from: number, len: number): number {
  let index = from;
  while (index < markdown.length) {
    if (markdown[index] === "`") {
      const run = runLength(markdown, index, "`");
      if (run === len) {
        return index + run;
      }
      index += run;
      continue;
    }
    if (markdown[index] === "\n" && markdown[index + 1] === "\n") {
      return -1;
    }
    index += 1;
  }
  return -1;
}

/**
 * 从 `at` 开始若能读出一个「合法标题 + 可选空白 + `)`」，
 * 返回标题结束后的下标；否则 -1。只做判断，不产出字符串。
 */
function titleEndAt(markdown: string, at: number): number {
  const quote = markdown[at];
  let end = -1;
  if (quote === '"' || quote === "'") {
    let index = at + 1;
    while (index < markdown.length && markdown[index] !== quote) {
      index += markdown[index] === "\\" ? 2 : 1;
    }
    if (index >= markdown.length) {
      return -1;
    }
    end = index + 1;
  } else if (quote === "(") {
    let index = at + 1;
    let depth = 1;
    while (index < markdown.length) {
      if (markdown[index] === "(") {
        depth += 1;
      } else if (markdown[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
      index += 1;
    }
    if (index >= markdown.length) {
      return -1;
    }
    end = index + 1;
  } else {
    return -1;
  }

  let index = end;
  while (index < markdown.length && isSpace(markdown[index])) {
    index += 1;
  }
  return markdown[index] === ")" ? end : -1;
}

/**
 * 解析 `[` 开始的一整条链接；`open` 必须指向 `[`。
 * 结构不完整（没有配对的 `]`、没有 `(`、没有收尾 `)`）一律返回 null，
 * 由调用方从 `open + 1` 继续扫 —— 这样 `[[a](b)](c)` 这种嵌套也不会漏。
 */
function parseLink(markdown: string, open: number): Omit<LinkMatch, "kind" | "start"> | null {
  const n = markdown.length;

  // 1. 方括号配对
  let depth = 1;
  let index = open + 1;
  while (index < n) {
    const ch = markdown[index];
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
    index += 1;
  }
  if (depth !== 0) {
    return null;
  }
  const close = index;
  const text = markdown.slice(open + 1, close);

  // 2. 必须是 `](`
  if (markdown[close + 1] !== "(") {
    return null;
  }

  let cursor = close + 2;
  while (cursor < n && isSpace(markdown[cursor])) {
    cursor += 1;
  }

  let ref = "";
  const angle = markdown[cursor] === "<";
  if (angle) {
    const start = cursor + 1;
    cursor = start;
    while (cursor < n && markdown[cursor] !== ">" && markdown[cursor] !== "\n") {
      cursor += markdown[cursor] === "\\" ? 2 : 1;
    }
    if (cursor >= n || markdown[cursor] !== ">") {
      return null;
    }
    ref = unescapeRef(markdown.slice(start, cursor));
    cursor += 1;
  } else {
    // 裸地址：圆括号按深度计入，空白只在「后面跟着标题或收尾」时才算分隔符
    const start = cursor;
    let refEnd = -1;
    let paren = 0;
    while (cursor < n) {
      const ch = markdown[cursor];
      if (ch === "\\") {
        cursor += 2;
        continue;
      }
      if (ch === "(") {
        paren += 1;
        cursor += 1;
        continue;
      }
      if (ch === ")") {
        if (paren === 0) {
          refEnd = cursor;
          break;
        }
        paren -= 1;
        cursor += 1;
        continue;
      }
      if (isSpace(ch)) {
        let next = cursor;
        while (next < n && isSpace(markdown[next])) {
          next += 1;
        }
        const following = markdown[next] ?? "";
        // 空白后面是 `)` → 地址到此为止；是标题开头且整段标题成立 → 也到此为止；
        // 其余情况把这块空白当路径的一部分（`讲义 2024.pdf`）
        if (following === ")" || (following !== "" && titleEndAt(markdown, next) > 0)) {
          refEnd = cursor;
          cursor = next;
          break;
        }
        cursor = next;
        continue;
      }
      cursor += 1;
    }
    if (refEnd < 0) {
      return null;
    }
    ref = unescapeRef(markdown.slice(start, refEnd));
  }

  // 3. 收尾：可选标题 + `)`
  let tail = cursor;
  while (tail < n && isSpace(markdown[tail])) {
    tail += 1;
  }
  let title = "";
  if (markdown[tail] !== ")") {
    const titleEnd = titleEndAt(markdown, tail);
    if (titleEnd < 0) {
      return null;
    }
    title = ` ${markdown.slice(tail, titleEnd)}`;
    tail = titleEnd;
    while (tail < n && isSpace(markdown[tail])) {
      tail += 1;
    }
  }
  if (markdown[tail] !== ")") {
    return null;
  }

  return { end: tail + 1, text, ref, title };
}

/** 从左到右扫一遍，返回所有行内链接（按出现顺序、互不重叠） */
export function scanLinks(markdown: string): LinkMatch[] {
  const out: LinkMatch[] = [];
  const fenced = fencedRanges(markdown);
  let fenceIndex = 0;
  let index = 0;

  while (index < markdown.length) {
    // 围栏整段跳过
    while (fenceIndex < fenced.length && fenced[fenceIndex][1] <= index) {
      fenceIndex += 1;
    }
    if (fenceIndex < fenced.length && fenced[fenceIndex][0] <= index) {
      index = fenced[fenceIndex][1];
      fenceIndex += 1;
      continue;
    }

    const ch = markdown[index];
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === "`") {
      const run = runLength(markdown, index, "`");
      const end = codeSpanEnd(markdown, index + run, run);
      index = end < 0 ? index + run : end;
      continue;
    }
    if (ch === "[") {
      const parsed = parseLink(markdown, index);
      if (parsed) {
        const bang = index > 0 && markdown[index - 1] === "!" && markdown[index - 2] !== "\\";
        out.push({ ...parsed, kind: bang ? "image" : "link", start: bang ? index - 1 : index });
        index = parsed.end;
        continue;
      }
    }
    index += 1;
  }

  return out;
}

/**
 * 代码区间：围栏块 + 行内代码，按起点升序、互不重叠。
 * `scanLinks` 内部靠「边走边跳过」，但 Obsidian 的 `![[...]]` 是另一套语法、
 * 在 assets.ts 里单独扫，所以需要一个能按标号判断「这段在不在代码里」的工具。
 */
export function codeRanges(markdown: string): Array<[number, number]> {
  const ranges = fencedRanges(markdown);
  const covered = (index: number) => ranges.some(([start, end]) => index >= start && index < end);

  let index = 0;
  while (index < markdown.length) {
    if (markdown[index] !== "`" || covered(index)) {
      index += 1;
      continue;
    }
    const run = runLength(markdown, index, "`");
    const end = codeSpanEnd(markdown, index + run, run);
    if (end < 0) {
      index += run;
      continue;
    }
    ranges.push([index, end]);
    index = end;
  }

  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

/** 下标是否落在代码区间里（ranges 来自 codeRanges） */
export function inCode(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}
