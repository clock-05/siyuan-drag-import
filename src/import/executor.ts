import { m } from "../i18n";
import type { LogBatch } from "../logger";
import { nodeFs } from "../platform";
import type { MdSource } from "../source/analyze";
import { appendDocMarkdown, createDocWithMd, getBlockKramdown, updateDocMarkdown } from "./api";
import { emptyAssetStats, rewriteAssets } from "./assets";
import type { AssetStats, AssetUploader } from "./assets";
import { parseMarkdown } from "./markdown";
import { applyWikilinks, linkKey, scanWikilinks } from "./wikilinks";
import type { WikiLink } from "./wikilinks";
import type { PlanItem } from "./planner";

export type WriteMode = "create" | "overwrite" | "append";

export interface SuccessItem {
  name: string;
  id: string;
  hpath: string;
  ms: number;
  encoding: string;
  removedFrontmatter: boolean;
  removedH1: boolean;
  mode: WriteMode;
  /** 覆盖 / 追加前的原文快照（kramdown）。撤销时写回它；新建的没有 */
  before?: string;
}

export interface FailureItem {
  name: string;
  reason: string;
  /** 值得再试一次：「文件太大」这种重试多少次都一样，不提供重试 */
  retryable?: boolean;
  /** 重试时重跑这一项（卡片不显示，index 用它组装重试批次） */
  item?: PlanItem;
}

export interface ExecResult {
  ok: SuccessItem[];
  failed: FailureItem[];
  /** 用户中途取消：已建好的保留，剩下的不执行 */
  cancelled: boolean;
  assets: AssetStats;
  /** 快照总量超过上限：整批不提供撤销（见 SNAPSHOT_BUDGET） */
  snapshotOverflow?: boolean;
  /** 本批里被转成思源块引用的 `[[双链]]` 处数 */
  links?: number;
}

export interface RunOptions {
  /** 默认 true；关掉就保留原链接 */
  uploadImages?: boolean;
  maxBytes?: number;
  stripFrontmatter?: boolean;
  removeDuplicateH1?: boolean;
  /** 默认 true：把 `[[笔记]]` 转成思源块引用（只对本批内能唯一命中的目标生效） */
  convertWikilinks?: boolean;
  /** 测试注入用；默认走真实上传 */
  upload?: AssetUploader;
  now?: () => Date;
}

/** 单篇上限：超过后建文档会明显卡（设计 §9） */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * 还原点（快照）总预算，按**内存占用**估算：JS 字符串是 UTF-16，一个中文字 2 字节，
 * 所以用 `length * 2`，100MB 约等于 50MB 纯文本（≈2500 篇 20KB 的笔记）。
 * 超了不写盘、也不做「部分还原」——整批关掉撤销，避免「以为全还原了其实没有」。
 */
const SNAPSHOT_BUDGET = 100 * 1024 * 1024;

function describe(error: unknown): string {
  const message = String((error as any)?.message ?? error);
  if (/EACCES|EPERM/.test(message)) {
    return m().error.noPermission;
  }
  if (/ENOENT/.test(message)) {
    return m().error.notFound;
  }
  if (/ENOSPC/.test(message)) {
    return m().error.noSpace;
  }
  if (/EBUSY/.test(message)) {
    return m().error.busy;
  }
  return message || m().error.unknown;
}

/** 压缩包解出来的直接用内存字节；散文件读 File；文件夹里的走 fs */
async function readSource(source: MdSource): Promise<Uint8Array | ArrayBuffer> {
  if (source.bytes) {
    return source.bytes;
  }
  if (source.file) {
    return await source.file.arrayBuffer();
  }
  const fs = nodeFs();
  if (!fs) {
    throw new Error(m().error.noFs);
  }
  return fs.readFileSync(source.path) as Uint8Array;
}

function formatAppendHeader(sourceName: string, date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `\n\n---\n\n${m().error.appendHeader(sourceName, stamp)}\n\n`;
}

