declare module "siyuan" {
  export class Plugin {
    constructor(options: any);
    name: string;
    app: any;
    i18n: Record<string, string>;
    eventBus: {
      on(type: string, listener: (event: CustomEvent<any>) => any): void;
      off(type: string, listener: (event: CustomEvent<any>) => any): void;
      once(type: string, listener: (event: CustomEvent<any>) => any): void;
    };
    /**
     * 设置面板。字段名是思源硬编码的：`Plugin.openSetting()` 里读的就是 `this.setting`，
     * 顶栏「插件」菜单、集市「已下载」的齿轮都调它，改名设置入口就没了。
     */
    setting?: Setting;
    /** 基类自带：打开 this.setting（桌面端 setting.open(displayName)） */
    openSetting(): void;
    loadData(key: string): Promise<any>;
    saveData(key: string, value: any): Promise<any>;
    removeData(key: string): Promise<any>;
    onload(): void | Promise<void>;
    onunload(): void;
  }

  export class Setting {
    constructor(options: { confirmCallback?: () => void; destroyCallback?: () => void });
    addItem(options: {
      title: string;
      description?: string;
      createActionElement?: () => HTMLElement;
    }): void;
    open(name: string): void;
  }

  export function showMessage(message: string, timeout?: number, type?: string): void;
  export function openTab(options: any): void;
}

/** 思源插件以 CommonJS 形式导出插件类 */
declare const module: { exports: any };

/** 桌面端 nodeIntegration = true，渲染进程可以直接拿 Node 模块 */
interface Window {
  require?: (id: string) => any;
  siyuan?: any;
  /** 思源前端把 openTab 也挂在 window 上，作为 import 失败的兜底 */
  openTab?: (options: any) => void;
}
