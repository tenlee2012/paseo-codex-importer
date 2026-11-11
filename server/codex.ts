import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import { ImporterError } from "../shared/errors.js";

export interface CodexLaunch {
  command: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs?: number;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: ImporterError): void;
  timer: ReturnType<typeof setTimeout>;
}

export const threadSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable().optional(),
  preview: z.string().default(""),
  cwd: z.string().nullable().default(null),
  updatedAt: z.number(),
});
export type CodexThread = z.infer<typeof threadSchema>;

export const threadPageSchema = z.object({
  data: z.array(threadSchema),
  nextCursor: z.string().nullable().default(null),
});
export type CodexThreadPage = z.infer<typeof threadPageSchema>;

const envelopeSchema = z.object({
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  method: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number() }).passthrough().optional(),
});

export class CodexConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private sequence = 0;
  private stopped = false;
  private readonly timeoutMs: number;
  private readonly exited: Promise<void>;

  constructor(launch: CodexLaunch) {
    const [command, ...args] = launch.command;
    if (!command) throw new ImporterError("configuration_invalid");
    this.timeoutMs = launch.timeoutMs ?? 30_000;
    this.child = spawn(command, [...args, "app-server"], {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    // Codex stderr may contain paths and provider configuration. Never forward it to plugin logs.
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.fail("codex_failed"));
    this.exited = new Promise((resolve) => {
      this.child.once("error", () => {
        this.fail("codex_unavailable");
        resolve();
      });
      this.child.once("exit", () => {
        this.fail("codex_failed");
        resolve();
      });
    });
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.receive(line));
    this.child.once("close", () => lines.close());
  }

  static async open(launch: CodexLaunch): Promise<CodexConnection> {
    const connection = new CodexConnection(launch);
    try {
      await connection.initialize();
      return connection;
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  async initialize() {
    await this.request("initialize", {
      clientInfo: {
        name: "paseo_codex_importer",
        title: "Codex session importer",
        version: "0.2.2",
      },
    });
    this.write({ method: "initialized", params: {} });
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.stopped) return Promise.reject(new ImporterError("codex_failed"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ImporterError("timeout"));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  private write(value: unknown) {
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private receive(line: string) {
    if (Buffer.byteLength(line) > 8 * 1024 * 1024) return this.fail("codex_failed");
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return this.fail("codex_failed");
    }
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) return this.fail("codex_failed");
    const message = parsed.data;
    if (message.method) {
      if (message.id !== undefined && message.id !== null) {
        this.write({ id: message.id, error: { code: -32601, message: "Unsupported request" } });
      }
      return;
    }
    if (typeof message.id !== "number") return;
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error || !("result" in message)) request.reject(new ImporterError("codex_failed"));
    else request.resolve(message.result);
  }

  private fail(code: "codex_unavailable" | "codex_failed" | "plugin_stopped") {
    this.stopped = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ImporterError(code));
    }
    this.pending.clear();
  }

  async close() {
    this.fail("plugin_stopped");
    this.child.stdin.destroy();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill("SIGTERM");
    const force = setTimeout(() => this.child.kill("SIGKILL"), 1_000);
    force.unref();
    await this.exited;
    clearTimeout(force);
  }
}
