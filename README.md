# Drag Import

**Drop Markdown files, folders or ZIP archives from your file manager onto SiYuan's document tree — the folder hierarchy is recreated as documents, and local images and attachments are uploaded automatically.**

No copy-paste, no "import now, fix later". A folder of 200 notes becomes a folder of 200 documents in one drag.

![Dropping a folder onto the document tree — hierarchy recreated, attachments uploaded, undoable card](https://raw.githubusercontent.com/clock-05/siyuan-drag-import/main/preview.png)

## When it pays off

- Moving a whole Obsidian / Typora / Logseq vault into SiYuan without creating documents one by one.
- You already have a folder tree of Markdown files and want it to stay that way.
- Images and PDFs sit next to the notes and you would rather not re-attach them by hand.

For one or two files, SiYuan's built-in import is enough. This plugin saves the time when it is dozens or hundreds of notes — with the hierarchy intact.

## Features

- **Files, folders, archives.** Drag any number of `.md` / `.markdown` / `.mdown` / `.mkd` files, whole folders, or `.zip` archives. Sub-folders become nested documents; an archive's single wrapping folder is unwrapped instead of duplicated.
- **Conflicts you decide.** When a document with the same name already exists, choose per file or for the whole batch: **skip**, **rename** (`Note (2)`), **replace** (keep the document id and its child documents), or **append** (add the content at the end with a source line).
- **Undo that means undo.** For 30 seconds (configurable) one click removes the documents this batch created and restores every document it replaced or appended — the original text is snapshotted before writing.
- **Attachments handled.** Images and other local files referenced by the Markdown are uploaded to `assets/` and the links are rewritten. `![](...)`, `![[...]]`, `[pdf](files/a.pdf)`, `file:///C:/...` and `%20` paths all work. Code blocks are left untouched.
- **Obsidian friendly.** `![[image.png]]` embeds become image or file links, and `[[note]]` links become SiYuan block references when the target note is imported in the same batch.
- **Honest progress.** A card shows the count, the current file and an estimate of the remaining time; you can cancel mid-way (documents already created are kept and can still be undone).
- **Failures are not fatal.** A failed file is listed with its reason, and only those files can be retried. Every batch is logged to a JSONL file you can open from the result card.
- **Chinese and English UI**, following SiYuan's own language setting.

## Install

From the marketplace: **Settings → Marketplace → Plugins → Drag Import → Install**.

Manually: download `package.zip` from the latest release, extract it into `<workspace>/data/plugins/siyuan-drag-import/`, and restart SiYuan.

The plugin needs the desktop app (Windows, macOS or Linux) — it uses the local file system. Minimum SiYuan version is 3.1.0; it is developed and fully tested against 3.8.8.

## Usage

1. Drag files from Explorer / Finder / your file manager onto the **document tree** (not the editor).
2. Drop on a **notebook row** to import at its root, or on a **document** to import as its children. Dropping on the empty space of a notebook section also means "its root".
3. If names collide, pick a strategy on the conflict card.
4. The result card lets you open the first document, undo the import, retry failures, or open the log.

Dragging near the top or bottom edge of the tree scrolls it, so deep targets are reachable without pre-scrolling.

### The result card

| State | What it does |
| --- | --- |
| Full card | Counts, per-file failures, and the buttons above |
| Collapsed bar after 4 s | Stays while undo is available or something failed |
| Zero result | Disappears after 5 s — "nothing imported" needs no permanent billboard |

## What happens to your Markdown

| Markdown | Result in SiYuan |
| --- | --- |
| YAML frontmatter | Removed (can be kept in settings) |
| First `# Heading` equal to the document name | Removed (configurable) |
| UTF-8 / UTF-8 BOM / GBK | Detected automatically; files containing NUL bytes are rejected as binary |
| `$inline$`, `$$block$$` | Left as-is — SiYuan renders them |
| `> [!note]` callouts, `- [ ]` tasks, `==highlight==`, `[^1]` footnotes | Left as-is — SiYuan renders them |
| Local images / attachments | Uploaded, links rewritten; each file is uploaded once per batch |
| `[[note]]`, `[[note\|alias]]` | Converted to a SiYuan block reference when the target is in the same batch |
| `[[note#heading]]` | Left as-is (a block reference cannot point at a heading) |
| Code blocks and inline code | Never rewritten |

## Settings

**Settings → Marketplace → Plugins → Drag Import (gear icon)**, or the plugin entry in the top-bar plugin menu.

| Setting | Default | Meaning |
| --- | --- | --- |
| Upload local images and attachments | On | Off keeps the original relative paths |
| Strip frontmatter | On | Remove the leading YAML block |
| Remove duplicate first H1 | On | Drop the heading when it repeats the document name |
| Convert Obsidian wiki links | On | `[[note]]` → block reference within the same batch |
| Default handling for duplicates | Rename | Pre-selected on the conflict card |
| Max size per file (MB) | 20 | Larger Markdown files are skipped and listed |
| Undo window (seconds) | 30 | 10–300; raise it if you like to check before undoing |
| Restore defaults | — | Resets and saves all of the above |

## Limits

- Desktop only; archives other than `.zip` (`.rar`, `.7z`, …) must be converted first.
- SiYuan's own export archives (`.sy.zip`) are not handled — use **Settings → Import → SiYuan .sy.zip**.
- Empty folders do not create documents, and `assets` / `images` / `img` / `attachments` / `static` folders are not imported as documents (their files are uploaded when referenced).
- At most 2000 Markdown files per drop; archives are capped at 200 MB (500 MB unpacked).
- Undo snapshots live in memory only: restarting SiYuan ends the undo window.
- Wiki links are resolved only inside the batch being imported. Links to notes that are not part of the same drag are kept as text — guessing across the whole notebook would risk pointing at the wrong note.
- Append mode keeps the document's existing blocks, so `[[links]]` inside an appended section are left as text.

## Troubleshooting

- Nothing happens on drop: make sure the file is dropped on the **document tree** (the editor keeps its own drag-and-drop) and that the plugin is enabled.
- "Attachment not found" in the result card: the Markdown refers to a file that is not next to it (or inside the dragged folder). The link is kept as-is so nothing is lost.
- Something went wrong: the result card has **Open log**; the JSONL file lives in `<workspace>/data/storage/petal/siyuan-drag-import/logs/`. It records each phase and its duration, which is the fastest way to tell an importer problem from a kernel one.

## Development

```bash
npm install
npm run dev          # watch build; set SIYUAN_WORKSPACE in .env to sync into your workspace
npm run build        # production build into dist/
npm run verify       # typecheck + build + all tests (end-to-end tests need SiYuan running)
npm run test:offline # tests that do not need a running SiYuan
```

The plugin is TypeScript, bundled with esbuild into a CommonJS `index.js`. Import logic lives in `src/import/`, drop handling in `src/drop/`, UI in `src/ui/`, and all user-facing copy in `src/i18n/messages.{zh,en}.ts` (a test fails if Chinese copy appears outside that folder).

See `docs/DESIGN.md` for the behaviour contract and `docs/RESTORE-SPIKE.md` for the snapshot experiments behind undo.

## A note on how this was written

The code of this plugin was written entirely by AI. The author wrote the requirements, tested every release by hand, and is responsible for what ships.

## License

MIT — see [LICENSE](LICENSE).
