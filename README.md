# Drag Import

**SiYuan's built-in import means right-clicking in the document tree, then picking a path and a file — a bit tedious. This plugin lets you drag files straight from your file manager onto the document tree.**

![Dropping a folder onto the document tree — hierarchy recreated, attachments uploaded, undoable card](https://raw.githubusercontent.com/clock-05/siyuan-drag-import/main/preview.png)

## Features

- **Files, folders and archives.** Drag several `.md` files at once, a whole folder, or a `.zip`; sub-folders become sub-documents.
- **Duplicate names are up to you.** Skip, rename, replace or append — per file, or in one click for the whole batch.
- **Undo after importing**, back to how things were before.
- **Attachments come along.** Images and other local files referenced by the text are uploaded, and the links are rewritten.
- **Friendly to Obsidian.** `![[image.png]]` becomes an image link, and `[[note]]` from the same batch becomes a SiYuan block reference.

## Usage

1. Drag files from Explorer / Finder onto the **document tree** (not the editor).
2. Drop on a **notebook row** to import at its root, or on a **document** to import as its children. Dropping on the empty space of a notebook section also means "its root".
3. If names collide, pick a strategy on the conflict card.
4. The result card lets you open the first document, undo the import, retry failures, or open the log.

## Settings

**Settings → Marketplace → Plugins → Drag Import (gear icon)**, or the plugin entry in the top-bar plugin menu.

| Setting                     | Default | Meaning                                     |
| --------------------------- | ------- | ------------------------------------------- |
| Default handling for duplicates | Rename | Pre-selected on the conflict card        |
| Undo window (seconds)       | 30      | 10–300; raise it to check before undoing     |
| Max size per file (MB)      | 20      | Larger files are skipped and listed          |
| Keep the top-level folder    | On      | The dropped folder becomes a document; sub-folders keep their nesting either way. Off puts the contents straight into the drop target |
| Strip frontmatter           | On      | Removes the leading YAML block; off keeps it as-is |
| Remove duplicate first H1    | On      | Drop the heading when it repeats the name    |
| Upload attachments          | On      | Off keeps the original paths (images break)  |
| Convert Obsidian wiki links | On      | `[[note]]` → block reference within the batch |
| Restore defaults            | —       | Resets and saves all of the above            |

## Markdown compatibility

Four things get changed; everything else is handed to SiYuan untouched.

| Changed                                                    | What happens                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| YAML frontmatter at the top                                | Removed — SiYuan doesn't parse it, so it would show up as two horizontal rules (can be turned off in settings) |
| First `# Heading` equal to the document name                | Removed, so the title isn't shown twice (can be turned off in settings) |
| Images / attachments pointing at local files                | Uploaded to `assets/` with the links rewritten; each file uploaded once per batch |
| `[[note]]`, `[[note\|alias]]` within the same batch         | Turned into SiYuan block references                                |

## Limits

- Windows desktop only; archives other than `.zip` (`.rar`, `.7z`, …) must be converted first.
- SiYuan's own export archives (`.sy.zip`) are not handled — use **Settings → Import → SiYuan .sy.zip**.
- Empty folders do not create documents, and `assets` / `images` / `img` / `attachments` / `static` folders are not imported as documents (their files are uploaded when referenced).
- At most 2000 Markdown files per drop; archives are capped at 200 MB (500 MB unpacked).
- Undo snapshots live in memory only.
- Wiki links are resolved only inside the batch being imported.
- Append mode keeps the document's existing blocks, so `[[links]]` inside an appended section are left as text.
- Requires SiYuan 3.8.0 or newer; developed and fully tested against 3.8.8.

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
