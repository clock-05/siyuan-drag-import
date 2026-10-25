import { m } from "../i18n";
import type { DropTarget } from "../drop/controller";
import type { LogBatch } from "../logger";
import type { MdSource } from "../source/analyze";
import { getHPathByID, getIDsByHPath } from "./api";
import { cleanDirName, cleanName, withSuffix } from "./naming";
import { mapLimit } from "../util/mapLimit";

/** 用户对单个同名文档的处理方式 */
export type ConflictChoice = "skip" | "suffix" | "overwrite" | "append";

export interface PlanEntry {
  source: MdSource;
  /** 清洗后的基础名（不含 (2) 后缀） */
  name: string;
  /** 基础 hpath（不含后缀） */
  hpath: string;
  /** 命中的已有文档 id；没有冲突时为空 */
  existingId?: string;
}

export interface PlanRejected {
  name: string;
  reason: string;
  /** 结构化原因码：文案会跟着语言变，判断逻辑只能看它 */
  code?: "same-name";
}

export interface Plan {
  notebook: string;
  parentHpath: string;
  entries: PlanEntry[];
  rejected: PlanRejected[];
  /** 导入前不存在的目录路径：撤销时只删这些，绝不碰用户原有的父文档 */
  autoDirs: string[];
}

export interface PlanItem {
  source: MdSource;
  /** 最终文档名 */
  name: string;
  /** 完整 hpath，交给 createDocWithMd（父级由内核补建/复用） */
  hpath: string;
  size: number;
  mode: "create" | "overwrite" | "append";
  /** mode = overwrite 时要写入的已有文档 id */
  overwriteId?: string;
}

export interface ResolvedPlan {
  items: PlanItem[];
  skipped: PlanRejected[];
}

const MAX_ATTEMPTS = 99;

/**
 * 查同名的并发数。
 * 每篇一次 `getIDsByHPath`，串行跑 500 篇就是 500 次往返（实测 1.5–2 秒）；
 * 8 路并发能把这段时间压到一次往返还多一点，而且查重是纯读操作，并发没有副作用。
 */
const CHECK_CONCURRENCY = 8;

/** 投放目标 + 目录段 → 这一层的 hpath */
function joinDirs(parentHpath: string, dirs: string[]): string {
  let base = parentHpath === "/" || !parentHpath ? "" : parentHpath.replace(/\/+$/, "");
  for (const dir of dirs) {
    base += `/${cleanDirName(dir)}`;
  }
  return base || "/";
}

function joinFile(dirPath: string, name: string): string {
  return dirPath === "/" ? `/${name}` : `${dirPath}/${name}`;
}

function segmentCount(hpath: string): number {
  return hpath.split("/").filter(Boolean).length;
}

function keyOf(hpath: string): string {
  return hpath.normalize("NFC").toLowerCase();
}

/** "/项目A/笔记" → { dir: "/项目A", base: "笔记" }；根级时 dir 为空串 */
function splitHpath(hpath: string): { dir: string; base: string } {
  const index = hpath.lastIndexOf("/");
  return { dir: hpath.slice(0, index), base: hpath.slice(index + 1) };
}

/**
 * 第一段：只扫描不改名。
 * 逐个查内核里是否已有同名文档，把结论留给用户（跳过 / 加后缀 / 覆盖）。
 *
 * 内核不去重、也不做任何归一化（M0 第 4 条），所以必须按原始大小写精确查；
 * 不用 SQL：索引滞后 0.3–1 秒，批次内必然漏判。
 */
export async function scanPlan(
  sources: MdSource[],
  target: DropTarget,
  batch: LogBatch | null,
): Promise<Plan> {
  let parentHpath = "/";
  if (target.parentDocId) {
    const hpath = await getHPathByID(target.parentDocId);
    if (!hpath) {
      throw new Error(m().plan.docGone);
    }
    parentHpath = hpath;
  }

  batch?.event("plan", "target", {
    notebook: target.notebook,
    parentDocId: target.parentDocId ?? null,
    parentHpath,
    sources: sources.length,
  });

  const entries: PlanEntry[] = [];
  const rejected: PlanRejected[] = [];

  type CheckOutcome = { entry: PlanEntry; conflictCount: number } | { rejected: PlanRejected };
  const outcomes = await mapLimit<MdSource, CheckOutcome>(sources, CHECK_CONCURRENCY, async (source) => {
    const dirPath = joinDirs(parentHpath, source.dirs);
    const name = cleanName(source.name);
    const hpath = joinFile(dirPath, name);

    if (segmentCount(hpath) === 0) {
      return { rejected: { name, reason: m().plan.emptyName } };
    }

    try {
      const existing = await getIDsByHPath(target.notebook, hpath);
      return { entry: { source, name, hpath, existingId: existing[0] }, conflictCount: existing.length };
    } catch (error: any) {
      return { rejected: { name, reason: m().plan.checkFailed(String(error?.message ?? error)) } };
    }
  });

  // 事件留到串行阶段再写，日志顺序才跟输入一致
  for (const outcome of outcomes) {
    if ("rejected" in outcome) {
      rejected.push(outcome.rejected);
      continue;
    }
    entries.push(outcome.entry);
    if (outcome.conflictCount > 0) {
      batch?.event("plan", "conflict", { hpath: outcome.entry.hpath, count: outcome.conflictCount });
    }
  }

  // 记下「这一批会不会顺带补建目录」：撤销要据此决定删哪一层，
  // 只删本批新建的目录，复用的父文档一个都不能碰（M0：删父会连带子文档）
  const dirPaths: string[] = [];
  for (const source of sources) {
    const dirPath = joinDirs(parentHpath, source.dirs);
    if (dirPath !== "/" && !dirPaths.includes(dirPath)) {
      dirPaths.push(dirPath);
    }
  }
  const dirExists = await mapLimit(dirPaths, CHECK_CONCURRENCY, async (dirPath) => {
    try {
      return (await getIDsByHPath(target.notebook, dirPath)).length > 0;
    } catch {
      // 查不到就当它已存在：宁可少删，不能误删
      return true;
    }
  });
  const autoDirs = dirPaths.filter((_, index) => !dirExists[index]);

  return { notebook: target.notebook, parentHpath, entries, rejected, autoDirs };
}

