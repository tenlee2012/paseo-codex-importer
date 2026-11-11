import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface FixtureSession {
  id: string;
  title: string;
  updatedAt: number;
  archived?: boolean;
  directory?: string;
}

export async function createCodexFixture(sessions: FixtureSession[]) {
  const root = await mkdtemp(join(tmpdir(), "codex-importer-test-"));
  const home = join(root, "codex");
  const workspace = join(root, "sample-project");
  await mkdir(workspace, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "config.toml"), 'model = "gpt-6.1-sol"\n');
  for (const session of sessions) {
    const directory = session.directory ? resolve(root, session.directory) : workspace;
    if (session.directory && !isAbsolute(session.directory))
      await mkdir(directory, { recursive: true });
    const folder = session.archived
      ? join(home, "archived_sessions")
      : join(home, "sessions", "2026", "01", "01");
    await mkdir(folder, { recursive: true });
    const timestamp = new Date(session.updatedAt * 1000).toISOString();
    const records = [
      {
        timestamp,
        type: "session_meta",
        payload: {
          id: session.id,
          timestamp,
          cwd: directory,
          originator: "codex_cli_rs",
          cli_version: "0.167.0",
          source: "cli",
          model_provider: "openai",
        },
      },
      {
        timestamp,
        type: "event_msg",
        payload: { type: "user_message", message: session.title, images: [], local_images: [] },
      },
      {
        timestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: session.title }],
        },
      },
      {
        timestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "This is synthetic test history." }],
        },
      },
      {
        timestamp,
        type: "event_msg",
        payload: { type: "agent_message", message: "This is synthetic test history." },
      },
    ];
    const file = join(folder, `rollout-2026-01-01T00-00-00-${session.id}.jsonl`);
    await writeFile(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    await utimes(file, session.updatedAt, session.updatedAt);
  }
  return {
    root,
    home,
    workspace,
    launch: { command: ["codex"], cwd: workspace, env: { ...process.env, CODEX_HOME: home } },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
