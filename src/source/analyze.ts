import type { LogBatch } from "../logger";
import { m } from "../i18n";
import { summarizeExts } from "../labels";
import { nodeFs, nodeRequire } from "../platform";
import { unpackZip } from "./archive";
import { createArchiveAssetReader, createDiskAssetReader } from "./assetReader";
import type { AssetReader } from "./assetReader";
import { extOf, isMarkdownName, MAX_FILES, walkFolder } from "./fsWalk";

export interface MdSource {
  /** 拖进来的散文件有 File；文件夹里读出来的没有，按 path 走 fs */
  file?: File;
  name: string;
  path: string;
  size: number;
  /** 相对投放目标的目录段（已含被拖文件夹自身那层） */
  dirs: string[];
  /** 从压缩包解出来的内容直接放在内存里，没有磁盘路径 */
  bytes?: Uint8Array;
  /** 读正文里引用的图片：磁盘按所在目录解析，压缩包按包内路径解析 */
  assets?: AssetReader;
}

/** 结构化原因码：文案会跟着界面语言变，判断逻辑只能看它 */
export type RejectCode = "same-name" | "export-package" | "archive-no-md";

export interface RejectedSource {
  name: string;
  reason: string;
  /** 归类用：卡片要据此说清「是不支持，不是没内容」 */
  kind: "folder" | "archive" | "other" | "empty" | "image";
  code?: RejectCode;
}

export interface AnalyzeResult {
  md: MdSource[];
  rejected: RejectedSource[];
}

const ARCHIVE_EXT = new Set([".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz"]);

/**
 * 取真实路径：Electron 的 webUtils.getPathForFile —— 和思源官方处理外部拖拽的方式一致。
 * M0 已确认 nodeIntegration = true，这条路在桌面端可用；拿不到就退回 File 对象本身
 * （散文件正文仍能读，只是判断不了文件夹）。
 */
let webUtils: any;
/** 每份 File 只问一次：一次拖入里 pathOf 会被调用两三遍（读提示 / 分析 / 日志） */
const PATH_CACHE = new WeakMap<File, string>();

function pathOf(file: File): string {
  const cached = PATH_CACHE.get(file);
  if (cached !== undefined) {
    return cached;
  }
  if (webUtils === undefined) {
    webUtils = nodeRequire<any>("electron")?.webUtils ?? null;
  }
  let path = "";
  if (webUtils?.getPathForFile) {
    try {
      path = webUtils.getPathForFile(file) ?? "";
    } catch {
      path = "";
    }
  }
  PATH_CACHE.set(file, path);
  return path;
}

function statIsDirectory(path: string): boolean {
  if (!path) {
    return false;
  }
  const fs = nodeFs();
  if (!fs) {
    return false;
  }
  try {
    return Boolean(fs.statSync(path).isDirectory());
  } catch {
    // 无权限 / 已被移走：交给后续读文件时报错，这里不下结论
    return false;
  }
}

