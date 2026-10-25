/**
 * 自己解 ZIP，不用 fflate 的 unzipSync —— 因为中文用户的包大概率没置 UTF-8 标志位，
 * 文件名是 GBK。fflate 会先按 UTF-8 解码成乱码，原始字节就丢了，事后无法补救。
 * 这里读中央目录拿到原始字节，按「UTF-8 严格解 → 失败退 GBK」自己解码，
 * 顺带在同一处做加密位、路径穿越、条目数与体积的闸门。
 *
 * 解压只解 .md 条目：图片附件 M4 才上传，没必要占内存。
 */

import { m } from "../i18n";
import { inflateSync } from "fflate";

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

export interface ZipEntry {
  /** 解码并归一化后的路径（统一用 /） */
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  isDirectory: boolean;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** 设计 §4.3 的上限 */
export const MAX_ENTRIES = 5000;
export const MAX_TOTAL_SIZE = 500 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** 从尾部倒着找 EOCD（注释最长 65535） */
function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function decodeName(raw: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) {
    return new TextDecoder("utf-8").decode(raw);
  }
  try {
    // 有些工具写了 UTF-8 却没置标志位，先严格试一把
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder("gbk").decode(raw);
  }
}

/** 归一化 + 安全校验；返回 null 表示这条是目录，不需要导入 */
function normalizeEntryName(name: string): string | null {
  const normalized = name.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.includes("\u0000")) {
    throw new ArchiveError(m().archive.badName);
  }
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new ArchiveError(m().archive.absolutePath);
  }
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new ArchiveError(m().archive.parentPath);
  }
  if (segments.length === 0) {
    return null;
  }
  return segments.join("/");
}

export interface ParsedZip {
  entries: ZipEntry[];
  /** 解压后总大小（用于闸门与提示） */
  totalSize: number;
}

export function parseZip(bytes: Uint8Array): ParsedZip {
  if (bytes.length < 22) {
    throw new ArchiveError(m().archive.tooShort);
  }
  const view = viewOf(bytes);
  const eocd = findEocd(view);
  if (eocd < 0) {
    throw new ArchiveError(m().archive.noCentral);
  }

  const count = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES) {
    throw new ArchiveError(m().archive.tooManyEntries(count, MAX_ENTRIES));
  }
  if (centralOffset >= bytes.length) {
    throw new ArchiveError(m().archive.centralRange);
  }

  const entries: ZipEntry[] = [];
  let totalSize = 0;
  let offset = centralOffset;

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new ArchiveError(m().archive.centralItem);
    }

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);

    if ((flags & 0x1) !== 0) {
      throw new ArchiveError(m().archive.encrypted);
    }
    if (method !== 0 && method !== 8) {
      throw new ArchiveError(m().archive.unsupportedMethod(method));
    }

    const decoded = decodeName(rawName, (flags & 0x800) !== 0);
    const isDirectory = decoded.endsWith("/") || decoded.endsWith("\\");
    const normalized = normalizeEntryName(decoded);

    if (normalized) {
      totalSize += size;
      entries.push({ name: normalized, method, compressedSize, size, localOffset, isDirectory });
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    throw new ArchiveError(
      m().archive.unpackedTooBig(
        Math.round(totalSize / 1024 / 1024),
        Math.round(MAX_TOTAL_SIZE / 1024 / 1024),
      ),
    );
  }

  return { entries, totalSize };
}

/** 解一条；只支持 store(0) 与 deflate(8) */
export function extractEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = viewOf(bytes);
  if (entry.localOffset + 30 > bytes.length || view.getUint32(entry.localOffset, true) !== LOCAL_SIGNATURE) {
    throw new ArchiveError(m().archive.badData);
  }
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) {
    throw new ArchiveError(m().archive.truncated);
  }
  const data = bytes.subarray(start, end);

  if (entry.method === 0) {
    return data;
  }
  try {
    return inflateSync(data);
  } catch {
    throw new ArchiveError(m().archive.broken);
  }
}
