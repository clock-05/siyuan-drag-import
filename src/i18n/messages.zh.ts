/**
 * 界面文案（简体中文）。
 *
 * 为什么不放思源的 `i18n/*.json`：那套 key 没有类型，改文案很容易只改一种语言；
 * 放 TS 里由编译器盯着，`messages.en.ts` 少一条或多一条都会报错。
 * `plugin.json` 的 displayName / description 仍然走思源那套（那是市集展示用的）。
 *
 * 约定：
 * - 带变量的文案一律写成函数，别在调用处拼字符串——英文语序常常和中文不同
 * - 日志文本不在这里：日志是给排查用的，跟着代码走，不翻译
 * - 失败/拒绝原因在这里，因为用户会在卡片上看到
 */
export const zh = {
  common: {
    close: "关闭",
    cancelImport: "取消导入",
    /** 进度卡片上的取消：点下去等于撤销，整批不留痕迹 */
    cancelAndUndo: "取消并撤销",
    openLog: "打开日志",
    noExt: "无后缀",
    listSep: "、",
    listMore: " 等",
    extList: (list: string) => `（${list}）`,
    sentenceSep: "，",
  },

  /** 结果卡片 */
  card: {
    reading: "正在读取…",
    checking: "正在检查同名…",
    renaming: "正在处理同名文档…",
    hintUnzip: "解压中",
    hintFolder: "读取中",
    hintCheck: "检查同名",
    hintRename: "加后缀",
    progressTitle: (total: number) => `正在导入 ${total} 篇…`,
    progressTarget: (label: string) => `目标：${label}`,
    count: (count: number) => `${count} 篇`,
    progressRetry: "重试失败项",
    /** 进度条上的剩余时间；只在剩余够长时拼上去 */
    eta: (seconds: number) => ` · 约 ${seconds} 秒`,
    cancelling: "正在撤销…",

    titleDone: "导入完成",
    titleFailed: "导入失败",
    titleCancelled: "已取消导入",
    /** 取消 = 撤销：整批不留痕迹，卡片说明撤回了什么 */
    cancelledRolledBack: (removed: number, restored: number) =>
      `已撤销本次导入：删除 ${removed} 篇 · 还原 ${restored} 篇`,
    /** 收缩成小条后那一行 */
    cancelledMini: "已撤销",
    cancelledRollbackFailed: (count: number) => `${count} 篇未能撤销`,
    cancelledUnrestored: (count: number) => `${count} 篇原内容无法还原`,
    cancelledUnrestoredHint: "这些文档在导入前被覆盖或追加过，但没有留下原文快照",
    cancelledRollbackFailedHint: "内核没有接受删除或写回，请到文档树里手动处理",

    okCount: (count: number) => `成功 ${count}`,
    okDetail: (overwritten: number, appended: number) => {
      const parts: string[] = [];
      if (overwritten > 0) {
        parts.push(`覆盖 ${overwritten}`);
      }
      if (appended > 0) {
        parts.push(`追加 ${appended}`);
      }
      return parts.length > 0 ? `（${parts.join(" · ")}）` : "";
    },
    skipCount: (count: number) => `跳过 ${count}`,
    failCount: (count: number) => `失败 ${count}`,
    moreHidden: (count: number) => `另有 ${count} 项未显示，见日志`,
    links: (count: number) => `已把 ${count} 处 [[双链]] 转为引用`,

    openFirst: "打开第一篇",
    retry: (count: number) => `重试这 ${count} 篇`,
    retrying: "正在重试…",
    undo: (countdown: string) => `撤销本次导入（${countdown}）`,
    undoExpired: "撤销已过期",
    undoConfirm: (action: string) => `确认${action}？`,
    undoRunning: "正在撤销…",
    undoFailed: "撤销失败，见日志",
    undoOverflow: "内容超过 100MB，本次未开启撤销",
    miniUndo: (countdown: string) => `撤销 ${countdown}`,
    miniExpand: "点击展开详情",
    pathCopied: "路径已复制",
    logOpened: "已打开",
    pickLogFailed: "无法打开日志文件夹，路径已复制",
  },

  /** 零结果卡片：一篇都没进来时的标题与「下一步怎么办」 */
  unsupported: {
    skipAllOne: "已全部跳过",
    skipAllMany: (count: number) => `已全部跳过 ${count} 篇`,
    foldersUnreadable: "这些文件夹读不了",
    exportPackage: "这是思源导出包",
    exportPackageHint: "请用「设置 → 导入 → SiYuan .sy.zip」恢复。",
    archiveNoMd: "压缩包里没有 md 文件",
    archiveUnsupported: "压缩包暂不支持",
    archiveUnsupportedHint: "先转成 zip 再拖。",
    imageAlone: "图片不能单独导入",
    imageAloneHint: "和 md 放一起、正文里引用即可。",
    emptyFolder: "文件夹里没有 md 文件",
    nothing: "没有可导入的文件",
  },

  /** 附件上传统计 */
  asset: {
    uploaded: (count: number, exts: string) => `已上传 ${count} 个附件${exts}`,
    missing: (count: number, exts: string) => `${count} 个附件找不到${exts}`,
    failed: (count: number, exts: string) => `${count} 个附件上传失败${exts}`,
    keepRaw: "，链接保持原样",
  },

  /** 同名冲突卡片 */
  conflict: {
    choiceSkip: "跳过",
    choiceSuffix: "加后缀",
    choiceOverwrite: "覆盖",
    choiceAppend: "追加",
    titleMany: (count: number) => `有 ${count} 篇同名`,
    titleOne: "这篇文档已存在",
    targetMany: (label: string) => `导入到「${label}」，逐条选或一键全部`,
    targetOne: (label: string) => `导入到「${label}」，选一种处理方式`,
    more: (count: number) => `另有 ${count} 项，默认「加后缀」，可用下面的「全部」统一设置`,
    warn: "覆盖会清空已有正文（子文档保留），追加会接在原文末尾；两种都能撤销还原",
    allSkip: "全部跳过",
    allSuffix: "全部加后缀",
    allOverwrite: "全部覆盖",
    allAppend: "全部追加",
    go: "开始导入",
  },

  /** 设置面板 */
  settings: {
    uploadImages: "上传附件",
    uploadImagesDesc:
      "把正文里引用的本地图片、PDF 等文件传到 assets 并改写链接；关掉则保留原始相对路径（图片会显示不出来）",
    skipRootFolder: "文件夹本身不建文档",
    skipRootFolderDesc:
      "拖入文件夹时，里面的文件直接放到拖放位置，不为外层文件夹建一篇空文档；子文件夹照常建。zip 不受影响。",
    stripFrontmatter: "剥离 frontmatter",
    stripFrontmatterDesc:
      "去掉正文开头的 YAML 块（思源不解析它，留着会变成两条分隔线）；关掉则原样保留",
    removeH1: "移除重复的首行 H1",
    wikilinks: "转换 Obsidian 双链",
    removeH1Desc: "首行标题与文档名相同时删掉它，避免树上一个标题、正文又一个",
    wikilinksDesc:
      "把 [[笔记]] 换成思源块引用；只对本批一起导入、能唯一对上名字的笔记生效，其余保留原样",
    conflictDefault: "同名冲突默认处理",
    conflictDefaultDesc: "冲突卡片会预选这一项，仍可逐条改",
    maxSize: "单篇大小上限（MB）",
    maxSizeDesc: "超过的 md 跳过并在结果卡片里列出",
    undoWindow: "撤销有效期（秒）",
    undoWindowDesc: "结果卡片上的「撤销本次导入」在这段时间内可用；默认 30 秒。批量覆盖后想逐篇检查再调大",
    reset: "恢复默认设置",
    resetDesc: "把上面各项恢复成初始值，不会影响已经导入的文档",
    resetLabel: "恢复默认",
    resetDone: "已恢复",
    optionSuffix: "加后缀（名称 (2)）",
    optionSkip: "跳过",
    optionOverwrite: "覆盖（清空原正文）",
    optionAppend: "追加（接在原文末尾）",
  },

  /** 导入流程里的提示与撤销结果 */
  flow: {
    loadFailed: "拖拽导入：监听注册失败，详情见 petal 日志",
    noTarget: "无法判断目标笔记本，请拖到具体的笔记本或文档上",
    defaultNotebook: "笔记本",
    defaultDoc: "文档",
    noLog: "日志未启用",
    notebookGone: "目标笔记本不存在（可能已被删除）",
    notebookClosed: (name: string) => `「${name}」已关闭，请先在文档树里打开`,
    queued: (count: number) => `上一批还在导入，这 ${count} 个排在它后面`,
    importFailed: (reason: string) => `导入失败：${reason}`,
    warning: (reason: string) => `拖拽导入：${reason}`,
    notFinished: "导入未完成",
    openDocFailed: "打开文档失败，请到文档树里手动打开",
    settingsSaveFailed: "设置没有保存成功，详见控制台",
    undoRemoved: (count: number) => `删除 ${count} 篇`,
    undoRestored: (count: number) => `还原 ${count} 篇`,
    undoNothing: "没有可撤销的内容",
    undoFailed: (count: number) => `${count} 篇失败`,
  },

  /** 拖拽覆盖层 */
  overlay: {
    root: "根目录",
    child: "子文档",
    dropTo: (label: string) => `释放以导入到「${label}」`,
  },

  /** 单篇失败原因（executor） */
  error: {
    tooBig: (mb: number) => `文件超过 ${mb} MB，已跳过`,
    noPermission: "无读取权限（可能被其他程序占用）",
    notFound: "文件不存在或已被移动",
    noSpace: "磁盘空间不足",
    busy: "文件被占用",
    unknown: "未知错误",
    noFs: "拿不到 Node 的 fs，无法读取文件",
    noDocId: "内核没有返回文档 id",
    noAssetPath: "内核没有返回资源路径",
    uploadTimeout: (seconds: number) => `上传超时（${seconds}s）`,
    timeout: (ms: number) => `内核响应超时（${ms}ms）`,
    noKramdown: "内核没有返回 kramdown",
    appendHeader: (name: string, stamp: string) => `> 以下内容来自 ${name}（${stamp} 导入）`,
  },

  /** 规划阶段：查重与跳过 */
  plan: {
    emptyName: "文档名为空，已拒绝发送（内核会建出垃圾文档）",
    checkFailed: (reason: string) => `查重失败：${reason}`,
    sameNameSkipped: "同名，已跳过",
    tooManySame: (attempts: number) => `同名文档过多（已尝试 ${attempts} 次）`,
    docGone: "目标文档已不存在（可能刚被移动或删除）",
  },

  /** 拖进来但没能进入导入流程的原因 */
  reject: {
    folderNoMd: "文件夹里没有 md 文件",
    siyuanExport: "思源导出包，请用「设置 → 导入」",
    noPath: "读不到文件路径，无法解压",
    archiveNoMd: "压缩包里没有 md 文件",
    onlyZip: "暂只支持 .zip（可先转成 zip）",
    notMarkdown: (ext: string) => (ext ? `非 Markdown（${ext}）` : "非 Markdown"),
    binary: "内容像二进制文件，已跳过",
    untitled: "未命名",
    untitledFile: "未命名文件",
  },

  /** 文件夹里有、但不建文档的东西：列在结果卡片的「跳过」清单里 */
  skip: {
    nonMd: (count: number, exts: string) => `${count} 个非 Markdown 文件${exts}`,
    nonMdReason: "不建文档；被正文引用时会随正文上传",
    assets: (count: number, exts: string) => `${count} 个图片/附件${exts}`,
    assetsReason: "资源目录，不建文档；被正文引用时会随正文上传",
    emptyDirs: (list: string, rest: number, total: number) =>
      `没有 md 的文件夹：${list}${rest > 0 ? ` 等 ${total} 个` : ""}`,
    emptyDirsReason: "不建文档",
    truncated: (limit: number) => `文件过多，只取了前 ${limit} 篇`,
    truncatedReason: "请分批拖入",
  },

  /** 读文件夹时的问题 */
  walk: {
    noPermission: "无读取权限",
    gone: "已被移动或删除",
    readFailed: "读取失败",
    pathTooLong: "路径过长（超过 259 字符）",
    symlink: "符号链接，已跳过",
    tooDeep: "目录层级过深（超过 20 层）",
    noFs: "拿不到 Node 的 fs，无法读取文件夹",
  },

  /** 解压时的问题 */
  archive: {
    badName: "压缩包结构异常（文件名包含非法字符）",
    absolutePath: "压缩包结构异常（包含绝对路径）",
    parentPath: "压缩包结构异常（包含上级目录）",
    tooShort: "压缩包已损坏（文件过短）",
    noCentral: "压缩包已损坏（找不到目录区）",
    centralRange: "压缩包已损坏（目录区越界）",
    centralItem: "压缩包已损坏（目录项异常）",
    encrypted: "加密压缩包暂不支持，请先解压",
    badData: "压缩包已损坏（数据区异常）",
    truncated: "压缩包已损坏（数据被截断）",
    broken: "压缩包已损坏，未导入任何内容",
    failed: "压缩包解压失败",
    itemTooBig: (mb: number) => `单篇超过 ${mb} MB，已跳过`,
    tooBig: (limitMB: number, actualMB: number) => `压缩包过大（上限 ${limitMB} MB，实际 ${actualMB} MB）`,
    tooManyEntries: (count: number, limit: number) => `压缩包条目过多（${count} 项，上限 ${limit}）`,
    unsupportedMethod: (method: number) => `不支持的压缩方式（method ${method}）`,
    unpackedTooBig: (actualMB: number, limitMB: number) => `压缩包解压后过大（${actualMB} MB，上限 ${limitMB} MB）`,
  },
};
