import { z } from "zod";

export const errorCodeSchema = z.enum([
  "codex_unavailable",
  "codex_failed",
  "timeout",
  "invalid_cursor",
  "workspace_unavailable",
  "wrong_directory",
  "already_imported",
  "import_in_progress",
  "import_failed",
  "daemon_unavailable",
  "host_mismatch",
  "configuration_invalid",
  "plugin_stopped",
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export class ImporterError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "ImporterError";
  }
}

export function errorResult(error: unknown) {
  const code = error instanceof ImporterError ? error.code : "import_failed";
  return { ok: false as const, error: code };
}