/** 从 base 往上找第一个没被占用的 "名称 (n)" */
async function findFreeHpath(
  notebook: string,
  hpath: string,
  taken: Set<string>,
): Promise<{ name: string; path: string } | null> {
  const { dir, base } = splitHpath(hpath);
  for (let index = 2; index <= MAX_ATTEMPTS; index += 1) {
    const name = withSuffix(base, index);
    const path = `${dir}/${name}`;
    if (taken.has(keyOf(path))) {
      continue;
    }
    const ids = await getIDsByHPath(notebook, path);
    if (ids.length === 0) {
      return { name, path };
    }
  }
  return null;
}

/**
 * 第二段：按用户选择生成最终计划。
 * - 有冲突：用 choices 里的选择，缺省走 fallback
 * - 无冲突：直接建
 * - 批次内重名（同一批两个同名文件）：自动加后缀，不打扰用户
 */
export async function resolvePlan(
  plan: Plan,
  options: {
    choices?: Map<string, ConflictChoice>;
    fallback?: ConflictChoice;
    batch?: LogBatch | null;
  } = {},
): Promise<ResolvedPlan> {
  const fallback = options.fallback ?? "suffix";
  const batch = options.batch ?? null;
  const items: PlanItem[] = [];
  const skipped: PlanRejected[] = [];
  // 占位用完整 hpath：不同目录下的同名文件互不影响
  const taken = new Set<string>();

  for (const entry of plan.entries) {
    const choice = entry.existingId
      ? options.choices?.get(entry.hpath) ?? fallback
      : undefined;

    if (entry.existingId) {
      if (choice === "skip") {
        skipped.push({ name: entry.name, reason: m().plan.sameNameSkipped, code: "same-name" });
        batch?.event("plan", "decided", { hpath: entry.hpath, choice: "skip" });
        continue;
      }

      if (choice === "append") {
        taken.add(keyOf(entry.hpath));
        items.push({
          source: entry.source,
          name: entry.name,
          hpath: entry.hpath,
          size: entry.source.size,
          mode: "append",
          overwriteId: entry.existingId,
        });
        batch?.event("plan", "decided", { hpath: entry.hpath, choice: "append", id: entry.existingId });
        continue;
      }

      if (choice === "overwrite") {
        taken.add(keyOf(entry.hpath));
        items.push({
          source: entry.source,
          name: entry.name,
          hpath: entry.hpath,
          size: entry.source.size,
          mode: "overwrite",
          overwriteId: entry.existingId,
        });
        batch?.event("plan", "decided", { hpath: entry.hpath, choice: "overwrite", id: entry.existingId });
        continue;
      }

      const free = await findFreeHpath(plan.notebook, entry.hpath, taken);
      if (!free) {
        skipped.push({ name: entry.name, reason: m().plan.tooManySame(MAX_ATTEMPTS), code: "same-name" });
        continue;
      }
      taken.add(keyOf(free.path));
      items.push({
        source: entry.source,
        name: free.name,
        hpath: free.path,
        size: entry.source.size,
        mode: "create",
      });
      batch?.event("plan", "decided", { hpath: entry.hpath, choice: "suffix", to: free.path });
      continue;
    }

    // 批次内撞名：静默加后缀，不弹冲突卡片
    if (taken.has(keyOf(entry.hpath))) {
      const free = await findFreeHpath(plan.notebook, entry.hpath, taken);
      if (!free) {
        skipped.push({ name: entry.name, reason: m().plan.tooManySame(MAX_ATTEMPTS), code: "same-name" });
        continue;
      }
      taken.add(keyOf(free.path));
      items.push({
        source: entry.source,
        name: free.name,
        hpath: free.path,
        size: entry.source.size,
        mode: "create",
      });
      batch?.event("plan", "dedupe", { from: entry.hpath, to: free.path });
      continue;
    }

    taken.add(keyOf(entry.hpath));
    items.push({
      source: entry.source,
      name: entry.name,
      hpath: entry.hpath,
      size: entry.source.size,
      mode: "create",
    });
  }

  return { items, skipped };
}
