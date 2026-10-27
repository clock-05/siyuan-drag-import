import { zh } from "./messages.zh";

/**
 * UI copy (English). `typeof zh` 保证结构完全一致：漏一条、多一条都会编译报错。
 * 带变量的文案都写成函数，语序可以跟中文完全不同。
 */
export const en: typeof zh = {
  common: {
    close: "Close",
    cancelImport: "Cancel import",
    /** Cancel button on the progress card: same as undo, nothing is kept */
    cancelAndUndo: "Cancel and undo",
    openLog: "Open log",
    noExt: "no extension",
    listSep: ", ",
    listMore: " and more",
    extList: (list) => ` (${list})`,
    sentenceSep: ", ",
  },

  card: {
    reading: "Reading…",
    checking: "Checking for duplicates…",
    renaming: "Resolving duplicate names…",
    hintUnzip: "Unzipping",
    hintFolder: "Scanning",
    hintCheck: "Checking names",
    hintRename: "Adding suffixes",
    progressTitle: (total) => (total === 1 ? "Importing 1 file…" : `Importing ${total} files…`),
    progressTarget: (label) => `Target: ${label}`,
    count: (count: number) => (count === 1 ? "1 file" : `${count} files`),
    progressRetry: "Retrying failed items",
    eta: (seconds) => ` · ~${seconds}s`,
    cancelling: "Undoing…",

    titleDone: "Import complete",
    titleFailed: "Import failed",
    titleCancelled: "Import cancelled",
    /** Cancel = undo: nothing is kept, the card says what was rolled back */
    cancelledRolledBack: (removed: number, restored: number) =>
      `Import undone: ${removed} deleted · ${restored} restored`,
    /** The one-line bar after the card collapses */
    cancelledMini: "Undone",
    cancelledRollbackFailed: (count: number) => `${count} could not be undone`,
    cancelledUnrestored: (count: number) => `${count} could not be restored`,
    cancelledUnrestoredHint: "These were overwritten or appended to before the import, and no snapshot was kept",
    cancelledRollbackFailedHint: "The kernel rejected the delete or the write-back — handle them in the document tree",

    okCount: (count) => `${count} imported`,
    okDetail: (overwritten, appended) => {
      const parts: string[] = [];
      if (overwritten > 0) {
        parts.push(`${overwritten} overwritten`);
      }
      if (appended > 0) {
        parts.push(`${appended} appended`);
      }
      return parts.length > 0 ? ` (${parts.join(" · ")})` : "";
    },
    skipCount: (count) => `${count} skipped`,
    failCount: (count) => `${count} failed`,
    moreHidden: (count) => `${count} more not shown — see the log`,
    links: (count) => `${count} [[links]] turned into references`,

    openFirst: "Open the first one",
    retry: (count) => `Retry ${count} failed`,
    retrying: "Retrying…",
    undo: (countdown) => `Undo this import (${countdown})`,
    undoExpired: "Undo expired",
    undoConfirm: (action) => `Confirm: ${action}?`,
    undoRunning: "Undoing…",
    undoFailed: "Undo failed — see the log",
    undoOverflow: "Content over 100 MB — undo is off for this batch",
    miniUndo: (countdown) => `Undo ${countdown}`,
    miniExpand: "Click to expand",
    pathCopied: "Path copied",
    logOpened: "Opened",
    pickLogFailed: "Couldn't open the log folder — path copied instead",
  },

  unsupported: {
    skipAllOne: "All skipped",
    skipAllMany: (count) => `All ${count} skipped`,
    foldersUnreadable: "These folders can't be read",
    exportPackage: "This is a SiYuan export",
    exportPackageHint: "Restore it with Settings → Import → SiYuan .sy.zip.",
    archiveNoMd: "No markdown in the archive",
    archiveUnsupported: "Archive type not supported",
    archiveUnsupportedHint: "Convert it to .zip first.",
    imageAlone: "Images can't be imported alone",
    imageAloneHint: "Keep them next to the .md and reference them in the text.",
    emptyFolder: "No markdown in this folder",
    nothing: "Nothing to import",
  },

  asset: {
    uploaded: (count, exts) => `${count === 1 ? "1 attachment" : `${count} attachments`} uploaded${exts}`,
    missing: (count, exts) => `${count === 1 ? "1 attachment" : `${count} attachments`} not found${exts}`,
    failed: (count, exts) => `${count === 1 ? "1 attachment" : `${count} attachments`} failed to upload${exts}`,
    keepRaw: " — links left unchanged",
  },

  conflict: {
    choiceSkip: "Skip",
    choiceSuffix: "Rename",
    choiceOverwrite: "Replace",
    choiceAppend: "Append",
    titleMany: (count) => (count === 1 ? "1 document already exists" : `${count} documents already exist`),
    titleOne: "This document already exists",
    targetMany: (label) => `Import into “${label}” — choose per file, or apply to all`,
    targetOne: (label) => `Import into “${label}” — pick one action`,
    more: (count) => `${count} more, defaulting to “Rename”. Use the buttons below to apply to all.`,
    warn: "Replace clears the existing text (child documents are kept); Append adds to the end. Both can be undone.",
    allSkip: "Skip all",
    allSuffix: "Rename all",
    allOverwrite: "Replace all",
    allAppend: "Append all",
    go: "Start import",
  },

  settings: {
    uploadImages: "Upload attachments",
    uploadImagesDesc:
      "Copy referenced images, PDFs and other local files into assets and rewrite the links. Turn off to keep the original relative paths (images will then fail to load).",
    skipRootFolder: "Don't create a document for the folder",
    skipRootFolderDesc:
      "Put a dropped folder's contents straight into the drop target instead of creating an empty document for the folder itself. Sub-folders still become documents; zip archives are unaffected.",
    stripFrontmatter: "Strip frontmatter",
    stripFrontmatterDesc:
      "Remove the YAML block at the top — SiYuan doesn't parse it, so it would show up as two horizontal rules. Turn off to keep it as-is.",
    removeH1: "Remove duplicate first H1",
    removeH1Desc: "Drop the first heading when it matches the document name, so the title isn't shown twice.",
    wikilinks: "Convert Obsidian wiki links",
    wikilinksDesc:
      "Turn [[note]] into SiYuan block references for notes imported in the same batch; anything else stays as text.",
    conflictDefault: "Default handling for duplicates",
    conflictDefaultDesc: "Pre-selected on the conflict card; you can still change it per file.",
    maxSize: "Max size per file (MB)",
    maxSizeDesc: "Larger markdown files are skipped and listed on the result card.",
    undoWindow: "Undo window (seconds)",
    undoWindowDesc:
      "How long “Undo this import” stays available. Default 30 s. Raise it if you want to review a batch of replacements one by one.",
    reset: "Restore defaults",
    resetDesc: "Reset every option above. Already imported documents are not affected.",
    resetLabel: "Restore",
    resetDone: "Restored",
    optionSuffix: "Rename (name (2))",
    optionSkip: "Skip",
    optionOverwrite: "Replace (clears the existing text)",
    optionAppend: "Append (adds to the end)",
  },

  flow: {
    loadFailed: "Drag Import: failed to register listeners — see the petal log",
    noTarget: "Can't tell which notebook to import into. Drop onto a specific notebook or document.",
    defaultNotebook: "notebook",
    defaultDoc: "document",
    noLog: "logging off",
    notebookGone: "The target notebook no longer exists",
    notebookClosed: (name) => `“${name}” is closed — open it in the document tree first`,
    queued: (count) => (count === 1 ? "Still importing the previous batch — 1 queued behind it" : `Still importing the previous batch — ${count} queued behind it`),
    importFailed: (reason) => `Import failed: ${reason}`,
    warning: (reason) => `Drag Import: ${reason}`,
    notFinished: "Import did not finish",
    openDocFailed: "Couldn't open the document — open it from the tree",
    settingsSaveFailed: "Settings weren't saved — see the console",
    undoRemoved: (count) => `${count} deleted`,
    undoRestored: (count) => `${count} restored`,
    undoNothing: "Nothing to undo",
    undoFailed: (count) => `${count} failed`,
  },

  overlay: {
    root: "notebook root",
    child: "as child",
    dropTo: (label) => `Drop to import into “${label}”`,
  },

  error: {
    tooBig: (mb) => `File exceeds ${mb} MB, skipped`,
    noPermission: "No read permission (maybe locked by another app)",
    notFound: "File is missing or was moved",
    noSpace: "Not enough disk space",
    busy: "File is in use",
    unknown: "Unknown error",
    noFs: "Node fs is unavailable — can't read the file",
    noDocId: "The kernel didn't return a document id",
    noAssetPath: "The kernel didn't return an asset path",
    uploadTimeout: (seconds) => `Upload timed out (${seconds}s)`,
    timeout: (ms) => `Kernel response timed out (${ms}ms)`,
    noKramdown: "The kernel didn't return kramdown",
    appendHeader: (name, stamp) => `> Imported from ${name} (${stamp})`,
  },

  plan: {
    emptyName: "Empty document name — refused (the kernel would create a junk document)",
    checkFailed: (reason) => `Duplicate check failed: ${reason}`,
    sameNameSkipped: "Same name, skipped",
    tooManySame: (attempts) => `Too many documents with this name (tried ${attempts} times)`,
    docGone: "The target document no longer exists (it may have just been moved or deleted)",
  },

  reject: {
    folderNoMd: "No markdown in this folder",
    siyuanExport: "SiYuan export — use Settings → Import",
    noPath: "Can't get the file path, so it can't be unzipped",
    archiveNoMd: "No markdown in the archive",
    onlyZip: "Only .zip for now (convert it first)",
    notMarkdown: (ext) => (ext ? `Not markdown (${ext})` : "Not markdown"),
    binary: "Looks like a binary file, skipped",
    untitled: "Untitled",
    untitledFile: "Untitled file",
  },

  skip: {
    nonMd: (count, exts) => `${count} non-markdown ${count === 1 ? "file" : "files"}${exts}`,
    nonMdReason: "Not imported as documents; uploaded when a note references them",
    assets: (count, exts) => `${count} ${count === 1 ? "image/attachment" : "images/attachments"}${exts}`,
    assetsReason: "Asset folder — not imported; uploaded when referenced",
    emptyDirs: (list, rest, total) => `Folders without markdown: ${list}${rest > 0 ? ` and ${total} in total` : ""}`,
    emptyDirsReason: "Not imported",
    truncated: (limit) => `Too many files — only the first ${limit} were taken`,
    truncatedReason: "Drag them in several batches",
  },

  walk: {
    noPermission: "No read permission",
    gone: "Moved or deleted",
    readFailed: "Read failed",
    pathTooLong: "Path too long (over 259 characters)",
    symlink: "Symlink, skipped",
    tooDeep: "Folder nesting too deep (over 20 levels)",
    noFs: "Node fs is unavailable — can't read the folder",
  },

  archive: {
    badName: "Corrupted archive (invalid characters in a file name)",
    absolutePath: "Corrupted archive (contains an absolute path)",
    parentPath: "Corrupted archive (contains a parent path)",
    tooShort: "Corrupted archive (file too short)",
    noCentral: "Corrupted archive (central directory not found)",
    centralRange: "Corrupted archive (central directory out of range)",
    centralItem: "Corrupted archive (bad directory entry)",
    encrypted: "Encrypted archives aren't supported — extract it first",
    badData: "Corrupted archive (bad data block)",
    truncated: "Corrupted archive (data truncated)",
    broken: "Corrupted archive — nothing was imported",
    failed: "Failed to extract the archive",
    itemTooBig: (mb) => `Entry exceeds ${mb} MB, skipped`,
    tooBig: (limitMB, actualMB) => `Archive too large (limit ${limitMB} MB, got ${actualMB} MB)`,
    tooManyEntries: (count, limit) => `Too many entries in the archive (${count}, limit ${limit})`,
    unsupportedMethod: (method) => `Unsupported compression method (method ${method})`,
    unpackedTooBig: (actualMB, limitMB) => `Archive expands to too much data (${actualMB} MB, limit ${limitMB} MB)`,
  },
};