/** 逐篇执行：单篇失败不影响后续，失败原因归类带回卡片 */
export async function runPlan(
  items: PlanItem[],
  notebook: string,
  batch: LogBatch | null,
  onProgress?: (done: number, total: number, name: string) => void,
  shouldStop?: () => boolean,
  options: RunOptions = {},
): Promise<ExecResult> {
  const ok: SuccessItem[] = [];
  const failed: FailureItem[] = [];
  const assets = emptyAssetStats();
  const assetCache = new Map<string, string | null>();
  /**
   * 覆盖 / 追加的还原点，**按文档 id 只取一次**。
   * 同一篇文档可能被本批两条来源指向（两个同名文件夹、压缩包里的重复条目），
   * 第二条要是重新取快照，拿到的就是第一条写改后的内容 —— 撤销会「还原成导入后」，等于没撤。
   */
  const snapshots = new Map<string, string>();
  /** 待回填双链的文档：目标可能在本批更后面才建好，所以等全部建完再统一处理 */
  const pendingLinks: Array<{ id: string; markdown: string; links: WikiLink[] }> = [];
  const uploadImages = options.uploadImages !== false;
  const convertWikilinks = options.convertWikilinks !== false;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const now = options.now ?? (() => new Date());

  const total = items.length;
  let done = 0;
  let cancelled = false;
  let snapshotBytes = 0;
  let snapshotOverflow = false;

  for (const item of items) {
    // 取消粒度 = 单篇（约 33ms），点下去最多再建一篇
    if (shouldStop?.()) {
      cancelled = true;
      batch?.event("import", "cancelled", { done, total });
      break;
    }

    const started = performance.now();
    let retryable = true;
    try {
      if (item.size > maxBytes) {
        retryable = false;
        throw new Error(m().error.tooBig(Math.round(maxBytes / 1024 / 1024)));
      }
      const bytes = await readSource(item.source);
      if (bytes.byteLength > maxBytes) {
        retryable = false;
        throw new Error(m().error.tooBig(Math.round(maxBytes / 1024 / 1024)));
      }

      const parsed = parseMarkdown(bytes, item.name, {
        stripFrontmatter: options.stripFrontmatter,
        removeDuplicateH1: options.removeDuplicateH1,
      });

      let markdown = parsed.markdown;
      if (uploadImages && item.source.assets) {
        markdown = await rewriteAssets(markdown, item.source.assets, assetCache, assets, options.upload);
      }

      // 覆盖 / 追加前先留还原点：撤销时直接写回它。
      // 用 kramdown 而不是 exportMdContent —— 后者带 frontmatter，写回会变成正文（见 RESTORE-SPIKE.md）。
      let before: string | undefined;
      let freshSnapshot = false;
      if (item.mode !== "create" && item.overwriteId && !snapshotOverflow) {
        before = snapshots.get(item.overwriteId);
        if (before === undefined) {
          try {
            before = await getBlockKramdown(item.overwriteId);
            snapshots.set(item.overwriteId, before);
            freshSnapshot = true;
          } catch (error: any) {
            // 取不到就不登记这一篇：撤销时它恢复不了，卡片上也不会算进「还原 N 篇」
            batch?.event("import", "snapshot-failed", {
              id: item.overwriteId,
              err: String(error?.message ?? error),
            });
          }
        }
      }

      // 追加没法整篇回写（会把原有块 id 全换掉），所以不处理追加段的双链
      const wikilinks =
        convertWikilinks && item.mode !== "append" && markdown.includes("[[") ? scanWikilinks(markdown) : [];

      let id: string;
      if (item.mode === "overwrite" && item.overwriteId) {
        // 原地换正文：保留文档 id 与它的子文档（M3 探针确认）
        await updateDocMarkdown(item.overwriteId, markdown);
        id = item.overwriteId;
      } else if (item.mode === "append" && item.overwriteId) {
        // 追加：不动原有块，只在末尾接一段带来源说明的内容
        await appendDocMarkdown(item.overwriteId, formatAppendHeader(item.source.name, now()) + markdown);
        id = item.overwriteId;
      } else {
        id = await createDocWithMd(notebook, item.hpath, markdown);
      }

      if (wikilinks.length > 0) {
        pendingLinks.push({ id, markdown, links: wikilinks });
      }

      const ms = Math.round(performance.now() - started);
      ok.push({
        name: item.name,
        id,
        hpath: item.hpath,
        ms,
        encoding: parsed.encoding,
        removedFrontmatter: parsed.removedFrontmatter,
        removedH1: parsed.removedH1,
        mode: item.mode,
        before,
      });

      // 复用的快照不重复计入预算（同一份字符串并没有多占内存）
      if (before && freshSnapshot) {
        snapshotBytes += before.length * 2;
        if (snapshotBytes > SNAPSHOT_BUDGET) {
          // 超限就整批放弃：宁可没有撤销，也不要「只还原了一半」这种假象
          snapshotOverflow = true;
          snapshots.clear();
          for (const row of ok) {
            row.before = undefined;
          }
          batch?.event("import", "snapshot-overflow", {
            bytes: snapshotBytes,
            budget: SNAPSHOT_BUDGET,
          });
        }
      }
      batch?.event(
        "import",
        item.mode === "create" ? "created" : item.mode === "overwrite" ? "overwritten" : "appended",
        {
          file: item.source.name,
          doc: item.name,
          hpath: item.hpath,
          id,
          ms,
          bytes: bytes.byteLength,
          encoding: parsed.encoding,
          removedFrontmatter: parsed.removedFrontmatter,
          removedH1: parsed.removedH1,
          assets: { images: { ...assets.images }, files: { ...assets.files } },
        },
      );
    } catch (error) {
      const reason = describe(error);
      // 不能重试的就不留原始项：留着也没人用，白白多占一份引用
      failed.push({ name: item.name, reason, retryable, item: retryable ? item : undefined });
      batch?.event("import", "failed", {
        file: item.source.name,
        hpath: item.hpath,
        ms: Math.round(performance.now() - started),
        err: reason,
      });
    } finally {
      done += 1;
      onProgress?.(done, total, item.name);
    }
  }

  // 取消的批次马上要整体回滚，不用再费劲把 [[双链]] 改写成引用了
  const links = cancelled ? 0 : await patchWikilinks(pendingLinks, ok, batch);

  return { ok, failed, cancelled, assets, snapshotOverflow, links };
}

