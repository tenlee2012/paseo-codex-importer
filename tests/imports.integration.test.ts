import { expect, test } from "vitest";
import { importSession, listSessions } from "../shared/contracts.js";
import { createDaemonFixture } from "./daemon-fixture.js";

test("real Paseo plugin imports archived history, filters duplicates, and reuses an archived agent", async () => {
  const threadId = "33333333-3333-4333-8333-333333333333";
  const aliasId = "33333333-3333-4333-8333-333333333334";
  const otherId = "33333333-3333-4333-8333-333333333335";
  const fixture = await createDaemonFixture([
    { id: threadId, title: "Sample archived work", archived: true, updatedAt: 1767268800 },
    { id: aliasId, title: "Sample custom provider history", updatedAt: 1767268700 },
    {
      id: otherId,
      title: "Sample other directory history",
      archived: true,
      updatedAt: 1767268600,
      directory: "/example/other-project",
    },
  ]);
  const input = { workspaceId: fixture.workspaceId, query: "", status: "all", cursor: null };
  try {
    await fixture.client.importAgent({
      providerId: "sample-codex",
      providerHandleId: aliasId,
      cwd: fixture.workspace,
      workspaceId: fixture.workspaceId,
    });
    const list = async () =>
      listSessions.output.parse(
        await fixture.client.invokePluginRpc("codex-importer", listSessions.name, input),
      );
    const restore = async () =>
      importSession.output.parse(
        await fixture.client.invokePluginRpc("codex-importer", importSession.name, {
          workspaceId: fixture.workspaceId,
          threadId,
          archived: true,
        }),
      );
    const before = await list();
    expect(before.ok).toBe(true);
    if (!before.ok) throw new Error(before.error);
    expect(before.entries.map(({ id, archived }) => ({ id, archived }))).toEqual([
      { id: threadId, archived: true },
    ]);
    const wrongDirectory = await fixture.client.invokePluginRpc(
      "codex-importer",
      importSession.name,
      { workspaceId: fixture.workspaceId, threadId: otherId, archived: true },
    );
    expect(wrongDirectory).toEqual({ ok: false, error: "wrong_directory" });
    const aliasDuplicate = await fixture.client.invokePluginRpc(
      "codex-importer",
      importSession.name,
      { workspaceId: fixture.workspaceId, threadId: aliasId, archived: false },
    );
    expect(aliasDuplicate).toEqual({ ok: false, error: "already_imported" });

    const imported = await restore();
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error(imported.error);
    expect(imported.workspaceId).toBe(fixture.workspaceId);
    const agent = fixture.paseo.agents.ref(imported.agentId);
    await agent.refresh();
    expect(agent.current()?.persistence?.sessionId).toBe(threadId);
    expect(await restore()).toEqual({ ok: false, error: "already_imported" });
    const after = await list();
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error(after.error);
    expect(after.entries).toEqual([]);

    await agent.archive();
    const archived = await list();
    expect(archived.ok).toBe(true);
    if (!archived.ok) throw new Error(archived.error);
    expect(archived.entries.map(({ id, archived }) => ({ id, archived }))).toEqual([
      { id: threadId, archived: true },
    ]);
    const reopened = await restore();
    expect(reopened).toEqual({
      ok: true,
      agentId: imported.agentId,
      workspaceId: fixture.workspaceId,
    });
  } finally {
    await fixture.cleanup();
  }
}, 120_000);
