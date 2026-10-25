import { m } from "../i18n";
import { nodeFs, nodePath } from "../platform";

export interface WalkedFile {
  path: string;
  name: string;
  size: number;
  /** 相对被拖文件夹根目录的各级目录名（原始名，清洗交给 planner） */
  dirs: string[];
}

export interface WalkProblem {
  name: string;
  reason: string;
}

export interface WalkResult {
  files: WalkedFile[];
  /** 文件夹里被忽略的非 md 文件数 */
  nonMd: number;
  /** 资产目录（assets/img/...）里被忽略的文件数 */
  assets: number;
  /** 上面两类文件按扩展名计数，卡片用来说清「是 PDF 还是别的」 */
  nonMdKinds: Record<string, number>;
  assetKinds: Record<string, number>;
  /** 最深一层的空目录（相对路径），用于卡片提示 */
  emptyDirs: string[];
  /** 被整棵跳过的隐藏目录 / node_modules，只进日志 */
  ignoredDirs: string[];
  problems: WalkProblem[];
  truncated: boolean;
}

export const MD_EXT = new Set([".md", ".markdown", ".mdown", ".mkd"]);

/** 设计 §9：这些目录名本身说明是资源，不建文档（M4 才上传） */
export const ASSET_DIRS = new Set(["assets", "attachments", "img", "images", "static"]);

const MAX_DEPTH = 20;
/** Windows 传统路径上限 260，留 1 位给结尾 */
const MAX_PATH = 259;
/** 一次拖入的 md 上限，防手滑拖进整个盘把思源卡死 */
export const MAX_FILES = 2000;

export function extOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index).toLowerCase();
}

export function isMarkdownName(name: string): boolean {
  return MD_EXT.has(extOf(name));
}

/** .git / .obsidian / node_modules 这类不可能是笔记的目录，直接不进 */
export function isIgnoredDir(name: string): boolean {
  return name.startsWith(".") || name === "node_modules" || name === "__MACOSX";
}

/** 系统垃圾文件，不计数也不报告（设计 §4.3 同口径） */
export function isJunkFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "thumbs.db" ||
    lower === "desktop.ini" ||
    lower === ".ds_store" ||
    name.startsWith("._")
  );
}

function describeFsError(error: unknown): string {
  const message = String((error as any)?.message ?? error);
  if (/EACCES|EPERM/.test(message)) {
    return m().walk.noPermission;
  }
  if (/ENOENT/.test(message)) {
    return m().walk.gone;
  }
  if (/ENAMETOOLONG/.test(message)) {
    return m().walk.pathTooLong;
  }
  return message || m().walk.readFailed;
}

function safeSize(fs: any, filePath: string): number {
  try {
    return Number(fs.statSync(filePath).size) || 0;
  } catch {
    return 0;
  }
}

/** 按扩展名累加，卡片据此说清文件类型 */
export function addKind(kinds: Record<string, number>, name: string): void {
  const ext = extOf(name);
  kinds[ext] = (kinds[ext] ?? 0) + 1;
}

function mergeKinds(target: Record<string, number>, source: Record<string, number>): void {
  for (const [ext, count] of Object.entries(source)) {
    target[ext] = (target[ext] ?? 0) + count;
  }
}

/** 只用来给「N 个图片/附件」计数，不需要精确 */
function countFilesDeep(
  fs: any,
  pathMod: any,
  dir: string,
  depth: number,
  kinds: Record<string, number>,
): number {
  if (depth > 6) {
    return 0;
  }
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        total += countFilesDeep(fs, pathMod, pathMod.join(dir, entry.name), depth + 1, kinds);
      } else {
        total += 1;
        addKind(kinds, String(entry.name));
      }
    }
  } catch {
    return total;
  }
  return total;
}

interface WalkState {
  count: number;
}

function walk(
  dir: string,
  dirs: string[],
  depth: number,
  fs: any,
  pathMod: any,
  state: WalkState,
): WalkResult {
  const out: WalkResult = {
    files: [],
    nonMd: 0,
    assets: 0,
    nonMdKinds: {},
    assetKinds: {},
    emptyDirs: [],
    ignoredDirs: [],
    problems: [],
    truncated: false,
  };

  let entries: any[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    out.problems.push({ name: dirs.length ? dirs.join("/") : dir, reason: describeFsError(error) });
    return out;
  }

  entries.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh"));

  for (const entry of entries) {
    if (state.count >= MAX_FILES) {
      out.truncated = true;
      break;
    }

    const name = String(entry.name);
    const full = pathMod.join(dir, name);

    if (full.length > MAX_PATH) {
      out.problems.push({ name, reason: m().walk.pathTooLong });
      continue;
    }
    if (entry.isSymbolicLink()) {
      out.problems.push({ name, reason: m().walk.symlink });
      continue;
    }

    if (entry.isDirectory()) {
      if (isIgnoredDir(name)) {
        out.ignoredDirs.push([...dirs, name].join("/"));
        continue;
      }
      if (ASSET_DIRS.has(name.toLowerCase())) {
        out.assets += countFilesDeep(fs, pathMod, full, 0, out.assetKinds);
        continue;
      }
      if (depth + 1 > MAX_DEPTH) {
        out.problems.push({ name, reason: m().walk.tooDeep });
        continue;
      }

      const sub = walk(full, [...dirs, name], depth + 1, fs, pathMod, state);
      out.problems.push(...sub.problems);
      out.assets += sub.assets;
      mergeKinds(out.assetKinds, sub.assetKinds);
      out.ignoredDirs.push(...sub.ignoredDirs);
      out.truncated = out.truncated || sub.truncated;

      if (sub.files.length === 0) {
        // 整棵子树没有 md：只报最上面这一处，里面的嵌套空目录不重复报
        out.emptyDirs.push([...dirs, name].join("/"));
      } else {
        out.files.push(...sub.files);
        out.nonMd += sub.nonMd;
        mergeKinds(out.nonMdKinds, sub.nonMdKinds);
        out.emptyDirs.push(...sub.emptyDirs);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }
    if (isJunkFile(name)) {
      continue;
    }
    if (isMarkdownName(name)) {
      state.count += 1;
      out.files.push({ path: full, name, size: safeSize(fs, full), dirs });
    } else {
      out.nonMd += 1;
      addKind(out.nonMdKinds, name);
    }
  }

  return out;
}

/** 递归读一个文件夹。拿不到 fs 时返回一条 problem，不抛错 */
export function walkFolder(root: string): WalkResult {
  const fs = nodeFs();
  const pathMod = nodePath();
  if (!fs || !pathMod) {
    return {
      files: [],
      nonMd: 0,
      assets: 0,
      nonMdKinds: {},
      assetKinds: {},
      emptyDirs: [],
      ignoredDirs: [],
      problems: [{ name: root, reason: m().walk.noFs }],
      truncated: false,
    };
  }
  return walk(root, [], 0, fs, pathMod, { count: 0 });
}
