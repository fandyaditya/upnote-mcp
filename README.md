# @fandyaditya/upnote-mcp

An MCP server that lets AI agents create, revise and read notes in [UpNote](https://getupnote.com).

Unofficial. Not made or supported by UpNote Pte. Ltd.

An agent can:

- create notes with tables, images, lists, code blocks, highlights and alignment
- put notes in nested notebooks (`Work/Projects/Alpha`)
- revise a note it made earlier
- search and read your notes

## Requirements

- UpNote desktop app, opened and signed in once
- Node.js 22.13 or newer
- macOS, Windows or Linux. Tested with a real UpNote on macOS only.

## Install

Add the server to your agent. The command it runs is:

```bash
npx -y @fandyaditya/upnote-mcp
```

### Claude Code

```bash
claude mcp add --scope user upnote -- npx -y @fandyaditya/upnote-mcp
```

### Codex

```bash
codex mcp add upnote -- npx -y @fandyaditya/upnote-mcp
```

### Pi

```bash
pi mcp add upnote -- npx -y @fandyaditya/upnote-mcp
```

### OpenCode

Add this to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "upnote": {
      "type": "local",
      "command": ["npx", "-y", "@fandyaditya/upnote-mcp"],
      "enabled": true
    }
  }
}
```

### Cursor Agent

Add this to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "upnote": {
      "command": "npx",
      "args": ["-y", "@fandyaditya/upnote-mcp"]
    }
  }
}
```

### Any other agent

Register a stdio server with command `npx` and arguments `-y @fandyaditya/upnote-mcp`.

Restart your agent after adding the server, then ask it: "List my UpNote notebooks."

OpenCode and Cursor were not tested with the real apps. On native Windows, if `npx` does not start, use `cmd` with arguments `/c npx -y @fandyaditya/upnote-mcp`.

### Read-only mode

Set `UPNOTE_READONLY=1` to remove all tools that change UpNote:

```bash
claude mcp add --scope user upnote -e UPNOTE_READONLY=1 -- npx -y @fandyaditya/upnote-mcp
codex mcp add upnote --env UPNOTE_READONLY=1 -- npx -y @fandyaditya/upnote-mcp
pi mcp add upnote --env UPNOTE_READONLY=1 -- npx -y @fandyaditya/upnote-mcp
```

For Cursor, add `"env": { "UPNOTE_READONLY": "1" }`. For OpenCode, add `"environment": { "UPNOTE_READONLY": "1" }`.

With Claude Code, put the name (`upnote`) before `-e`.

### Settings

| Variable | Default | What it does |
|---|---|---|
| `UPNOTE_READONLY` | off | `1` removes the write tools. |
| `UPNOTE_DB` | auto | Path to `upnote.sqlite3`, if it is not found. |
| `UPNOTE_MAX_URL_LENGTH` | 100000 (30000 on Windows) | Longest URL sent to UpNote. Long notes and images need long URLs. |

## Let your agent install it

Paste this to your AI agent:

````text
Install the UpNote MCP server for yourself.

1. Check that Node.js is version 22.13 or newer and that UpNote is installed.
2. Ask me: full access (create and revise notes) or read-only?
3. Tell me the exact command or config change for your own client, and wait for my OK.
   The package is @fandyaditya/upnote-mcp, run with: npx -y @fandyaditya/upnote-mcp
   Read-only means setting the environment variable UPNOTE_READONLY=1.
4. Apply it, then tell me to restart you.
5. After the restart, call list_notebooks to check that it works.
````

## Tools

| Tool | What it does |
|---|---|
| `create_note` | Create a note from Markdown (plus a few HTML extras). Optional notebook name or path like `A/B/C`; missing notebooks are created. |
| `import_images` | Import local images so they can be resized and aligned in a note. |
| `revise_note` | Replace a note with a new version in the same notebook. |
| `create_notebook` | Create a top-level notebook. |
| `trash_note` | Move a note to the Trash. |
| `restore_note` | Move a note out of the Trash. |
| `open_in_upnote` | Show a note, notebook, tag or view in UpNote, or run a search. |
| `list_notes` | List notes, optionally in one notebook. |
| `search_notes` | Search notes by text. |
| `get_note` | Read one note. |
| `list_notebooks` | List the notebook tree. |
| `list_tags` | List tags. |

The first six change UpNote. The rest only read.

## How it works

- **Writing:** the server sends a `upnote://x-callback-url/...` link ([docs](https://help.getupnote.com/resources/x-callback-url-endpoints)) and UpNote makes the note.
- **Reading:** the server opens UpNote's local `upnote.sqlite3` file read-only. It never writes to it.
- **Revising:** UpNote cannot edit a note by link, so `revise_note` makes a new note and trashes the old one. The new note has a new id, and the old pin, bookmark and history do not carry over.
- **Images:** UpNote makes imported images 100% wide. To get other sizes, call `import_images` first, then use `![alt](URL){width=40% align=center}` in `create_note`.

## Formatting tips

Notes are written in Markdown. These also work:

| You want | Write |
|---|---|
| Underline | `<u>text</u>` |
| Green highlight | `==text==` |
| Other highlight colors | `<span class="shine-highlight-red">text</span>` (also `-orange`, `-blue`, `-yellow`, `-pink`, `-purple`, `-gray`) |
| Center or right align | `<div style="text-align:center">...</div>` |
| Table with column widths | an HTML `<table>` with `<colgroup>` |
| Checklist | `- [ ] task` |

`<mark>`, text color and `align=` are dropped by UpNote. Markdown tables get equal 200px columns.

## Limits

- No in-place editing, moving notes between notebooks, or tags.
- Notebooks cannot be renamed, moved or deleted by the server. Delete them in UpNote.
- Locked notebooks and spaces are hidden from the read tools.
- Very long notes can exceed the URL limit. Split them.
- On Windows and Linux, UpNote may take focus when a note is created, and large images need [ImageMagick](https://imagemagick.org) to be resized.
- Windows and Linux are not tested with a real UpNote. If the database is not found, set `UPNOTE_DB`.
- The UpNote database format is not public and can change.

## Troubleshooting

| Problem | Fix |
|---|---|
| No `upnote` tools in the agent | Restart the agent. |
| `Cannot open the UpNote database` | Open UpNote and sign in once, or set `UPNOTE_DB`. |
| No write tools | `UPNOTE_READONLY=1` is set. Remove it. |
| Note not created | UpNote must be installed and signed in. On Linux, install `xdg-utils`. |
| `Invalid environment variable format: upnote` | In `claude mcp add`, put `upnote` before `-e`. |
| `ExperimentalWarning: SQLite` | Harmless. Node 22 prints it. |

## Run from source

```bash
git clone https://github.com/fandyaditya/upnote-mcp.git
cd upnote-mcp
npm install
npm run build
claude mcp add upnote -- node "$(pwd)/dist/index.js"
```

Use the full path to `dist/index.js` with any other agent too.

## Contribute

1. Fork the repo and make a branch.
2. Change the code in `src/`.
3. Run `npm test`.
4. Open a pull request.

## License

Not set yet.
