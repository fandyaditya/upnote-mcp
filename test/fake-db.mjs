import { DatabaseSync } from "node:sqlite";

/** Builds a synthetic UpNote database: a locked notebook with a child, a locked space, and an open tree. */
export function makeFakeDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`
CREATE TABLE notes (id TEXT PRIMARY KEY, html TEXT, text TEXT, trashed INTEGER, deleted INTEGER, pinned INTEGER, bookmarked INTEGER, synced INTEGER, isTemplate INTEGER, space TEXT, title TEXT, summary TEXT, createdAt DOUBLE, updatedAt DOUBLE) WITHOUT ROWID;
CREATE TABLE notebooks (id TEXT PRIMARY KEY, title TEXT, parent TEXT, locked INTEGER, deleted INTEGER, space TEXT, updatedAt DOUBLE) WITHOUT ROWID;
CREATE TABLE lists (id TEXT PRIMARY KEY, content TEXT, space TEXT) WITHOUT ROWID;
CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT, locked INTEGER, deleted INTEGER) WITHOUT ROWID;
CREATE TABLE tags (id TEXT PRIMARY KEY, title TEXT, space TEXT, deleted INTEGER) WITHOUT ROWID;
`);
  const note = (id, title, space = "") =>
    db
      .prepare("INSERT INTO notes VALUES (?,?,?,0,0,0,0,1,NULL,?,?,?,1,?)")
      .run(id, `<h1>${title}</h1>`, `${title} body`, space, title, `${title} summary`, Number(id.slice(1)));
  note("n1", "Public note");
  note("n2", "Secret in locked notebook");
  note("n3", "Secret in child of locked");
  note("n4", "Open note in Open/Sub");
  note("n5", "Secret in locked space", "sp1");

  const notebook = (id, title, parent, locked) =>
    db.prepare("INSERT INTO notebooks VALUES (?,?,?,?,0,'',1)").run(id, title, parent, locked);
  notebook("b1", "Vault", null, 1);
  notebook("b2", "Inner", "b1", 0);
  notebook("b3", "Open", null, 0);
  notebook("b4", "Sub", "b3", 0);

  const list = (id, ids) => db.prepare("INSERT INTO lists VALUES (?,?,'')").run("notebooks_" + id, JSON.stringify(ids));
  list("b1", ["n2"]);
  list("b2", ["n3"]);
  list("b4", ["n4"]);
  db.prepare("INSERT INTO workspaces VALUES ('sp1','Private',1,0)").run();
  db.close();
}