function describeRead(error: unknown): string {
  const message = String((error as any)?.message ?? error);
  if (/EACCES|EPERM/.test(message)) {
    return m().walk.noPermission;
  }
  if (/ENOENT/.test(message)) {
    return m().error.notFound;
  }
  return message || m().walk.readFailed;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/**
 * 这次拖入会不会让界面卡一下（解压 / 遍历文件夹都是**同步**的）。
 * 调用方拿到非空结果就先铺一张「正在读取…」卡片、让出一帧，再跑 analyzeSources；
 * 否则卡片要等同步工作全部做完才有机会绘制，用户看到的就是「拖进去没反应」。
 */
/** 读取阶段先给哪句提示：解压、还是遍历文件夹（都不需要就 null） */
export type PendingStage = "unzip" | "folder";

export function pendingReadHint(files: File[]): PendingStage | null {
  let stage: PendingStage | null = null;
  for (const file of files) {
    const name = (file.name || "").toLowerCase();
    // .sy.zip 是思源导出包，会被直接拒掉，不该先闪一下「解压中」
    if (name.endsWith(".sy.zip")) {
      continue;
    }
    if (name.endsWith(".zip")) {
      return "unzip";
    }
    if (statIsDirectory(pathOf(file))) {
      stage = "folder";
    }
  }
  return stage;
}

/** 文件夹 → md 清单 + 汇总后的跳过项（不是每个 png 都占一行） */
function collectFolder(folderPath: string, folderName: string, batch: LogBatch | null): AnalyzeResult {
  const walked = walkFolder(folderPath);
  const md: MdSource[] = [];
  const rejected: RejectedSource[] = [];

  for (const file of walked.files) {
    md.push({
      name: file.name,
      path: file.path,
      size: file.size,
      // 被拖的文件夹自己也是一层父文档（设计 §5.2）
      dirs: [folderName, ...file.dirs],
      assets: createDiskAssetReader(file.path, folderPath) ?? undefined,
    });
  }

  if (md.length === 0) {
    // 一个 md 都没有，先分清「读不了」和「里面真没有」
    if (walked.problems.length > 0) {
      rejected.push({ name: folderName, reason: walked.problems[0].reason, kind: "folder" });
    } else {
      rejected.push({ name: folderName, reason: m().reject.folderNoMd, kind: "empty" });
    }
    batch?.event("analyze", "skip", { file: folderName, result: "empty-folder", path: folderPath });
    return { md, rejected };
  }

  const text = m();
  const nonMdTypes = summarizeExts(walked.nonMdKinds);
  if (walked.nonMd > 0) {
    rejected.push({
      name: text.skip.nonMd(walked.nonMd, nonMdTypes),
      reason: text.skip.nonMdReason,
      kind: "other",
    });
  }
  const assetTypes = summarizeExts(walked.assetKinds);
  if (walked.assets > 0) {
    rejected.push({
      name: text.skip.assets(walked.assets, assetTypes),
      reason: text.skip.assetsReason,
      kind: "other",
    });
  }
  if (walked.emptyDirs.length > 0) {
    const shown = walked.emptyDirs.slice(0, 3);
    const rest = walked.emptyDirs.length - shown.length;
    rejected.push({
      name: text.skip.emptyDirs(shown.join(text.common.listSep), rest, walked.emptyDirs.length),
      reason: text.skip.emptyDirsReason,
      kind: "empty",
    });
  }
  for (const problem of walked.problems) {
    rejected.push({ name: problem.name, reason: problem.reason, kind: "folder" });
  }
  if (walked.truncated) {
    rejected.push({
      name: text.skip.truncated(MAX_FILES),
      reason: text.skip.truncatedReason,
      kind: "other",
    });
  }

  batch?.event("analyze", "folder", {
    folder: folderName,
    path: folderPath,
    md: md.length,
    nonMd: walked.nonMd,
    assets: walked.assets,
    emptyDirs: walked.emptyDirs.length,
    ignoredDirs: walked.ignoredDirs,
    problems: walked.problems.length,
    truncated: walked.truncated,
  });

  return { md, rejected };
}

/** DataTransfer 的 File 列表 → 可导入的 md + 明确的不支持清单 */
export function analyzeSources(files: File[], batch: LogBatch | null): AnalyzeResult {
  const md: MdSource[] = [];
  const rejected: RejectedSource[] = [];

  for (const file of files) {
    const path = pathOf(file);
    const name = (file.name || baseName(path) || "").trim() || m().reject.untitledFile;

    if (statIsDirectory(path)) {
      const folder = collectFolder(path, name, batch);
      md.push(...folder.md);
      rejected.push(...folder.rejected);
      continue;
    }

    const ext = extOf(name);

    if (name.toLowerCase().endsWith(".sy.zip")) {
      // 思源导出包有自己的还原逻辑，不该走「建文档」这条路
      rejected.push({ name, reason: m().reject.siyuanExport, kind: "archive", code: "export-package" });
      batch?.event("analyze", "skip", { file: name, result: "sy-zip", path });
      continue;
    }

    if (ext === ".zip") {
      const fs = nodeFs();
      if (!fs || !path) {
        rejected.push({ name, reason: m().reject.noPath, kind: "archive" });
        batch?.event("analyze", "skip", { file: name, result: "archive-no-path", path });
        continue;
      }

      let raw: Uint8Array;
      try {
        raw = fs.readFileSync(path);
      } catch (error) {
        rejected.push({ name, reason: describeRead(error), kind: "archive" });
        continue;
      }

      const archive = unpackZip(name, raw);
      if (archive.fatal) {
        rejected.push({ name, reason: archive.fatal, kind: "archive" });
        batch?.event("analyze", "skip", { file: name, result: "archive-bad", err: archive.fatal, path });
        continue;
      }
      if (archive.files.length === 0) {
        rejected.push({ name, reason: m().reject.archiveNoMd, kind: "archive", code: "archive-no-md" });
        batch?.event("analyze", "skip", { file: name, result: "archive-empty", path });
        continue;
      }

      for (const file of archive.files) {
        md.push({
          name: file.name,
          path: "",
          size: file.size,
          dirs: file.dirs,
          bytes: file.bytes,
          assets: createArchiveAssetReader(raw, archive.entries, file.origin),
        });
      }
      if (archive.nonMd > 0) {
        const types = summarizeExts(archive.nonMdKinds);
        rejected.push({
          name: m().skip.nonMd(archive.nonMd, types),
          reason: m().skip.nonMdReason,
          kind: "other",
        });
      }
      if (archive.assets > 0) {
        const types = summarizeExts(archive.assetKinds);
        rejected.push({
          name: m().skip.assets(archive.assets, types),
          reason: m().skip.assetsReason,
          kind: "other",
        });
      }
      rejected.push(...archive.problems);
      batch?.event("analyze", "archive", {
        file: name,
        path,
        bytes: raw.length,
        md: archive.files.length,
        nonMd: archive.nonMd,
        assets: archive.assets,
      });
      continue;
    }

    if (isMarkdownName(name)) {
      md.push({
        file,
        name,
        path,
        size: file.size,
        dirs: [],
        assets: createDiskAssetReader(path) ?? undefined,
      });
      batch?.event("analyze", "accept", { file: name, result: "markdown", size: file.size, path });
      continue;
    }

    if (ARCHIVE_EXT.has(ext)) {
      rejected.push({ name, reason: m().reject.onlyZip, kind: "archive" });
      batch?.event("analyze", "skip", { file: name, result: "archive", path });
      continue;
    }

    const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif", ".heic"]);
    rejected.push({
      name,
      reason: m().reject.notMarkdown(ext),
      kind: imageExts.has(ext) ? "image" : "other",
    });
    batch?.event("analyze", "skip", { file: name, result: "other", path });
  }

  return { md, rejected };
}
