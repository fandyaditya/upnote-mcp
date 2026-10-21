// Offline tests. They use a synthetic database, run the built server over stdio,
// and never open UpNote or write to a real database. Run `npm run build` first.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { makeFakeDb } from "./fake-db.mjs";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const WRITE_TOOLS = ["create_note", "import_images", "create_notebook", "trash_note", "restore_note", "revise_note"];

async function connect(dbPath, env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { ...process.env, UPNOTE_DB: dbPath, ...env },
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content[0].text;
    return { isError: !!r.isError, data: /^[[{]/.test(text) ? JSON.parse(text) : text };
  };
  return { client, call };
}

describe("locked content", () => {
  let dir, dbPath, c;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "upnote-mcp-test-"));
    dbPath = join(dir, "fake.sqlite3");
    makeFakeDb(dbPath);
    c = await connect(dbPath);
  });
  after(async () => {
    await c.client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const titles = (r) => r.data.map((n) => n.title);

  it("hides notes in locked notebooks, their children and locked spaces", async () => {
    assert.deepEqual(titles(await c.call("list_notes")).sort(), ["Open note in Open/Sub", "Public note"]);
    assert.deepEqual(titles(await c.call("search_notes", { query: "Secret" })), []);
    assert.deepEqual(titles(await c.call("list_notes", { notebook: "Vault", recursive: true })), []);
  });

  it("refuses get_note for locked notes and returns open ones", async () => {
    for (const id of ["n2", "n3", "n5"]) assert.equal((await c.call("get_note", { noteId: id })).isError, true, id);
    const open = await c.call("get_note", { noteId: "n4" });
    assert.equal(open.isError, false);
    assert.equal(open.data.notebooks[0].path, "Open/Sub");
  });

  it("lists nested notebooks with lock flags and note counts", async () => {
    const byPath = Object.fromEntries((await c.call("list_notebooks")).data.map((n) => [n.path, n]));
    assert.equal(byPath["Vault"].locked, true);
    assert.equal(byPath["Vault/Inner"].lockedByAncestor, true);
    assert.equal(byPath["Open/Sub"].depth, 1);
    assert.equal(byPath["Open/Sub"].noteCount, 1);
  });

  it("never changes the database file", async () => {
    const sha = () => createHash("sha256").update(readFileSync(dbPath)).digest("hex");
    const before = sha();
    for (const [name, args] of [["list_notes"], ["list_notebooks"], ["list_tags"], ["get_note", { noteId: "n1" }]])
      await c.call(name, args);
    assert.equal(sha(), before);
  });
});

describe("tool registration", () => {
  it("registers write tools by default and hides them with UPNOTE_READONLY=1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "upnote-mcp-test-"));
    const dbPath = join(dir, "fake.sqlite3");
    makeFakeDb(dbPath);
    try {
      const rw = await connect(dbPath);
      const ro = await connect(dbPath, { UPNOTE_READONLY: "1" });
      const names = async (c) => (await c.client.listTools()).tools.map((t) => t.name);
      const rwNames = await names(rw);
      const roNames = await names(ro);
      for (const t of WRITE_TOOLS) {
        assert.ok(rwNames.includes(t), `${t} should exist`);
        assert.ok(!roNames.includes(t), `${t} should be hidden`);
      }
      for (const t of ["open_in_upnote", "list_notes", "search_notes", "get_note", "list_notebooks", "list_tags"])
        assert.ok(roNames.includes(t), `${t} should stay`);
      await rw.client.close();
      await ro.client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
