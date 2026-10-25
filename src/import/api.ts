/**
 * 内核 API 薄封装：统一超时、统一错误形态。
 * 只包 M1 用得到的几个，别提前铺。
 */

import { m } from "../i18n";

export interface Notebook {
  id: string;
  name: string;
  closed: boolean;
  encrypted?: boolean;
  unlocked?: boolean;
}

export class ApiError extends Error {
  readonly api: string;
  readonly code: number;

  constructor(message: string, api: string, code: number) {
    super(message);
    this.name = "ApiError";
    this.api = api;
    this.code = code;
  }
}

const DEFAULT_TIMEOUT = 15000;
/** 上传是唯一可能很慢的调用（大 PDF、网络盘），给它 60 秒 */
const UPLOAD_TIMEOUT_MS = 60000;

async function post<T>(api: string, body: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, api, res.status);
    }
    const json: any = await res.json();
    if (json?.code !== 0) {
      throw new ApiError(String(json?.msg || `code ${json?.code}`), api, Number(json?.code) || -1);
    }
    return json.data as T;
  } catch (error: any) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new ApiError(m().error.timeout(timeoutMs), api, -1);
    }
    throw new ApiError(String(error?.message ?? error), api, -1);
  } finally {
    clearTimeout(timer);
  }
}

export async function lsNotebooks(): Promise<Notebook[]> {
  const data = await post<{ notebooks?: Notebook[] }>("/api/notebook/lsNotebooks", {});
  return data?.notebooks ?? [];
}

/** 返回 "/父/子"，根级为 "/名字"；文档不存在时内核给空串 */
export async function getHPathByID(id: string): Promise<string> {
  const data = await post<string>("/api/filetree/getHPathByID", { id });
  return typeof data === "string" ? data : "";
}

/** 精确匹配：区分大小写、不去空格、查不到给空数组 */
export async function getIDsByHPath(notebook: string, path: string): Promise<string[]> {
  const data = await post<string[]>("/api/filetree/getIDsByHPath", { notebook, path });
  return Array.isArray(data) ? data : [];
}

/** 传完整 hpath 即可，父文档由内核补建/复用（M0 已验） */
export async function createDocWithMd(notebook: string, path: string, markdown: string): Promise<string> {
  const data = await post<string>("/api/filetree/createDocWithMd", { notebook, path, markdown }, 30000);
  if (typeof data !== "string" || !data) {
    throw new ApiError(m().error.noDocId, "/api/filetree/createDocWithMd", -1);
  }
  return data;
}

export interface BlockInfo {
  box: string;
  rootID: string;
  rootTitle: string;
  path: string;
}

/** 上传一张资源，返回内核给的相对路径（只信 succMap，不自己拼） */
export async function uploadAsset(name: string, bytes: Uint8Array): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("assetsDirPath", "/assets/");
    // 拷一份到独立的 ArrayBuffer：BlobPart 不接受 SharedArrayBuffer 支撑的视图
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    form.append("file[]", new Blob([copy]), name);
    const res = await fetch("/api/asset/upload", { method: "POST", body: form, signal: controller.signal });
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, "/api/asset/upload", res.status);
    }
    const json: any = await res.json();
    if (json?.code !== 0) {
      throw new ApiError(String(json?.msg || `code ${json?.code}`), "/api/asset/upload", Number(json?.code) || -1);
    }
    const mapped = json?.data?.succMap?.[name];
    if (typeof mapped !== "string" || !mapped) {
      throw new ApiError(m().error.noAssetPath, "/api/asset/upload", -1);
    }
    return mapped;
  } catch (error: any) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new ApiError(m().error.uploadTimeout(Math.round(UPLOAD_TIMEOUT_MS / 1000)), "/api/asset/upload", -1);
    }
    throw new ApiError(String(error?.message ?? error), "/api/asset/upload", -1);
  } finally {
    clearTimeout(timer);
  }
}

/** 追加正文到已有文档末尾（「追加」策略）。不动原有块，也不改文档 id。 */
export async function appendDocMarkdown(id: string, markdown: string): Promise<void> {
  await post<unknown>("/api/block/appendBlock", { parentID: id, dataType: "markdown", data: markdown }, 30000);
}

/** 按 id 删文档（撤销用）。注意：会连带删除它的子文档。 */
export async function removeDoc(id: string): Promise<void> {
  await post<unknown>("/api/filetree/removeDocByID", { id }, 30000);
}

/**
 * 原地替换文档正文（「覆盖」策略）。
 * M3 探针确认：文档 id 不变、子文档保留、标题/列表/代码块都能正常重建。
 * 不要用「删了重建」——那会连带删掉子文档。
 */
export async function updateDocMarkdown(id: string, markdown: string): Promise<void> {
  await post<unknown>("/api/block/updateBlock", { id, dataType: "markdown", data: markdown }, 30000);
}

/**
 * 取一篇文档的原始 kramdown，用来做「还原点」。
 *
 * 为什么不用 exportMdContent：那个是**导出格式**，开头带 YAML frontmatter，
 * 还会把文档标题变成一个 `# 标题`；写回 updateBlock 之后 frontmatter 会变成两行正文。
 * kramdown 与 updateBlock 是同一套语法，实测往返后正文、DOM、块 id 全部逐字一致
 * （见 docs/RESTORE-SPIKE.md）。
 */
export async function getBlockKramdown(id: string): Promise<string> {
  const data = await post<{ kramdown?: string }>("/api/block/getBlockKramdown", { id });
  const text = data?.kramdown;
  if (typeof text !== "string") {
    throw new ApiError(m().error.noKramdown, "/api/block/getBlockKramdown", -1);
  }
  return text;
}

export async function getBlockInfo(id: string): Promise<BlockInfo | null> {
  try {
    return await post<BlockInfo>("/api/block/getBlockInfo", { id });
  } catch {
    return null;
  }
}
