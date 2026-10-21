import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

// UpNote is an Electron app, so the database sits in Electron's userData folder ("UpNote").
// macOS (verified): the Mac App Store build is sandboxed, so it lives in the app container.
// Windows and Linux paths follow Electron's defaults and are NOT verified on a real install;
// other packagings (Microsoft Store, snap, flatpak) are not covered. Set UPNOTE_DB for those.
function defaultDbPath(): string {
  const home = homedir();
  const file = "upnote.sqlite3";
  const candidates =
    process.platform === "darwin"
      ? [
          join(home, "Library/Containers/com.getupnote.desktop/Data/Library/Application Support/UpNote", file),
          join(home, "Library/Application Support/UpNote", file),
        ]
      : process.platform === "win32"
        ? [join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "UpNote", file)]
        : [join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "UpNote", file)];
  return candidates.find(existsSync) ?? candidates[0]!;
}

export const DB_PATH = process.env.UPNOTE_DB ?? defaultDbPath();

export interface NoteRow {
  id: string;
  title: string | null;
  summary: string | null;
  trashed: number;
  pinned: number;
  bookmarked: number;
  synced: number;
  space: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NotebookInfo {
  id: string;
  title: string;
  path: string;
  parentId: string | null;
  depth: number;
  noteCount: number;
  locked: boolean;
  lockedByAncestor: boolean;
  space: string | null;
}

// UpNote owns this database (live, WAL, Firebase-synced). It is only ever opened read-only.
function withDb<T>(fn: (db: DatabaseSync) => T): T {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  } catch (e) {
    throw new Error(
      `Cannot open the UpNote database at ${DB_PATH} (${e instanceof Error ? e.message : String(e)}). ` +
        "Open UpNote and sign in once, or set UPNOTE_DB to the path of upnote.sqlite3.",
    );
  }
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const LIST_COLUMNS = "id, title, summary, trashed, pinned, bookmarked, synced, space, createdAt, updatedAt";
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const parseIds = (s: string | null): string[] => {
  try {
    const v: unknown = s ? JSON.parse(s) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

// ---- notebooks -------------------------------------------------------------------------------
// A note belongs to a notebook through `lists` rows keyed `notebooks_<notebookId>` (JSON array of
// note ids). `notes.notebookLinks` is NOT membership: it holds links written inside the note text.
// Nesting is `notebooks.parent` on the child; `childNotebooks` is not maintained.

interface NotebookRow {
  id: string;
  title: string | null;
  parent: string | null;
  locked: number | null;
  space: string | null;
}

interface Model {
  notebooks: Map<string, NotebookRow>;
  members: Map<string, string[]>; // notebookId -> noteIds
  lockedNotebooks: Set<string>; // locked, plus every descendant of a locked notebook
  lockedSpaces: Set<string>;
}

function loadModel(db: DatabaseSync): Model {
  const notebooks = new Map<string, NotebookRow>();
  for (const r of db
    .prepare("SELECT id, title, parent, locked, space FROM notebooks WHERE COALESCE(deleted, 0) = 0")
    .all() as unknown as NotebookRow[])
    notebooks.set(r.id, r);

  const members = new Map<string, string[]>();
  for (const r of db
    .prepare("SELECT id, content FROM lists WHERE id LIKE 'notebooks!_%' ESCAPE '!'")
    .all() as unknown as { id: string; content: string | null }[])
    members.set(r.id.slice("notebooks_".length), parseIds(r.content));

  const locked = new Set<string>();
  const isLocked = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const nb = notebooks.get(id);
    if (!nb) return false;
    return !!nb.locked || (!!nb.parent && isLocked(nb.parent, seen));
  };
  for (const id of notebooks.keys()) if (isLocked(id, new Set())) locked.add(id);

  const lockedSpaces = new Set(
    (
      db.prepare("SELECT id FROM workspaces WHERE locked = 1 AND COALESCE(deleted, 0) = 0").all() as unknown as {
        id: string;
      }[]
    ).map((r) => r.id),
  );
  return { notebooks, members, lockedNotebooks: locked, lockedSpaces };
}

function pathOf(m: Model, id: string): { path: string; depth: number } {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (let cur: string | null | undefined = id; cur && !seen.has(cur); ) {
    seen.add(cur);
    const nb = m.notebooks.get(cur);
    if (!nb) break;
    parts.unshift(nb.title ?? "");
    cur = nb.parent;
  }
  return { path: parts.join("/"), depth: parts.length - 1 };
}

function lockedNoteIds(m: Model): string[] {
  const ids = new Set<string>();
  for (const nbId of m.lockedNotebooks) for (const n of m.members.get(nbId) ?? []) ids.add(n);
  return [...ids];
}

export function listNotebooks(): NotebookInfo[] {
  return withDb((db) => {
    const m = loadModel(db);
    // Trashed notes stay in a notebook's list, so count only live ones.
    const live = new Set(
      (db.prepare("SELECT id FROM notes WHERE trashed = 0 AND deleted = 0").all() as unknown as { id: string }[]).map(
        (r) => r.id,
      ),
    );
    return [...m.notebooks.values()]
      .map((nb) => {
        const { path, depth } = pathOf(m, nb.id);
        return {
          id: nb.id,
          title: nb.title ?? "",
          path,
          parentId: nb.parent || null,
          depth,
          noteCount: (m.members.get(nb.id) ?? []).filter((id) => live.has(id)).length,
          locked: !!nb.locked,
          lockedByAncestor: !nb.locked && m.lockedNotebooks.has(nb.id),
          space: nb.space || null,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  });
}

/** Resolve "A/B/C" to the notebook at that path (exact match, then case-insensitive). */
export function findNotebookByPath(path: string): NotebookInfo | undefined {
  const segs = path.split("/").map((s) => s.trim());
  const all = listNotebooks();
  for (const ci of [false, true]) {
    const norm = (s: string) => (ci ? s.toLowerCase() : s);
    let parent: string | null = null;
    let found: NotebookInfo | undefined;
    for (const seg of segs) {
      found = all.find((n) => n.parentId === parent && norm(n.title) === norm(seg));
      if (!found) break;
      parent = found.id;
    }
    if (found) return found;
  }
  return undefined;
}

/** Notebooks (id + path) each note belongs to. */
export function notebooksOf(noteIds: string[]): Map<string, { id: string; path: string }[]> {
  return withDb((db) => {
    const m = loadModel(db);
    const want = new Set(noteIds);
    const out = new Map<string, { id: string; path: string }[]>();
    for (const [nbId, notes] of m.members) {
      if (!m.notebooks.has(nbId)) continue;
      for (const n of notes) {
        if (!want.has(n)) continue;
        const arr = out.get(n) ?? [];
        arr.push({ id: nbId, path: pathOf(m, nbId).path });
        out.set(n, arr);
      }
    }
    return out;
  });
}

// ---- notes -----------------------------------------------------------------------------------

export function listNotes(opts: {
  limit: number;
  offset: number;
  trashed: boolean;
  notebookId?: string;
  recursive?: boolean;
  query?: string;
}): NoteRow[] {
  return withDb((db) => {
    const m = loadModel(db);
    const where = ["deleted = 0", "COALESCE(isTemplate, 0) = 0", "trashed = ?"];
    const params: (string | number)[] = [opts.trashed ? 1 : 0];

    // Notes in locked notebooks/spaces are never returned.
    where.push("id NOT IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(lockedNoteIds(m)));
    where.push("COALESCE(space, '') NOT IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify([...m.lockedSpaces]));

    if (opts.notebookId) {
      const ids = new Set<string>();
      const walk = (id: string, seen: Set<string>) => {
        if (seen.has(id)) return;
        seen.add(id);
        for (const n of m.members.get(id) ?? []) ids.add(n);
        if (opts.recursive)
          for (const nb of m.notebooks.values()) if (nb.parent === id) walk(nb.id, seen);
      };
      walk(opts.notebookId, new Set());
      where.push("id IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify([...ids]));
    }
    if (opts.query) {
      where.push("(title LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\')");
      const q = `%${likeEscape(opts.query)}%`;
      params.push(q, q);
    }
    return db
      .prepare(
        `SELECT ${LIST_COLUMNS} FROM notes WHERE ${where.join(" AND ")} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, opts.limit, opts.offset) as unknown as NoteRow[];
  });
}

export type NoteDetail = NoteRow & { text: string | null; html: string | null };

/** Returns the note, or `{ locked: true }` when it sits in a locked notebook/space. */
export function getNote(id: string): NoteDetail | { locked: true } | undefined {
  return withDb((db) => {
    const note = db
      .prepare(`SELECT ${LIST_COLUMNS}, text, html FROM notes WHERE id = ? AND deleted = 0`)
      .get(id) as unknown as NoteDetail | undefined;
    if (!note) return undefined;
    const m = loadModel(db);
    if (lockedNoteIds(m).includes(id) || m.lockedSpaces.has(note.space ?? "")) return { locked: true };
    return note;
  });
}

/** Notes created at/after `sinceMs`, newest first. Used to recover the id of a note made via URL scheme. */
export function notesCreatedSince(sinceMs: number): NoteRow[] {
  return withDb(
    (db) =>
      db
        .prepare(
          `SELECT ${LIST_COLUMNS} FROM notes WHERE deleted = 0 AND createdAt >= ? ORDER BY createdAt DESC LIMIT 10`,
        )
        .all(sinceMs) as unknown as NoteRow[],
  );
}

export function noteState(id: string) {
  return withDb(
    (db) =>
      db.prepare("SELECT id, trashed, deleted FROM notes WHERE id = ?").get(id) as unknown as
        | { id: string; trashed: number; deleted: number }
        | undefined,
  );
}

/** Stored HTML for a note. Only used on notes this server created itself (never a locked one). */
export function noteHtml(id: string): string | undefined {
  return withDb(
    (db) =>
      (db.prepare("SELECT html FROM notes WHERE id = ? AND deleted = 0").get(id) as unknown as
        | { html: string | null }
        | undefined)?.html ?? undefined,
  );
}

export function listTags() {
  return withDb(
    (db) =>
      db
        .prepare("SELECT id, title, space FROM tags WHERE COALESCE(deleted, 0) = 0 ORDER BY title")
        .all() as unknown as { id: string; title: string | null; space: string | null }[],
  );
}