/**
 * 全部文档建好之后，把 `[[笔记]]` 换成 `((id "笔记"))`。
 * 必须等整批建完：前向引用（链接到后面才导入的笔记）只有这时候才拿得到 id。
 */
async function patchWikilinks(
  pending: Array<{ id: string; markdown: string; links: WikiLink[] }>,
  rows: SuccessItem[],
  batch: LogBatch | null,
): Promise<number> {
  if (pending.length === 0) {
    return 0;
  }

  // 标题与完整路径都能当链接目标；同名不同篇的不猜（宁可保留原文）
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    for (const key of [linkKey(row.name), linkKey(row.hpath)]) {
      if (!key) {
        continue;
      }
      const prev = index.get(key);
      if (prev !== undefined && prev !== row.id) {
        ambiguous.add(key);
        continue;
      }
      index.set(key, row.id);
    }
  }
  for (const key of ambiguous) {
    index.delete(key);
  }

  const resolve = (target: string): string | undefined => {
    const key = linkKey(target);
    const direct = index.get(key);
    if (direct) {
      return direct;
    }
    // `[[目录/笔记]]` 路径对不上时，退回按最后一段找（Obsidian 也是这个优先级）
    const base = key.split("/").pop() ?? "";
    return base && base !== key ? index.get(base) : undefined;
  };

  let converted = 0;
  for (const doc of pending) {
    const result = applyWikilinks(doc.markdown, doc.links, resolve);
    if (result.converted === 0) {
      continue;
    }
    try {
      await updateDocMarkdown(doc.id, result.text);
      converted += result.converted;
      batch?.event("import", "links", { id: doc.id, count: result.converted });
    } catch (error: any) {
      // 转不了就保留原样：比让整篇导入失败好
      batch?.event("import", "links-failed", { id: doc.id, err: String(error?.message ?? error) });
    }
  }

  return converted;
}
