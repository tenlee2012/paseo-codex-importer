import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHostClient, parseHostTarget } from "@getpaseo/client/node";
import { z } from "zod";
import { ImporterError } from "../shared/errors.js";

const identitySchema = z.object({ serverId: z.string(), listen: z.string() });

export function loopbackEndpoint(listen: string) {
  const target = parseHostTarget(listen);
  if (target.kind !== "socket" || target.offer || target.password) {
    throw new ImporterError("daemon_unavailable");
  }
  if (target.socketPath) return listen;
  const url = new URL(target.url);
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  if (url.hostname === "[::]") url.hostname = "[::1]";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new ImporterError("daemon_unavailable");
  }
  return url.toString();
}

export type ImportClient = ReturnType<typeof createHostClient>;

// PaseoApi does not expose native-session import. Keep its official Node client on the owning host.
export async function connectImportClient(serverId: string) {
  const home = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
  let identity: z.infer<typeof identitySchema>;
  let credential: string;
  try {
    identity = identitySchema.parse(JSON.parse(await readFile(join(home, "paseo.pid"), "utf8")));
    credential = (await readFile(join(home, "local-credential"), "utf8")).trim();
  } catch {
    throw new ImporterError("daemon_unavailable");
  }
  if (identity.serverId !== serverId) throw new ImporterError("host_mismatch");
  const client = createHostClient(loopbackEndpoint(identity.listen), {
    clientId: `codex-importer-${randomUUID()}`,
    clientType: "cli",
    localCredential: () => credential,
    reconnect: { enabled: false },
    connectTimeoutMs: 10_000,
  });
  try {
    await client.connect();
    const hosts = await client.listHosts();
    if (hosts.self.serverId !== serverId) throw new ImporterError("host_mismatch");
    return client;
  } catch {
    await client.close();
    throw new ImporterError("daemon_unavailable");
  }
}
