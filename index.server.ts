import type { PluginServerContext } from "@getpaseo/plugin/server";
import { SessionImports } from "./server/imports.js";
import { importSession, listSessions } from "./shared/contracts.js";
import { errorResult } from "./shared/errors.js";

export default function contribute(server: PluginServerContext) {
  const sessions = new SessionImports();
  server.handle(listSessions, async (input, { paseo }) => {
    try {
      return await sessions.list(paseo, input);
    } catch (error) {
      return errorResult(error);
    }
  });
  server.handle(importSession, async (input, { paseo }) => {
    try {
      return await sessions.import(paseo, input);
    } catch (error) {
      return errorResult(error);
    }
  });
  return () => sessions.dispose();
}
