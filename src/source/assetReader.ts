import { nodeFs, nodePath } from "../platform";
import { extractEntry } from "./zip";
import type { ZipEntry } from "./zip";

export interface AssetBlob {
  name: string;
  bytes: Uint8Array;
  /** 批次内去重用：磁盘绝对路径 / 包内条目路径 */
  key: string;
}

export interface AssetReader {
  /** 相对 md 所在目录的引用路径；读不到返回 null */
  read(relative: string): AssetBlob | null;
}

/** 去掉尖括号、URL 编码、#anchor；把 file:/// 绝对路径还原成本地路径 */
export function normalizeAssetRef(relative: string): string {
  let value = relative.replace(/^</, "").replace(/>$/, "").split("#")[0].trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // 不是合法编码（比如路径里本来就有 %）就按原样用
  }
  // 从 Word / 浏览器 / Typora 复制出来的正文常写 file:///C:/x/a.png，
  // 直接丢给 path.resolve 会拼出「…\file:\C:\x\a.png」这种不存在的路径。
  if (/^file:\/\//i.test(value)) {
    value = value.replace(/^file:\/\//i, "");
    if (/^\/[a-zA-Z]:[\\/]/.test(value)) {
      value = value.slice(1); // file:///C:/x → C:/x
    } else if (!value.startsWith("/")) {
      value = `//${value}`; // file://server/share/x → UNC
    }
  }
  return value;
}

/** Obsidian 常把图片放在这些子目录里，正文只写文件名 */
const ATTACHMENT_DIRS = ["assets", "attachments", "img", "images", "static"];

/**
 * 只写了文件名时，还要在被拖的文件夹里找一遍：
 * Obsidian 的 `![[a.pdf]]` 就是这么写的，附件目录还可能叫「附件」这种自定义名字。
 * 建索引一次，整个批次复用（按被拖的根目录缓存）。
 */
const INDEX_DEPTH = 3;
const INDEX_LIMIT = 4000;
const INDEX_CACHE = new Map<string, Map<string, string>>();

function buildIndex(root: string): Map<string, string> {
  const fs = nodeFs();
  const pathMod = nodePath();
  const index = new Map<string, string>();
  if (!fs || !pathMod) {
    return index;
  }
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let seen = 0;
  while (queue.length > 0 && seen < INDEX_LIMIT) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    let entries: any[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = String(entry.name);
      if (entry.isDirectory()) {
        if (current.depth + 1 <= INDEX_DEPTH && !name.startsWith(".") && name !== "node_modules") {
          queue.push({ dir: pathMod.join(current.dir, name), depth: current.depth + 1 });
        }
        continue;
      }
      seen += 1;
      // 浅的先入队，同名的取最浅一处（和 Obsidian 的解析顺序一致）
      if (!index.has(name)) {
        index.set(name, pathMod.join(current.dir, name));
      }
    }
  }
  return index;
}

function indexFor(root: string): Map<string, string> {
  const cached = INDEX_CACHE.get(root);
  if (cached) {
    return cached;
  }
  const index = buildIndex(root);
  if (INDEX_CACHE.size >= 4) {
    INDEX_CACHE.clear();
  }
  INDEX_CACHE.set(root, index);
  return index;
}

/** 磁盘上的 md：按它所在目录解析相对路径 */
export function createDiskAssetReader(mdPath: string, searchRoot?: string): AssetReader | null {
  const fs = nodeFs();
  const pathMod = nodePath();
  if (!fs || !pathMod || !mdPath) {
    return null;
  }
  const baseDir = pathMod.dirname(mdPath);
  // 被拖的是文件夹时，整棵文件夹（含它的子目录）也算查找范围。
  // 注意 md 常常就在根目录里，这里不能用「root !== baseDir」把它排除掉。
  const root = searchRoot || "";
  return {
    read(relative: string): AssetBlob | null {
      const ref = normalizeAssetRef(relative);
      if (!ref) {
        return null;
      }
      const bare = !/[\\/]/.test(ref);
      const candidates: string[] = [pathMod.resolve(baseDir, ref)];
      // 只写了文件名时，再往常见附件目录里找一遍
      if (bare) {
        for (const dir of ATTACHMENT_DIRS) {
          candidates.push(pathMod.resolve(baseDir, dir, ref));
        }
      }
      for (const full of candidates) {
        try {
          const bytes: Uint8Array = fs.readFileSync(full);
          return { name: pathMod.basename(full), bytes, key: full };
        } catch {
          // 继续试下一个候选
        }
      }
      // 最后在整个被拖的文件夹里按文件名找（Obsidian 的 ![[a.pdf]] 常指向自定义附件目录）
      if (root && bare) {
        const hit = indexFor(root).get(ref);
        if (hit) {
          try {
            const bytes: Uint8Array = fs.readFileSync(hit);
            return { name: pathMod.basename(hit), bytes, key: hit };
          } catch {
            return null;
          }
        }
      }
      return null;
    },
  };
}

/** 压缩包里的 md：按包内相对路径找条目 */
export function createArchiveAssetReader(
  raw: Uint8Array,
  entries: Map<string, ZipEntry>,
  origin: string,
): AssetReader {
  const baseSegments = origin.split("/").slice(0, -1);
  return {
    read(relative: string): AssetBlob | null {
      const ref = normalizeAssetRef(relative).replace(/\\/g, "/");
      if (!ref) {
        return null;
      }
      const segments = [...baseSegments];
      for (const segment of ref.split("/")) {
        if (!segment || segment === ".") {
          continue;
        }
        if (segment === "..") {
          if (segments.length === 0) {
            return null;
          }
          segments.pop();
          continue;
        }
        segments.push(segment);
      }
      let key = segments.join("/");
      let entry = entries.get(key);

      // 只写文件名：在包内按名字找唯一匹配
      if (!entry && !ref.includes("/")) {
        const matches: string[] = [];
        for (const name of entries.keys()) {
          const base = name.split("/").pop();
          if (base === ref) {
            matches.push(name);
          }
        }
        if (matches.length === 1) {
          key = matches[0];
          entry = entries.get(key);
        }
      }

      if (!entry) {
        return null;
      }
      try {
        return { name: segments[segments.length - 1], bytes: extractEntry(raw, entry), key };
      } catch {
        return null;
      }
    },
  };
}
