/**
 * 单测里替代思源运行时（`import { Setting } from "siyuan"`）。
 * 只有 settings.ts 的 normalizeSettings 是纯逻辑，其余成员只是让打包通过。
 */

export class Setting {
  constructor(options) {
    this.options = options;
    this.items = [];
  }
  addItem(item) {
    this.items.push(item);
  }
  open() {}
}

export class Plugin {}

export const showMessage = () => {};

export const openTab = () => {};
