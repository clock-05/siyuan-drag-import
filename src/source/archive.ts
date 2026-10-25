/**
 * 压缩包 → 待导入的 md 清单。
 * 整包先校验、后解压、最后才建文档：任何一步失败都「一篇都不建」，
 * 不搞「能解多少算多少」——半棵树比没有更难收拾（设计 §4.3）。
 */

import { m } from "../i18n";
import type { RejectedSource } from "./analyze";
import { addKind, ASSET_DIRS, isIgnoredDir, isJunkFile, isMarkdownName } from "./fsWalk";
import { ArchiveError, extractEntry, MAX_ARCHIVE_BYTES, parseZip } from "./zip";
import type { ZipEntry } from "./zip";

export interface ArchiveFile {
  name: string;
  size: number;
  /** 相对投放目标的目录段（已含压缩包/顶层目录那层） */
  dirs: string[];
  bytes: Uint8Array;
  /** 包内原始路径，用来解析 md 里引用的图片 */
  origin: string;
}

export interface ArchiveResult {
  files: ArchiveFile[];
  nonMd: number;
  assets: number;
  /** 上面两类文件按扩展名计数，卡片用来说清「是 PDF 还是别的」 */
  nonMdKinds: Record<string, number>;
  assetKinds: Record<string, number>;
  problems: RejectedSource[];
  /** 包内全部文件条目（含图片），供链接重写时取字节 */
  entries: Map<string, ZipEntry>;
  /** 整包拒收的原因；有值就不要用 files */
  fatal?: string;
}

/** 单篇上限与 executor 保持一致 */
const MAX_SINGLE = 20 * 1024 * 1024;

function stripExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}

function emptyResult(fatal?: string): ArchiveResult {
  return {
    files: [],
    nonMd: 0,
    assets: 0,
    nonMdKinds: {},
    assetKinds: {},
    problems: [],
    entries: new Map(),
    fatal,
  };
}

export function unpackZip(archiveName: string, bytes: Uint8Array): ArchiveResult {
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    return emptyResult(
      m().archive.tooBig(
        Math.round(MAX_ARCHIVE_BYTES / 1024 / 1024),
        Math.round(bytes.length / 1024 / 1024),
      ),
    );
  }

  let parsed;
  try {
    parsed = parseZip(bytes);
  } catch (error) {
    return emptyResult(error instanceof ArchiveError ? error.message : m().archive.broken);
  }

  const files: ArchiveFile[] = [];
  const problems: RejectedSource[] = [];
  const nonMdKinds: Record<string, number> = {};
  const assetKinds: Record<string, number> = {};
  let nonMd = 0;
  let assets = 0;

  const kept: { entry: (typeof parsed.entries)[number]; segments: string[] }[] = [];

  for (const entry of parsed.entries) {
    if (entry.isDirectory) {
      continue;
    }
    const segments = entry.name.split("/");
    const fileName = segments[segments.length - 1] ?? "";
    const dirs = segments.slice(0, -1);

    // 系统垃圾：不计数、不报告（设计 §4.3）
    if (isJunkFile(fileName) || dirs.some((dir) => isIgnoredDir(dir))) {
      continue;
    }
    if (dirs.some((dir) => ASSET_DIRS.has(dir.toLowerCase()))) {
      assets += 1;
      addKind(assetKinds, fileName);
      continue;
    }
    if (!isMarkdownName(fileName)) {
      nonMd += 1;
      addKind(nonMdKinds, fileName);
      continue;
    }
    if (entry.size > MAX_SINGLE) {
      problems.push({ name: entry.name, reason: m().archive.itemTooBig(Math.round(MAX_SINGLE / 1024 / 1024)), kind: "other" });
      continue;
    }
    kept.push({ entry, segments });
  }

  const entries = new Map<string, ZipEntry>();
  for (const entry of parsed.entries) {
    if (!entry.isDirectory) {
      entries.set(entry.name, entry);
    }
  }

  if (kept.length === 0) {
    return { files, nonMd, assets, nonMdKinds, assetKinds, problems, entries };
  }

  // 顶层结构：只有一个顶层目录时以它为根，避免 7-zip 常见的「压缩包同名 / 目录 / 内容」双层套娃
  const topLevels = new Set(kept.map((item) => item.segments[0]));
  const singleTopDir = topLevels.size === 1 && kept.every((item) => item.segments.length > 1);
  const fallbackRoot = stripExtension(archiveName);

  try {
    for (const item of kept) {
      const content = extractEntry(bytes, item.entry);
      const fileName = item.segments[item.segments.length - 1];
      const dirs = singleTopDir
        ? item.segments.slice(0, -1)
        : [fallbackRoot, ...item.segments.slice(0, -1)];
      files.push({
        name: fileName,
        size: content.byteLength,
        dirs,
        bytes: content,
        origin: item.segments.join("/"),
      });
    }
  } catch (error) {
    // 解压到一半失败：整包作废，别把前半截写进库
    return emptyResult(error instanceof ArchiveError ? error.message : m().archive.failed);
  }

  return { files, nonMd, assets, nonMdKinds, assetKinds, problems, entries };
}
