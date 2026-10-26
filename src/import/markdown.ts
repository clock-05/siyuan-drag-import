import { m } from "../i18n";
/**
 * md 读取与转换。M1 只做三件事：编码兜底、剥 frontmatter、去重复首行 H1。
 * 图片上传、公式、callout 都留给 M4 / 后续。
 */

export type Encoding = "utf-8" | "utf-8-bom" | "gbk";

export interface ParsedDoc {
  markdown: string;
  encoding: Encoding;
  removedFrontmatter: boolean;
  removedH1: boolean;
}

/** 统一成 Uint8Array：ArrayBuffer（散文件）和 Buffer/Uint8Array（文件夹读盘）都收 */
function toBytes(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(input);
}

/**
 * 绝不用 File.text()：它假定 UTF-8，GBK 文件会静默变成乱码入库，比报错更糟。
 * 先按 UTF-8 严格解，失败再退 GBK（覆盖 GB2312/GBK/GB18030）。
 */
export function decodeBytes(input: ArrayBuffer | ArrayBufferView): { text: string; encoding: Encoding } {
  const bytes = toBytes(input);
  let offset = 0;
  let encoding: Encoding = "utf-8";
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
    encoding = "utf-8-bom";
  }
  const body = bytes.subarray(offset);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    text = new TextDecoder("gbk").decode(body);
    encoding = "gbk";
  }

  if (text.includes("\u0000")) {
    throw new Error(m().reject.binary);
  }

  return { text, encoding };
}

/** 只剥文档最开头的成对 --- 块；正文中间的 --- 是分隔线，不能动 */
export function stripFrontmatter(text: string): { text: string; removed: boolean } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) {
    return { text, removed: false };
  }
  // frontmatter 后面通常跟一个空行，留着会让正文从第二行开始
  return { text: text.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, ""), removed: true };
}

function normalizeLabel(value: string): string {
  return value
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase();
}

/** 首行唯一 H1 且与文档名相似 → 去掉（思源文档名已经在树上显示了） */
export function stripDuplicateH1(text: string, docName: string): { text: string; removed: boolean } {
  const lines = text.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }
  if (index >= lines.length) {
    return { text, removed: false };
  }

  const match = /^#\s+(.+?)\s*#*\s*$/.exec(lines[index]);
  if (!match) {
    return { text, removed: false };
  }

  const heading = normalizeLabel(match[1]);
  const name = normalizeLabel(docName);
  if (!heading || !name) {
    return { text, removed: false };
  }

  // 互为前缀也算同一个标题，但只容忍几个字的差异，免得把真正的章节标题吃掉
  const similar =
    heading === name ||
    (heading.startsWith(name) && heading.length - name.length <= 8) ||
    (name.startsWith(heading) && name.length - heading.length <= 8);
  if (!similar) {
    return { text, removed: false };
  }

  lines.splice(index, 1);
  while (lines.length > 0 && lines[0].trim() === "") {
    lines.shift();
  }
  return { text: lines.join("\n"), removed: true };
}

export interface ParseOptions {
  removeDuplicateH1?: boolean;
}

export function parseMarkdown(
  input: ArrayBuffer | ArrayBufferView,
  docName: string,
  options: ParseOptions = {},
): ParsedDoc {
  const decoded = decodeBytes(input);
  // frontmatter 永远剥：思源不解析 YAML，留着就是正文顶上挂两条分隔线加一段原文，
  // 没有第二种合理结果，所以不做成设置项。
  const frontmatter = stripFrontmatter(decoded.text);
  const h1 =
    options.removeDuplicateH1 === false
      ? { text: frontmatter.text, removed: false }
      : stripDuplicateH1(frontmatter.text, docName);
  return {
    markdown: h1.text,
    encoding: decoded.encoding,
    removedFrontmatter: frontmatter.removed,
    removedH1: h1.removed,
  };
}
