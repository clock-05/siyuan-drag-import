import type { AssetBlob, AssetReader } from "../source/assetReader";
import { uploadAsset } from "./api";
import { codeRanges, inCode, scanLinks } from "./scanLinks";

export interface AssetCounter {
  uploaded: number;
  missing: number;
  failed: number;
}

/** 全部附件按扩展名细分（含图片），卡片靠它列出「.png、.pdf」 */
export type AssetKinds = Record<string, AssetCounter>;

export interface AssetStats {
  /** 正文里以图片语法引用的（`![]()` / `![[ ]]`），只用于内部判定 */
  images: AssetCounter;
  /** 普通链接指向的本地文件（pdf / docx / zip …），只用于内部判定 */
  files: AssetCounter;
  /** `{ ".pdf": {uploaded:1,...} }`，图片与文件都在这里 */
  kinds: AssetKinds;
}

export function emptyAssetStats(): AssetStats {
  return {
    images: { uploaded: 0, missing: 0, failed: 0 },
    files: { uploaded: 0, missing: 0, failed: 0 },
    kinds: {},
  };
}

export type AssetUploader = (name: string, bytes: Uint8Array) => Promise<string>;

/**
 * Obsidian 嵌入：`![[a.png]]` / `![[a.png|300]]` / `![[a.pdf#page=3]]`。
 * 文件名里可以有 `]`（真机上遇到 `![[[Zwonek 2012] ... .pdf]]`），
 * 所以不能把 `]` 排除在字符集外，只能惰性吃到最近的 `]]`。
 *
 * 标准语法（`![]()` / `[]()`）交给 scanLinks 的字符扫描器 —— 正则表达不了
 * 「链接文字里有方括号」「路径里有空格/圆括号」，见 scanLinks.ts 顶部注释。
 */
const EMBED_PATTERN = /!\[\[([^\n]+?)\]\]/g;
/** Obsidian 的 |300 / |300x200 是尺寸，不是 alt 文案 */
const SIZE_PATTERN = /^\d+(?:x\d+)?$/;
const REMOTE_PATTERN = /^(?:https?:)?\/\//i;
const DATA_URI_PATTERN = /^data:([^;,]+)?(;base64)?,/i;

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif", ".heic", ".ico"]);

/** 这个地址指向的是图片吗（data URI 按 mime 判） */
function isImageRef(ref: string): boolean {
  return IMAGE_EXT.has(extOf(ref)) || /^data:image\//i.test(ref);
}

/** 附件上限：再大就只保留链接，别让一次拖拽吃掉几百 MB 内存 */
const MAX_ASSET_BYTES = 50 * 1024 * 1024;

