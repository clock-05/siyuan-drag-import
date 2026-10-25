import { en } from "./messages.en";
import { zh } from "./messages.zh";

export type Messages = typeof zh;

let current: Messages = zh;

/**
 * 思源界面语言：`window.siyuan.config.appearance.lang`（`zh_CN` / `en_US`）。
 * 拿不到就按中文——桌面端一定有这个字段，拿不到基本意味着不在思源里跑（单测、异常）。
 * 这里**故意不看 navigator.language**：思源的语言设置和浏览器/系统语言可以不同，
 * 而且 jsdom 默认 `en-US`，会让测试全都变成英文。
 */
export function detectLanguage(): string {
  const lang = (globalThis as any)?.siyuan?.config?.appearance?.lang;
  return typeof lang === "string" && lang ? lang : "zh_CN";
}

export function setLanguage(lang?: string): void {
  current = /^en/i.test(lang ?? "") ? en : zh;
}

/** 当前语言的文案表。调用处写 `m().card.titleDone`，改语言只需重设一次 */
export function m(): Messages {
  return current;
}

export { en, zh };
