import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { errorResult, ImporterError } from "../shared/errors.js";
import { importSession, listSessions } from "../shared/contracts.js";
import { createDaemonFixture } from "./daemon-fixture.js";

export async function startBrowserServer() {
  const sessions = Array.from({ length: 53 }, (_, index) => ({
    id: `44444444-4444-4444-8444-${index.toString(16).padStart(12, "0")}`,
    title: `Sample conversation ${String(index + 1).padStart(2, "0")}`,
    updatedAt: 1767268800 - index * 3600,
    archived: index % 2 === 0,
  }));
  sessions[0].title = "Review sample pull request";
  sessions[1].title = "Plan sample documentation update";
  sessions[2].title = "Investigate sample test failure";
  const fixture = await createDaemonFixture([
    ...sessions,
    {
      id: "44444444-4444-4444-8444-fffffffffff1",
      title: "Archived history from another project",
      archived: true,
      updatedAt: 1767268860,
      directory: "/example/other-project",
    },
    {
      id: "44444444-4444-4444-8444-fffffffffff2",
      title: "Unarchived history from another project",
      updatedAt: 1767268830,
      directory: "/example/other-project",
    },
  ]);
  let importRequests = 0;
  let listRequests = 0;
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/bundle.js") {
        response.setHeader("content-type", "application/javascript; charset=utf-8");
        response.end(await readFile(fileURLToPath(new URL("./browser-ui.js", import.meta.url))));
        return;
      }
      if (request.url?.startsWith("/api/")) {
        response.setHeader("content-type", "application/json; charset=utf-8");
        let body = "";
        for await (const chunk of request) body += chunk;
        let result: unknown;
        if (request.url === "/api/list") {
          listRequests++;
          const input = listSessions.input.parse(JSON.parse(body));
          result = await fixture.client.invokePluginRpc("codex-importer", listSessions.name, input);
        } else if (request.url === "/api/import") {
          importRequests++;
          const input = importSession.input.parse(JSON.parse(body));
          result = await fixture.client.invokePluginRpc(
            "codex-importer",
            importSession.name,
            input,
          );
        } else if (request.url === "/api/test/stats") result = { importRequests, listRequests };
        else if (request.url === "/api/test/disconnect") {
          await fixture.client.close();
          result = { ok: true };
        } else throw new Error("Unknown test endpoint");
        response.end(JSON.stringify(result));
        return;
      }
      const bootstrap = JSON.stringify({
        workspaceId: fixture.workspaceId,
        directory: fixture.workspace,
      });
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Codex session importer · synthetic preview</title><style>html,body,#root{margin:0;width:100%;height:100%;font-family:system-ui,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script>window.importerFixture=${bootstrap}</script><script src="/bundle.js"></script></body></html>`,
      );
    } catch {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(errorResult(new ImporterError("daemon_unavailable"))));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fixture.cleanup();
    },
  };
}
