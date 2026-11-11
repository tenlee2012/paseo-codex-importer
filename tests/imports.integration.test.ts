import { expect, test } from "vitest";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { CodexConnection, threadPageSchema } from "../server/codex.js";
import { importSession, listSessions } from "../shared/contracts.js";
import { createDaemonFixture } from "./daemon-fixture.js";

test("real Paseo restores same-directory sessions and copies other directories into the current workspace", async () => {
  const threadId = "33333333-3333-4333-8333-333333333333";
  const aliasId = "33333333-3333-4333-8333-333333333334";
  const otherId = "33333333-3333-4333-8333-333333333335";
  const fixture = await createDaemonFixture([
    { id: threadId, title: "Sample archived work", archived: true, updatedAt: 1767268800 },
    { id: aliasId, title: "Sample custom provider history", updatedAt: 1767268700 },
    {
      id: otherId,
      title: "Sample other directory history",
      updatedAt: 1767268600,
      directory: "previous-project",
    },
  ]);
  const input = { workspaceId: fixture.workspaceId, query: "", status: "all", cursor: null };
  try {
    const previousDirectory = join(fixture.root, "previous-project");
    const previousWorkspace = await fixture.paseo.workspaces.open(previousDirectory);
    const previousAgent = await fixture.client.importAgent({
      providerId: "codex",
      providerHandleId: otherId,
      cwd: previousDirectory,
      workspaceId: previousWorkspace.id,
    });
    await fixture.paseo.agents.ref(previousAgent.id).archive();
    await fixture.client.importAgent({
      providerId: "sample-codex",
      providerHandleId: aliasId,
      cwd: fixture.workspace,
      workspaceId: fixture.workspaceId,
    });
    const list = async (scope = "workspace") =>
      listSessions.output.parse(
        await fixture.client.invokePluginRpc("codex-importer", listSessions.name, {
          ...input,
          scope,
        }),
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
    const all = await list("all");
    if (!all.ok) throw new Error(all.error);
    expect(all.entries.map(({ id }) => id).sort()).toEqual([threadId, otherId].sort());
    const omittedScope = await fixture.client.invokePluginRpc(
      "codex-importer",
      listSessions.name,
      input,
    );
    expect(omittedScope).toEqual(before);
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
    expect(imported.copied).toBe(false);
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
      copied: false,
    });

    const crossInput = { workspaceId: fixture.workspaceId, threadId: otherId, archived: true };
    const copied = importSession.output.parse(
      await fixture.client.invokePluginRpc("codex-importer", importSession.name, crossInput),
    );
    if (!copied.ok) throw new Error(copied.error);
    expect(copied.copied).toBe(true);
    expect(copied.workspaceId).toBe(fixture.workspaceId);
    expect(copied.agentId).not.toBe(previousAgent.id);
    const copy = fixture.paseo.agents.ref(copied.agentId);
    await copy.refresh();
    const nativeCopy = copy.current()?.persistence?.sessionId;
    expect(nativeCopy).toBeTruthy();
    expect(nativeCopy).not.toBe(otherId);
    expect(copy.cwd).toBe(fixture.workspace);
    expect(copy.workspaceId).toBe(fixture.workspaceId);
    const history = await copy.timeline.refetch({ limit: 100 });
    expect(JSON.stringify(history)).toContain("Sample other directory history");
    expect(JSON.stringify(history)).toContain("This is synthetic test history.");

    const source = fixture.paseo.agents.ref(previousAgent.id);
    await source.refresh();
    expect(source.workspaceId).toBe(previousWorkspace.id);
    expect(source.cwd).toBe(previousDirectory);
    expect(source.archivedAt).toBeTruthy();
    expect(
      await fixture.client.invokePluginRpc("codex-importer", importSession.name, crossInput),
    ).toEqual({ ok: false, error: "already_imported" });
    const afterCopy = await list("all");
    if (!afterCopy.ok) throw new Error(afterCopy.error);
    expect(afterCopy.entries).toEqual([]);

    const native = await CodexConnection.open(fixture.launch);
    try {
      const archived = threadPageSchema.parse(
        await native.request("thread/list", { archived: true, modelProviders: [] }),
      );
      expect(archived.data.some(({ id, cwd }) => id === otherId && cwd === previousDirectory)).toBe(
        true,
      );
      // A source may still be imported into a different destination workspace.
      const sourceList = listSessions.output.parse(
        await fixture.client.invokePluginRpc("codex-importer", listSessions.name, {
          ...input,
          workspaceId: previousWorkspace.id,
        }),
      );
      if (!sourceList.ok) throw new Error(sourceList.error);
      expect(sourceList.entries.map(({ id }) => id)).toEqual([otherId]);
    } finally {
      await native.close();
    }

    // The copied thread now belongs to this directory and must be restored, never copied again.
    await copy.archive();
    const restoreCopy = await fixture.client.invokePluginRpc("codex-importer", importSession.name, {
      ...crossInput,
      threadId: nativeCopy,
    });
    expect(restoreCopy).toEqual({
      ok: true,
      copied: false,
      agentId: copy.id,
      workspaceId: fixture.workspaceId,
    });

    // Path aliases count as the same directory.
    const aliasDirectory = join(fixture.root, "sample-alias");
    await symlink(fixture.workspace, aliasDirectory, "dir");
    const aliasWorkspace = await fixture.paseo.workspaces.open(aliasDirectory);
    await agent.archive();
    const aliasRestore = await fixture.client.invokePluginRpc(
      "codex-importer",
      importSession.name,
      { workspaceId: aliasWorkspace.id, threadId, archived: true },
    );
    expect(aliasRestore).toEqual({
      ok: true,
      copied: false,
      agentId: agent.id,
      workspaceId: aliasWorkspace.id,
    });
  } finally {
    await fixture.cleanup();
  }
}, 120_000);
