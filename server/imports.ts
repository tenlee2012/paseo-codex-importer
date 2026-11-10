import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { RpcInput } from "@getpaseo/plugin";
import { ProviderOverridesSchema } from "@getpaseo/protocol/provider-config";
import { z } from "zod";
import type { importSession, listSessions } from "../shared/contracts.js";
import { ImporterError } from "../shared/errors.js";
import { readCatalog } from "./catalog.js";
import { CodexConnection, type CodexLaunch, threadSchema } from "./codex.js";
import { connectImportClient, type ImportClient } from "./daemon.js";

interface Destination {
  workspaceId: string;
  cwd: string;
  canonicalCwd: string;
}

interface CodexConfiguration {
  launch: CodexLaunch;
  providers: ReadonlySet<string>;
}

export async function canonicalDirectory(directory: string) {
  try {
    return await realpath(directory);
  } catch {
    return resolve(directory);
  }
}

export class SessionImports {
  private readonly connections = new Set<CodexConnection>();
  private readonly clients = new Set<ImportClient>();
  private readonly importing = new Set<string>();
  private stopped = false;

  private async destination(paseo: PaseoApi, workspaceId: string): Promise<Destination> {
    if (this.stopped) throw new ImporterError("plugin_stopped");
    const workspace = paseo.workspaces.ref(workspaceId);
    const snapshot = await workspace.refresh();
    if (!snapshot || !workspace.directory) throw new ImporterError("workspace_unavailable");
    return {
      workspaceId,
      cwd: workspace.directory,
      canonicalCwd: await canonicalDirectory(workspace.directory),
    };
  }

  private async configuration(
    paseo: PaseoApi,
    destination: Destination,
  ): Promise<CodexConfiguration> {
    const { config } = await paseo.config.get();
    const overrides = ProviderOverridesSchema.safeParse(config.providers);
    if (!overrides.success) throw new ImporterError("configuration_invalid");
    const provider = overrides.data.codex;
    if (provider?.enabled === false || (provider?.extends && provider.extends !== "codex")) {
      throw new ImporterError("configuration_invalid");
    }
    const providers = new Set(["codex"]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, definition] of Object.entries(overrides.data)) {
        if (definition.extends && providers.has(definition.extends) && !providers.has(id)) {
          providers.add(id);
          changed = true;
        }
      }
    }
    return {
      launch: {
        command: provider?.command ?? ["codex"],
        env: { ...process.env, ...config.envOverrides, ...provider?.env },
        cwd: destination.cwd,
      },
      providers,
    };
  }

  private async activeSessions(paseo: PaseoApi, providers: ReadonlySet<string>) {
    const ids = new Set<string>();
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await paseo.agents.list({
        includeBackground: true,
        filter: { includeArchived: false, includeBackground: true },
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
      });
      for (const { agent } of page.entries) {
        if (agent.archivedAt || !providers.has(agent.provider)) continue;
        const id =
          agent.persistence?.nativeHandle ??
          agent.persistence?.sessionId ??
          agent.runtimeInfo?.sessionId;
        if (id) ids.add(id);
      }
      if (!page.pageInfo.hasMore) break;
      const next = page.pageInfo.nextCursor;
      if (!next || seen.has(next)) throw new ImporterError("daemon_unavailable");
      seen.add(next);
      cursor = next;
    } while (cursor);
    for (const id of this.importing) ids.add(id);
    return ids;
  }

  private async withCodex<T>(
    launch: CodexLaunch,
    action: (connection: CodexConnection) => Promise<T>,
  ) {
    if (this.stopped) throw new ImporterError("plugin_stopped");
    const connection = new CodexConnection(launch);
    this.connections.add(connection);
    try {
      await connection.initialize();
      if (this.stopped) throw new ImporterError("plugin_stopped");
      return await action(connection);
    } finally {
      this.connections.delete(connection);
      await connection.close();
    }
  }

  async list(paseo: PaseoApi, input: RpcInput<typeof listSessions>) {
    const destination = await this.destination(paseo, input.workspaceId);
    const configuration = await this.configuration(paseo, destination);
    const excluded = await this.activeSessions(paseo, configuration.providers);
    const directories = [...new Set([destination.cwd, destination.canonicalCwd])];
    return this.withCodex(configuration.launch, (connection) =>
      readCatalog(connection, { ...input, directories, excluded, query: input.query.trim() }),
    );
  }

  async import(paseo: PaseoApi, input: RpcInput<typeof importSession>) {
    if (this.importing.has(input.threadId)) throw new ImporterError("import_in_progress");
    const destination = await this.destination(paseo, input.workspaceId);
    const configuration = await this.configuration(paseo, destination);
    if ((await this.activeSessions(paseo, configuration.providers)).has(input.threadId))
      throw new ImporterError("already_imported");
    // Recheck after the awaits; separate clients can click the same native thread concurrently.
    if (this.importing.has(input.threadId)) throw new ImporterError("import_in_progress");
    this.importing.add(input.threadId);
    let client: ImportClient | undefined;
    try {
      const { self } = await paseo.hosts.list();
      client = await connectImportClient(self.serverId);
      if (this.stopped) throw new ImporterError("plugin_stopped");
      this.clients.add(client);
      const importer = client;
      return await this.withCodex(configuration.launch, async (connection) => {
        const raw = await connection.request("thread/read", { threadId: input.threadId });
        const parsed = z.object({ thread: threadSchema }).safeParse(raw);
        if (!parsed.success) throw new ImporterError("codex_failed");
        const { thread } = parsed.data;
        if (!thread.cwd || (await canonicalDirectory(thread.cwd)) !== destination.canonicalCwd) {
          throw new ImporterError("wrong_directory");
        }
        if (input.archived)
          await connection.request("thread/unarchive", { threadId: input.threadId });
        const agent = await importer
          .importAgent({
            providerId: "codex",
            providerHandleId: input.threadId,
            cwd: destination.cwd,
            workspaceId: destination.workspaceId,
          })
          .catch(() => {
            throw new ImporterError("import_failed");
          });
        if (agent.workspaceId !== destination.workspaceId) throw new ImporterError("import_failed");
        return { ok: true as const, agentId: agent.id, workspaceId: destination.workspaceId };
      });
    } finally {
      this.importing.delete(input.threadId);
      if (client) {
        this.clients.delete(client);
        await client.close();
      }
    }
  }

  async dispose() {
    this.stopped = true;
    await Promise.allSettled([
      ...[...this.connections].map((connection) => connection.close()),
      ...[...this.clients].map((client) => client.close()),
    ]);
  }
}
