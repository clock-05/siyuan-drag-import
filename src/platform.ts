/**
 * 运行环境适配：拿 Node 内置模块。
 *
 * 为什么用 window.require 而不是裸 require：
 * 源码是 ESM 写法，esbuild 打包成 CJS 时会把裸 require 换成自己的 shim，
 * 运行时报 "Dynamic require of xxx is not supported"。window.require 是
 * Electron 渲染进程真实暴露的那个，绕开打包器的改写（siyuan-importer 也这么写）。
 */

export function nodeRequire<T = any>(id: string): T | null {
  try {
    const req = window.require;
    return req ? (req(id) as T) : null;
  } catch (error) {
    console.error(`[drag-import] require("${id}") 失败`, error);
    return null;
  }
}

let fsCache: any | undefined;
let pathCache: any | undefined;

export function nodeFs(): any | null {
  if (fsCache === undefined) {
    fsCache = nodeRequire("fs") ?? null;
  }
  return fsCache;
}

export function nodePath(): any | null {
  if (pathCache === undefined) {
    pathCache = nodeRequire("path") ?? null;
  }
  return pathCache;
}

/** 思源工作区绝对路径；拿不到返回空串（此时日志自动降级为只打控制台） */
export function workspaceDir(): string {
  try {
    return window.siyuan?.config?.system?.workspaceDir ?? "";
  } catch {
    return "";
  }
}
