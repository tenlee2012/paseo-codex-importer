import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPaseoApi } from "@getpaseo/client";
import { createHostClient } from "@getpaseo/client/node";
import { z } from "zod";
import { loopbackEndpoint } from "../server/daemon.js";
import { createCodexFixture, type FixtureSession } from "./fixtures.js";

const execute = promisify(execFile);

export async function createDaemonFixture(sessions: FixtureSession[]) {
  const fixture = await createCodexFixture(sessions);
  const home = join(fixture.root, "paseo");
  const project = fileURLToPath(new URL("../", import.meta.url));
  await mkdir(home);
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: fixture.home };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PASEO_")) delete env[key];
  }
  env.PASEO_HOME = home;
  env.PASEO_LISTEN = "127.0.0.1:0";
  env.PASEO_RELAY_ENABLED = "false";
  const providers = {
    codex: { command: ["codex"], env: { CODEX_HOME: fixture.home } },
    "sample-codex": { extends: "codex", label: "Sample Codex" },
    claude: { enabled: false },
    copilot: { enabled: false },
    opencode: { enabled: false },
    pi: { enabled: false },
    antigravity: { enabled: false },
    muse: { enabled: false },
  };
  await writeFile(
    join(home, "config.json"),
    JSON.stringify({
      daemon: { listen: "127.0.0.1:0", relay: { enabled: false }, mcp: { enabled: false } },
      pluginsEnabled: true,
      plugins: { "codex-importer": { source: "directory", path: project, enabled: true } },
      agents: { providers },
    }),
  );
  const stop = () =>
    execute("paseo", ["daemon", "stop", "--home", home, "--timeout", "5", "--force"], {
      env,
      timeout: 20_000,
    });
  try {
    await execute("paseo", ["daemon", "start", "--home", home, "--timeout", "45"], {
      env,
      timeout: 60_000,
    });
    const identity = z
      .object({ serverId: z.string(), listen: z.string() })
      .parse(JSON.parse(await readFile(join(home, "paseo.pid"), "utf8")));
    const credential = (await readFile(join(home, "local-credential"), "utf8")).trim();
    const endpoint = loopbackEndpoint(identity.listen);
    const client = createHostClient(endpoint, {
      clientId: "codex-importer-integration",
      localCredential: () => credential,
      reconnect: { enabled: false },
    });
    await client.connect();
    const paseo = createPaseoApi(client);
    const workspace = await paseo.workspaces.open(fixture.workspace);
    return {
      ...fixture,
      paseoHome: home,
      endpoint,
      client,
      paseo,
      workspaceId: workspace.id,
      cleanup: async () => {
        await Promise.allSettled([paseo.dispose(), client.close()]);
        try {
          await stop();
        } finally {
          await fixture.cleanup();
        }
      },
    };
  } catch (error) {
    await stop().catch(() => undefined);
    await fixture.cleanup();
    throw error;
  }
}
