import { expect, test } from "vitest";
import { readCatalog } from "../server/catalog.js";
import { CodexConnection, threadPageSchema, threadSchema } from "../server/codex.js";
import { createCodexFixture } from "./fixtures.js";

test("real Codex lists archived synthetic history and restores the same native thread", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const fixture = await createCodexFixture([
    { id, title: "Sample archived conversation", archived: true, updatedAt: 1767268800 },
  ]);
  const codex = await CodexConnection.open(fixture.launch);
  try {
    const catalog = await readCatalog(codex, {
      workspaceId: "sample-workspace",
      directories: [fixture.workspace],
      query: "",
      status: "all",
      cursor: null,
      excluded: new Set(),
    });
    expect(catalog.entries).toEqual([
      {
        id,
        title: "Sample archived conversation",
        cwd: fixture.workspace,
        updatedAt: 1767268800,
        archived: true,
      },
    ]);
    expect(catalog.nextCursor).toBeNull();
    await codex.request("thread/unarchive", { threadId: id });
    const active = threadPageSchema.parse(
      await codex.request("thread/list", { archived: false, modelProviders: [] }),
    );
    expect(active.data.map((thread) => thread.id)).toEqual([id]);
  } finally {
    await codex.close();
    await fixture.cleanup();
  }
}, 30_000);

test("real Codex forks archived history into the requested directory without changing the source", async () => {
  const id = "11111111-1111-4111-8111-111111111112";
  const fixture = await createCodexFixture([
    {
      id,
      title: "Sample history from another project",
      archived: true,
      updatedAt: 1767268800,
      directory: "/example/previous-project",
    },
  ]);
  const codex = await CodexConnection.open(fixture.launch);
  try {
    await codex.request("thread/unarchive", { threadId: id });
    let response: unknown;
    try {
      response = await codex.request("thread/fork", {
        threadId: id,
        cwd: fixture.workspace,
        excludeTurns: true,
      });
    } finally {
      await codex.request("thread/archive", { threadId: id });
    }
    const fork = threadSchema.parse((response as { thread: unknown }).thread);
    expect(fork.id).not.toBe(id);
    expect(fork.cwd).toBe(fixture.workspace);
    const archived = threadPageSchema.parse(
      await codex.request("thread/list", { archived: true, modelProviders: [] }),
    );
    expect(archived.data.map((thread) => ({ id: thread.id, cwd: thread.cwd }))).toEqual([
      { id, cwd: "/example/previous-project" },
    ]);
    const history = await codex.request("thread/read", { threadId: fork.id, includeTurns: true });
    expect(JSON.stringify(history)).toContain("Sample history from another project");
    expect(JSON.stringify(history)).toContain("This is synthetic test history.");
  } finally {
    await codex.close();
    await fixture.cleanup();
  }
}, 30_000);
