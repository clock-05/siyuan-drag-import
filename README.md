# Drag Import

**SiYuan's built-in import means right-clicking in the document tree, then picking a path and a file — a bit tedious. This plugin lets you drag files straight from your file manager onto the document tree.**

![Dropping a folder onto the document tree — hierarchy recreated, attachments uploaded, undoable card](https://raw.githubusercontent.com/clock-05/siyuan-drag-import/main/preview.png)

## Features

- **Files, folders and archives.** Drag any number of `.md` / `.markdown` / `.mdown` / `.mkd` files, whole folders, or `.zip` archives. Sub-folders become nested documents.
- **Different strategies for name conflicts.** Choose per file or for the whole batch: skip, rename (`Note (2)`), replace (keeps the document id and its child documents), or append (adds the content at the end with a source line).
- **Undo for a while after importing.** Undo brings you back to the state before the import. Pressing "Cancel and undo" mid-import leaves nothing behind.
- **Attachments come along.** Images and other local attachments referenced by the Markdown are uploaded to `assets/` (the assets panel) and the links are rewritten.
- **Obsidian friendly.** `![[image.png]]` becomes an image or file link, and `[[note]]` becomes a SiYuan block reference when the target note is imported in the same batch — click it to jump.

## Install

From the marketplace: **Settings → Marketplace → Plugins → Drag Import → Install**.

Manually: download `package.zip` from the latest release, extract it into `<workspace>/data/plugins/siyuan-drag-import/`, and restart SiYuan.

Windows desktop only — the plugin reads the local file system. Developed and fully tested against 3.8.8.

## Usage

1. Drag files from Explorer / Finder onto the **document tree** (not the editor).
2. Drop on a **notebook row** to import at its root, or on a **document** to import as its children. Dropping on the empty space of a notebook section also means "its root".
3. If names collide, pick a strategy on the conflict card.
4. The result card lets you open the first document, undo the import, retry failures, or open the log.

## What happens to your Markdown

| Markdown                                                   | Result in SiYuan                        |
| ---------------------------------------------------------- | --------------------------------------- |
| YAML frontmatter                                           | Removed (can be kept in settings)       |
| First `# Heading` equal to the document name                | Removed (configurable)                  |
| UTF-8 / UTF-8 BOM / GBK                                    | Detected automatically; NUL bytes → binary |
| `$inline$`, `$$block$$`                                    | Left as-is — SiYuan renders them        |
| `> [!note]` callouts, `- [ ]` tasks, `==highlight==`, `[^1]` footnotes | Left as-is — SiYuan renders them |
| Local images / attachments                                 | Uploaded, links rewritten; each file uploaded once per batch |
| `[[note]]`, `[[note\|alias]]`                              | Converted to a block reference when the target is in the same batch |
| `[[note#heading]]`                                         | Left as-is (a block reference cannot point at a heading) |
| Code blocks and inline code                                | Never rewritten                         |

## Settings

**Settings → Marketplace → Plugins → Drag Import (gear icon)**, or the plugin entry in the top-bar plugin menu.

| Setting                     | Default | Meaning                                     |
| --------------------------- | ------- | ------------------------------------------- |
| Upload local images and attachments | On | Off keeps the original relative paths        |
| Strip frontmatter           | On      | Remove the leading YAML block                |
| Remove duplicate first H1    | On      | Drop the heading when it repeats the name    |
| Convert Obsidian wiki links | On      | `[[note]]` → block reference within the batch |
| Default handling for duplicates | Rename | Pre-selected on the conflict card        |
| Max size per file (MB)      | 20      | Larger files are skipped and listed          |
| Undo window (seconds)       | 30      | 10–300; raise it to check before undoing     |
| Restore defaults            | —       | Resets and saves all of the above            |

## Limits

- Windows desktop only; archives other than `.zip` (`.rar`, `.7z`, …) must be converted first.
- SiYuan's own export archives (`.sy.zip`) are not handled — use **Settings → Import → SiYuan .sy.zip**.
- Empty folders do not create documents, and `assets` / `images` / `img` / `attachments` / `static` folders are not imported as documents (their files are uploaded when referenced).
- At most 2000 Markdown files per drop; archives are capped at 200 MB (500 MB unpacked).
- Undo snapshots live in memory only.
- Wiki links are resolved only inside the batch being imported.
- Append mode keeps the document's existing blocks, so `[[links]]` inside an appended section are left as text.

## Troubleshooting

- Nothing happens on drop: make sure the file is dropped on the **document tree** (the editor has its own drag-and-drop) and that the plugin is enabled.
- "Attachment not found" on the card: the Markdown refers to a file that is not next to it (or inside the dragged folder). The link is kept as-is.
- Something went wrong: click **Open log** on the result card; the JSONL is in `<workspace>/data/storage/petal/siyuan-drag-import/logs/`. It records each phase and its duration.

## Development

```bash
npm install
npm run dev          # watch build; set SIYUAN_WORKSPACE in .env to sync into your workspace
npm run build        # production build into dist/
npm run verify       # typecheck + build + all tests (end-to-end tests need SiYuan running)
npm run test:offline # tests that do not need a running SiYuan
```

The plugin is TypeScript, bundled with esbuild into a CommonJS `index.js`. Import logic lives in `src/import/`, drop handling in `src/drop/`, UI in `src/ui/`, and all user-facing copy in `src/i18n/messages.{zh,en}.ts` (a test fails if Chinese copy appears outside that folder).

See `docs/DESIGN.md` for the behaviour contract, `docs/RESTORE-SPIKE.md` for the snapshot experiments behind undo, and `docs/MILESTONES.md` for the development milestones.

## License

MIT, see [LICENSE](LICENSE).