/** base64 解成字节；浏览器与 Node 都能跑 */
function decodeBase64(input: string): Uint8Array {
  const binary = atob(input.replace(/\s/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function extOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index).toLowerCase();
}

function counterFor(stats: AssetStats, name: string): AssetCounter {
  return IMAGE_EXT.has(extOf(name)) ? stats.images : stats.files;
}

/** 取（或建）某个扩展名的细分计数器；没有扩展名也记一笔，卡片会写成「无后缀」 */
function kindCounter(stats: AssetStats, name: string): AssetCounter {
  const ext = extOf(name);
  let counter = stats.kinds[ext];
  if (!counter) {
    counter = { uploaded: 0, missing: 0, failed: 0 };
    stats.kinds[ext] = counter;
  }
  return counter;
}

/** `![[a.pdf#page=3|别名]]` 拆成目标、子路径、别名 */
export function parseEmbed(inner: string): { target: string; alias: string } {
  const trimmed = inner.trim();
  const bar = trimmed.indexOf("|");
  const left = bar < 0 ? trimmed : trimmed.slice(0, bar);
  const alias = bar < 0 ? "" : trimmed.slice(bar + 1).trim();
  const hash = left.indexOf("#");
  const target = (hash < 0 ? left : left.slice(0, hash)).trim();
  return { target, alias };
}

/** 展示用：只留文件名，去掉目录 */
function baseName(ref: string): string {
  const normalized = ref.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? normalized : normalized.slice(index + 1);
}

/** 链接文字里的 `[` `]` 会破坏 Markdown 结构（`[Zwonek 2012] ....pdf` 这种文件名很常见） */
function escapeText(value: string): string {
  return value.replace(/[[\]]/g, "\\$&");
}

function isLocalRef(ref: string): boolean {
  if (!ref) {
    return false;
  }
  if (
    REMOTE_PATTERN.test(ref) ||
    ref.startsWith("siyuan://") ||
    ref.startsWith("assets/") ||
    ref.startsWith("#") ||
    ref.startsWith("mailto:") ||
    ref.startsWith("tel:")
  ) {
    return false;
  }
  return true;
}

/**
 * 解析一个本地引用并上传，返回内核给的 `assets/...` 路径；不需要/没成功则返回 null。
 * 缓存按真实路径（磁盘绝对路径 / 包内条目）去重，同一份文件只传一次。
 */
async function resolveRef(
  ref: string,
  reader: AssetReader | null,
  cache: Map<string, string | null>,
  stats: AssetStats,
  upload: AssetUploader,
): Promise<string | null> {
  if (!isLocalRef(ref)) {
    return null;
  }

  const dataUri = DATA_URI_PATTERN.exec(ref);
  if (dataUri) {
    if (!dataUri[2]) {
      return null;
    }
    const mime = dataUri[1] || "image/png";
    const ext = MIME_EXT[mime] ?? "png";
    const name = `image-${Date.now().toString(36)}-${stats.images.uploaded + stats.images.failed}.${ext}`;
    const kind = kindCounter(stats, name);
    try {
      const path = await upload(name, decodeBase64(ref.slice(dataUri[0].length)));
      stats.images.uploaded += 1;
      if (kind) kind.uploaded += 1;
      return path;
    } catch {
      stats.images.failed += 1;
      if (kind) kind.failed += 1;
      return null;
    }
  }

  const counter = counterFor(stats, ref);
  const kind = kindCounter(stats, ref);

  if (!reader) {
    return null;
  }

  const blob: AssetBlob | null = reader.read(ref);
  if (!blob) {
    counter.missing += 1;
    if (kind) kind.missing += 1;
    return null;
  }
  if (blob.bytes.byteLength > MAX_ASSET_BYTES) {
    counter.failed += 1;
    if (kind) kind.failed += 1;
    return null;
  }

  if (cache.has(blob.key)) {
    return cache.get(blob.key) ?? null;
  }

  // 附件按真实文件名归类（引用写的是 .png 就记图片）
  const target = counterFor(stats, blob.name);
  const targetKind = kindCounter(stats, blob.name);

  try {
    const path = await upload(blob.name, blob.bytes);
    cache.set(blob.key, path);
    target.uploaded += 1;
    if (targetKind) targetKind.uploaded += 1;
    return path;
  } catch {
    cache.set(blob.key, null);
    target.failed += 1;
    if (targetKind) targetKind.failed += 1;
    return null;
  }
}

/**
 * 把正文里的本地引用上传，链接改写成内核返回的 assets/xxx。
 * - 图片语法（`![]()`、`![[a.png]]`）→ `![alt](assets/…)`
 * - 图片语法但后缀不是图片（`![规格书](a.pdf)`）→ `[规格书](assets/…)`：
 *   那种写法本来就渲染成坏图，降级成链接
 * - `![[a.pdf]]` / `![[a.docx]]` → `[a.pdf](assets/…)`：思源没有内嵌 PDF 的块，
 *   转成链接后点一下用内置阅读器打开
 * - 普通链接（`[文字](a.pdf)`）→ `[文字](assets/…)`
 * - 外链、已经是 assets/ 的、`siyuan://`、`#锚点` 一律不动
 * - 找不到文件 → 保留原样并计数（不阻断导入）
 * - 同一份文件在批次内只传一次
 * - 代码（行内反引号、``` 围栏）里的内容不动
 */
export async function rewriteAssets(
  markdown: string,
  reader: AssetReader | null,
  cache: Map<string, string | null>,
  stats: AssetStats,
  upload: AssetUploader = uploadAsset,
): Promise<string> {
  if (!markdown.includes("](") && !markdown.includes("![[")) {
    return markdown;
  }

  // 顺序有讲究：先处理标准语法，**最后**处理 Obsidian 嵌入。
  // 嵌入会生成 `![alt](assets/x.png)` / `[name](assets/x.pdf)`，如果先跑，
  // 后一遍会把自己的产物当成待处理引用（再查一次文件、计入缺失）。
  let normalized = markdown;

  // 图片语法 + 普通链接：一遍扫描同时解决（见 scanLinks.ts 的语法边界说明）
  const links = scanLinks(normalized);
  if (links.length > 0) {
    let out = "";
    let lastIndex = 0;
    for (const match of links) {
      out += normalized.slice(lastIndex, match.start);
      lastIndex = match.end;
      const original = normalized.slice(match.start, match.end);
      const imageName = isImageRef(match.ref);
      const resolved = await resolveRef(match.ref, reader, cache, stats, upload);

      if (resolved) {
        out +=
          match.kind === "image" && imageName
            ? `![${match.text}](${resolved}${match.title})`
            : `[${match.text}](${resolved}${match.title})`;
        continue;
      }
      // `![规格书](files/讲义.pdf)`：图片语法 + 非图片后缀，本来就渲染不出来。
      // 落成普通链接，至少能点开；地址没变，所以不算「改坏了原文」。
      if (match.kind === "image" && !imageName && isLocalRef(match.ref)) {
        out += `[${match.text}](${match.ref}${match.title})`;
        continue;
      }
      out += original;
    }
    out += normalized.slice(lastIndex);
    normalized = out;
  }

  // Obsidian 嵌入：解析失败就原样保留。
  // 早先的写法是先转成 ![](a.png) 再统一上传，遇到带空格的文件名
  // （Obsidian 的 "Pasted image 2026....png" 全都有空格）会转出一段坏语法，
  // 既传不上去、又把原文改烂了。
  if (normalized.includes("![[")) {
    // 代码里的写法是示例，不能改（行内链接那边已经这么做，嵌入也得一致）
    const code = codeRanges(normalized);
    const embeds = Array.from(normalized.matchAll(EMBED_PATTERN));
    if (embeds.length > 0) {
      let out = "";
      let lastIndex = 0;
      for (const embed of embeds) {
        const index = embed.index ?? 0;
        out += normalized.slice(lastIndex, index);
        lastIndex = index + embed[0].length;

        if (inCode(code, index)) {
          out += embed[0];
          continue;
        }

        const { target, alias } = parseEmbed(embed[1]);
        // 没有扩展名 → 嵌入的是另一篇笔记，不是文件，不动
        if (!target || !extOf(target)) {
          out += embed[0];
          continue;
        }
        const resolved = await resolveRef(target, reader, cache, stats, upload);
        if (!resolved) {
          out += embed[0];
          continue;
        }
        const label = alias && !SIZE_PATTERN.test(alias) ? alias : "";
        if (IMAGE_EXT.has(extOf(target))) {
          out += `![${label}](${resolved})`;
        } else {
          // 思源没有「内嵌 PDF」这种块：转成链接，点一下用内置阅读器打开
          out += `[${escapeText(label || baseName(target))}](${resolved})`;
        }
      }
      out += normalized.slice(lastIndex);
      normalized = out;
    }
  }

  return normalized;
}
