/**
 * 文档树 DOM 选择器集中在这。
 * 亲缘关系（3.8.8 前端产物核对过）：
 *   .sy__file                     整个文件面板
 *     .file-tree__items           条目容器
 *       ul[data-url="<笔记本id>"]  每个笔记本一段
 *         li[data-node-id]        行；笔记本行还带 data-type="navigation-root"
 */

export const SEL_PANEL = ".sy__file";
export const SEL_ITEMS = ".file-tree__items";
export const SEL_ROW = "[data-node-id]";
/** 笔记本段：不限定直接子级，思源改过层级也能命中 */
export const SEL_SECTION = "ul[data-url]";
export const NOTEBOOK_ROW_TYPE = "navigation-root";

/** 只接管「从系统拖文件」：内部拖动、浏览器拖文字都没有 Files */
export function isFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.prototype.indexOf.call(types, "Files") !== -1;
}

export function panelOf(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) {
    return null;
  }
  return node.closest<HTMLElement>(SEL_PANEL);
}

export function rowOf(node: EventTarget | null, panel: HTMLElement): HTMLElement | null {
  if (!(node instanceof Element)) {
    return null;
  }
  const row = node.closest<HTMLElement>(SEL_ROW);
  if (!row || !panel.contains(row)) {
    return null;
  }
  // 命中的可能是文档树里的按钮/图标，往上收敛到行本身
  return row;
}

export function isNotebookRow(row: HTMLElement): boolean {
  return row.getAttribute("data-type") === NOTEBOOK_ROW_TYPE;
}

/** 行所属的笔记本段（ul[data-url]），拿它的 data-url 就是笔记本 id */
export function sectionOfRow(row: HTMLElement): HTMLElement | null {
  return row.closest<HTMLElement>("ul[data-url]");
}

export function rowText(row: HTMLElement): string {
  const el = row.querySelector(".b3-list-item__text");
  const text = (el?.textContent ?? "").trim();
  return text || (row.getAttribute("data-node-id") ?? "");
}

/** 拖到面板空白处：按纵坐标找所在的笔记本段，落到该段根级 */
export function sectionAtY(panel: HTMLElement, y: number): HTMLElement | null {
  const items = panel.querySelector<HTMLElement>(SEL_ITEMS) ?? panel;
  const sections = Array.from(items.querySelectorAll<HTMLElement>(SEL_SECTION));
  if (sections.length === 0) {
    return null;
  }
  let best: HTMLElement | null = null;
  for (const section of sections) {
    const rect = section.getBoundingClientRect();
    if (rect.top <= y + 1) {
      best = section;
    } else {
      break;
    }
  }
  return best ?? sections[0];
}

export function sectionNotebookId(section: HTMLElement): string {
  return section.getAttribute("data-url") ?? "";
}

export function sectionNotebookName(section: HTMLElement): string {
  const el = section.querySelector('li[data-type="navigation-root"] .b3-list-item__text');
  return (el?.textContent ?? "").trim();
}

/**
 * 文档树里真正能滚的那个元素。
 * 思源改过几次层级，与其写死选择器，不如从条目容器往上找第一个
 * 「内容比可视区高、且 overflow-y 允许滚动」的祖先。
 */
export function scrollHostOf(panel: HTMLElement): HTMLElement | null {
  const items = panel.querySelector<HTMLElement>(SEL_ITEMS);
  let node: HTMLElement | null = items ?? panel;
  while (node) {
    if (node.scrollHeight > node.clientHeight + 2 && allowsScroll(node)) {
      return node;
    }
    if (node === panel) {
      break;
    }
    node = node.parentElement;
  }
  return panel.scrollHeight > panel.clientHeight + 2 && allowsScroll(panel) ? panel : null;
}

function allowsScroll(node: HTMLElement): boolean {
  try {
    // jsdom（单测）算不出 overflow，会返回空串，这时退回内联样式
    const value = getComputedStyle(node).overflowY || node.style.overflowY;
    return value === "auto" || value === "scroll" || value === "overlay";
  } catch {
    // 拿不到计算样式时宁可当它不能滚，也别乱动滚动位置
    return false;
  }
}
