import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCleanup } from "../src/cleanup";
import { config } from "../src/config";
import { db } from "../src/db";
import { deleteFile, downloadFile, fileDir, listFiles, uploadFile, type User } from "../src/files";

const alice: User = { sub: "alice", name: "Alice", email: null };
const bob: User = { sub: "bob", name: "Bob", email: null };

interface Uploaded {
  id: string;
  filename: string;
  size: number;
  url: string;
  expiresAt: number;
}

async function upload(name: string, body: string | Uint8Array<ArrayBuffer>, user = alice) {
  const req = new Request(`http://fdrop.test/api/files?name=${encodeURIComponent(name)}`, {
    method: "PUT",
    body,
  });
  return uploadFile(req, user);
}

describe("upload and download", () => {
  test("stores the file and serves it as a forced download", async () => {
    const res = await upload("hello wörld.html", "<script>alert(1)</script>");
    expect(res.status).toBe(201);
    const file = (await res.json()) as Uploaded;

    expect(file.url).toBe(`http://fdrop.test/s/${file.id}/hello%20w%C3%B6rld.html`);
    expect(file.size).toBe(25);
    expect(file.expiresAt - Date.now()).toBeGreaterThan(config.retentionMs - 5000);
    expect(readdirSync(fileDir(file.id))).toEqual(["hello wörld.html"]);

    const dl = await downloadFile(file.id, "hello%20w%C3%B6rld.html");
    expect(dl.status).toBe(200);
    expect(await dl.text()).toBe("<script>alert(1)</script>");
    expect(dl.headers.get("content-type")).toBe("application/octet-stream");
    expect(dl.headers.get("content-disposition")).toStartWith("attachment;");
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("404s for a wrong name, wrong id, or malformed id", async () => {
    const file = (await (await upload("a.txt", "a")).json()) as Uploaded;
    expect((await downloadFile(file.id, "b.txt")).status).toBe(404);
    expect((await downloadFile("A".repeat(22), "a.txt")).status).toBe(404);
    expect((await downloadFile("../../etc", "passwd")).status).toBe(404);
  });

  test("rejects names that sanitise to nothing", async () => {
    expect((await upload("..", "x")).status).toBe(400);
  });

  test("rejects uploads over the limit and leaves no folder behind", async () => {
    const before = readdirSync(config.filesDir).length;
    const res = await upload("big.bin", new Uint8Array(config.maxUploadBytes + 1));
    expect(res.status).toBe(413);
    expect(readdirSync(config.filesDir).length).toBe(before);
  });
});

describe("ownership", () => {
  test("users only list and delete their own files", async () => {
    const file = (await (await upload("mine.txt", "secret", alice)).json()) as Uploaded;

    const bobList = (await listFiles(bob).json()) as Uploaded[];
    expect(bobList.find((f) => f.id === file.id)).toBeUndefined();
    expect((await deleteFile(file.id, bob)).status).toBe(404);
    expect(existsSync(fileDir(file.id))).toBe(true);

    const aliceList = (await listFiles(alice).json()) as Uploaded[];
    expect(aliceList.find((f) => f.id === file.id)).toBeDefined();
    expect((await deleteFile(file.id, alice)).status).toBe(204);
    expect(existsSync(fileDir(file.id))).toBe(false);
    expect((await downloadFile(file.id, "mine.txt")).status).toBe(404);
  });
});

describe("cleanup", () => {
  test("removes expired files with their folders and keeps live ones", async () => {
    const old = (await (await upload("old.txt", "old")).json()) as Uploaded;
    const live = (await (await upload("live.txt", "live")).json()) as Uploaded;
    db.run("UPDATE files SET expires_at = ? WHERE id = ?", [Date.now() - 1000, old.id]);

    // Expired links stop working even before the sweep runs.
    expect((await downloadFile(old.id, "old.txt")).status).toBe(404);

    const result = await runCleanup();
    expect(result.expired).toBe(1);
    expect(existsSync(fileDir(old.id))).toBe(false);
    expect(existsSync(fileDir(live.id))).toBe(true);
    expect((await downloadFile(live.id, "live.txt")).status).toBe(200);
  });

  test("never removes the folder of an upload that is still in progress", async () => {
    const before = new Set(readdirSync(config.filesDir));
    let send!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (controller) => void (send = controller) });
    const pending = uploadFile(
      new Request("http://fdrop.test/api/files?name=slow.bin", { method: "PUT", body }),
      alice,
    );
    send.enqueue(new TextEncoder().encode("first half, "));
    await Bun.sleep(50);

    const [id] = readdirSync(config.filesDir).filter((name) => !before.has(name));
    expect(id).toBeDefined();

    // Two hours later the folder is past the orphan grace period and still has no row.
    const result = await runCleanup(Date.now() + 2 * 60 * 60 * 1000);
    expect(result.orphanDirs).toBe(0);
    expect(existsSync(fileDir(id!))).toBe(true);

    send.enqueue(new TextEncoder().encode("second half"));
    send.close();
    const res = await pending;
    expect(res.status).toBe(201);
    expect(await (await downloadFile(id!, "slow.bin")).text()).toBe("first half, second half");
  });

  test("removes stale empty and orphaned folders but not fresh ones", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const staleEmpty = join(config.filesDir, "stale-empty");
    const staleOrphan = join(config.filesDir, "stale-orphan");
    const freshOrphan = join(config.filesDir, "fresh-orphan");
    for (const dir of [staleEmpty, staleOrphan, freshOrphan]) mkdirSync(dir);
    writeFileSync(join(staleOrphan, "partial.bin"), "x");
    writeFileSync(join(freshOrphan, "uploading.bin"), "x");
    utimesSync(staleEmpty, twoHoursAgo, twoHoursAgo);
    utimesSync(staleOrphan, twoHoursAgo, twoHoursAgo);

    const result = await runCleanup();
    expect(result.emptyDirs).toBe(1);
    expect(result.orphanDirs).toBe(1);
    expect(existsSync(staleEmpty)).toBe(false);
    expect(existsSync(staleOrphan)).toBe(false);
    expect(existsSync(freshOrphan)).toBe(true);
  });
});
