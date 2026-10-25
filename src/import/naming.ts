import { m } from "../i18n";
/**
 * 文档命名。顺序不能乱：先归一化再清洗，最后才截断——
 * 顺序反了会出现「截断后又被清洗成空」这种边角。
 */

/** 内核不截断标题（M0：300 字原样保留），我们自己兜住 */
export const MAX_NAME_LENGTH = 120;

const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function stripExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}

/**
 * 名字清洗的公共部分：NFC → 剔除 . / .. 段 → 非法字符 → 去首尾空白与结尾点
 * → 保留名前缀 → 空名兜底 → 截断。
 * 文件与目录只有「要不要去扩展名」这一处差别。
 */
function sanitize(raw: string): string {
  let name = raw.normalize("NFC");

  // `..` 会被内核当成路径上跳（M0 实测 /边界/../逃逸 直接建到根层）
  name = name
    .split(/[\\/]/)
    .filter((segment) => segment !== "." && segment !== "..")
    .join("_");

  name = name.replace(ILLEGAL_CHARS, "_");
  name = name.replace(/^\s+/, "").replace(/[.\s]+$/, "");

  if (RESERVED_NAMES.test(name)) {
    name = `_${name}`;
  }

  if (!name) {
    name = m().reject.untitled;
  }

  if (name.length > MAX_NAME_LENGTH) {
    name = `${name.slice(0, MAX_NAME_LENGTH)}…`;
  }

  return name;
}

/** 文件名 → 文档名（去扩展名） */
export function cleanName(raw: string): string {
  return sanitize(stripExtension(raw));
}

/**
 * 目录名 → 父文档名。
 * 不能去扩展名：`v1.2` 这种目录名去掉 `.2` 就变味了。
 */
export function cleanDirName(raw: string): string {
  return sanitize(raw);
}

/** 判重口径：NFC + 去首尾空白 + 小写（Windows 文件系统本身大小写不敏感） */
export function normalizeKey(name: string): string {
  return name.normalize("NFC").trim().toLowerCase();
}

/** 重名追加 " (2)"、(3)…；同时保证拼完仍不超长 */
export function withSuffix(base: string, index: number): string {
  if (index <= 1) {
    return base;
  }
  const suffix = ` (${index})`;
  const room = Math.max(2, MAX_NAME_LENGTH + 1 - suffix.length);
  let head = base;
  if (head.length > room) {
    head = `${head.replace(/…$/, "").slice(0, room - 1)}…`;
  }
  return `${head}${suffix}`;
}
