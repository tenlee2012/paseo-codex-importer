import { expect, test } from "vitest";
import { readCatalog } from "../server/catalog.js";
import { CodexConnection, threadPageSchema } from "../server/codex.js";
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
