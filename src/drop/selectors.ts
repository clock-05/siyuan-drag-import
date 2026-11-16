/**
 * 文档树 DOM 选择器集中在这。两套结构都得认：
 *
 * ≤3.8.9（顺序列表）
 *   .sy__file
 *     .file-tree__items
 *       ul[data-url="<笔记本id>"]        每个笔记本一段
 *         li[data-node-id]               行；笔记本行 data-type="navigation-root"
 *
 * 3.8.10+（虚拟列表，前端把 ul 换成了逐行渲染）
 *   .sy__file
 *     .file-tree__items
 *       li[data-tree-key][data-type][data-node-id]
 *   笔记本 id 只在 data-tree-key 里：
 *     notebook:<笔记本id>                笔记本行
 *     notebook:<笔记本id>/<文档id>        文档行（再深的子文档继续往后拼）
 *     pin:<文档id>                       置顶区，只能靠 blockInfo 反查笔记本
 *   注意：笔记本行的 data-node-id 在 fileTree.boxDocEnabled=false（默认）时是空串，
 *   所以「拖到笔记本上」在 3.8.10 里拿不到 id —— 这就是 1.0.5 之前报「无法判断目标笔记本」的原因。
 */

export const SEL_PANEL = ".sy__file";
export const SEL_ITEMS = ".file-tree__items";
export const SEL_ROW = "[data-node-id], li[data-tree-key]";
/** 旧版笔记本段：不限定直接子级，思源改过层级也能命中 */
export const SEL_SECTION = "ul[data-url]";
/** 3.8.10+ 的虚拟列表行 */
export const SEL_TREE_ROW = "li[data-tree-key]";
export const NOTEBOOK_ROW_TYPE = "navigation-root";
/** 加密且未解锁的笔记本：data-type 是 closed，但它在树里仍然是「根」 */
export const NOTEBOOK_CLOSED_TYPE = "navigation-closed";

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
  const type = row.getAttribute("data-type");
  return type === NOTEBOOK_ROW_TYPE || type === NOTEBOOK_CLOSED_TYPE;
}

/**
 * 从 3.8.10 的行键里取笔记本 id：`notebook:<nb>[/<doc>…]`。
 * `pin:<doc>` 是置顶区，键里没有笔记本，返回空串交给 blockInfo 反查。
 */
export function notebookIdOfRow(row: HTMLElement): string {
  const key = row.getAttribute("data-tree-key");
  if (!key) {
    return "";
  }
  const match = /^notebook:([^/]+)/.exec(key);
  return match ? match[1] : "";
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

export interface PanelSpot {
  /** 笔记本 id */
  notebook: string;
  /** 笔记本名，横幅要用 */
  label: string;
}

/**
 * 拖到面板空白处：算出落点属于哪个笔记本（落它的根级）。
 * 旧版按 `ul[data-url]` 分段；3.8.10 起没有分段容器了，退化成
 * 「按纵坐标找最后一个在指针上方的行，取它的 tree-key」——虚拟列表里
 * 同一个笔记本的行是连着的，等价于分段。
 */
export function notebookAtY(panel: HTMLElement, y: number): PanelSpot | null {
  const section = sectionAtY(panel, y);
  if (section) {
    const id = sectionNotebookId(section);
    if (id) {
      return { notebook: id, label: sectionNotebookName(section) };
    }
  }

  const items = panel.querySelector<HTMLElement>(SEL_ITEMS) ?? panel;
  const rows = Array.from(items.querySelectorAll<HTMLElement>(SEL_TREE_ROW));
  let best: HTMLElement | null = null;
  for (const row of rows) {
    // 虚拟列表只渲染可视区，没渲染的行 rect 全 0，不能拿来做判断
    if (row.getBoundingClientRect().height === 0) {
      continue;
    }
    if (row.getBoundingClientRect().top <= y + 1) {
      best = row;
    } else {
      break;
    }
  }
  // 指针在所有行上方（标题栏下沿那种位置）：归第一个笔记本
  if (!best) {
    best = rows.find((row) => row.getBoundingClientRect().height > 0) ?? null;
  }
  if (!best) {
    return null;
  }
  const notebook = notebookIdOfRow(best);
  if (!notebook) {
    return null;
  }
  return { notebook, label: notebookRowName(panel, notebook) };
}

/** 笔记本根行的标题；虚拟列表里根行可能被滚出可视区，那就只能回空 */
function notebookRowName(panel: HTMLElement, notebook: string): string {
  const row = panel.querySelector<HTMLElement>(`${SEL_TREE_ROW}[data-tree-key="notebook:${notebook}"]`);
  if (row) {
    return rowText(row);
  }
  const legacy = panel.querySelector<HTMLElement>(`${SEL_SECTION}[data-url="${notebook}"]`);
  return legacy ? sectionNotebookName(legacy) : "";
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
