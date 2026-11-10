import { createHash } from "node:crypto";
import { z } from "zod";
import type { SessionStatus, SessionSummary } from "../shared/contracts.js";
import { ImporterError } from "../shared/errors.js";
import {
  type CodexConnection,
  type CodexThread,
  type CodexThreadPage,
  threadPageSchema,
} from "./codex.js";

const PAGE_SIZE = 50;
const positionSchema = z.object({
  cursor: z.string().nullable(),
  offset: z.number().int().min(0).max(PAGE_SIZE),
  done: z.boolean(),
});
type Position = z.infer<typeof positionSchema>;

const cursorSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  active: positionSchema,
  archived: positionSchema,
});

export interface CatalogInput {
  workspaceId: string;
  directories: string[];
  query: string;
  status: SessionStatus;
  cursor: string | null;
  excluded: ReadonlySet<string>;
}

class ThreadStream {
  private page: CodexThreadPage | null = null;

  constructor(
    private readonly connection: Pick<CodexConnection, "request">,
    private readonly input: CatalogInput,
    readonly archived: boolean,
    private readonly position: Position,
  ) {}

  async peek(): Promise<CodexThread | null> {
    for (let emptyPages = 0; emptyPages < 10; emptyPages++) {
      if (this.position.done) return null;
      if (!this.page) {
        const raw = await this.connection.request("thread/list", {
          limit: PAGE_SIZE,
          cursor: this.position.cursor,
          archived: this.archived,
          sortKey: "updated_at",
          modelProviders: [],
          sourceKinds: ["cli", "vscode", "appServer", "exec", "unknown"],
          cwd: this.input.directories,
          ...(this.input.query ? { searchTerm: this.input.query } : {}),
        });
        const parsed = threadPageSchema.safeParse(raw);
        if (!parsed.success) throw new ImporterError("codex_failed");
        this.page = parsed.data;
        if (this.position.offset > this.page.data.length) throw new ImporterError("invalid_cursor");
      }
      const item = this.page.data[this.position.offset];
      if (item) return item;
      this.advancePage();
    }
    throw new ImporterError("codex_failed");
  }

  consume() {
    this.position.offset++;
  }

  checkpoint(): Position {
    if (this.page && this.position.offset >= this.page.data.length) this.advancePage();
    return { ...this.position };
  }

  private advancePage() {
    if (!this.page) return;
    if (!this.page.nextCursor) this.position.done = true;
    else {
      if (this.page.nextCursor === this.position.cursor) throw new ImporterError("codex_failed");
      this.position.cursor = this.page.nextCursor;
      this.position.offset = 0;
    }
    this.page = null;
  }
}

export async function readCatalog(
  connection: Pick<CodexConnection, "request">,
  input: CatalogInput,
) {
  const scope = createHash("sha256")
    .update(JSON.stringify([input.workspaceId, input.directories, input.query, input.status]))
    .digest("hex");
  const initial = {
    version: 1 as const,
    scope,
    active: { cursor: null, offset: 0, done: input.status === "archived" },
    archived: { cursor: null, offset: 0, done: input.status === "active" },
  };
  const state = input.cursor ? decodeCursor(input.cursor, scope) : initial;
  const active = new ThreadStream(connection, input, false, state.active);
  const archived = new ThreadStream(connection, input, true, state.archived);
  const entries: SessionSummary[] = [];
  const seen = new Set<string>();
  let filteredCount = 0;

  // Bound work even when a host has hundreds of sessions already owned by Paseo.
  for (let scanned = 0; entries.length < PAGE_SIZE && scanned < 500; scanned++) {
    const [left, right] = await Promise.all([active.peek(), archived.peek()]);
    if (!left && !right) break;
    let item: CodexThread;
    let stream: ThreadStream;
    if (left && (!right || left.updatedAt >= right.updatedAt)) {
      item = left;
      stream = active;
    } else if (right) {
      item = right;
      stream = archived;
    } else break;
    stream.consume();
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (input.excluded.has(item.id)) {
      filteredCount++;
      continue;
    }
    const title = item.name?.trim() || item.preview.split("\n")[0].trim();
    entries.push({
      id: item.id,
      title: title.slice(0, 200),
      cwd: item.cwd ?? input.directories[0],
      updatedAt: item.updatedAt,
      archived: stream.archived,
    });
  }
  const checkpoint = {
    version: 1,
    scope,
    active: active.checkpoint(),
    archived: archived.checkpoint(),
  };
  const finished = checkpoint.active.done && checkpoint.archived.done;
  const nextCursor = finished
    ? null
    : Buffer.from(JSON.stringify(checkpoint)).toString("base64url");
  return { ok: true as const, entries, nextCursor, filteredCount };
}

function decodeCursor(cursor: string, scope: string) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new ImporterError("invalid_cursor");
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const state = cursorSchema.parse(decoded);
    if (state.scope !== scope) throw new ImporterError("invalid_cursor");
    return state;
  } catch {
    throw new ImporterError("invalid_cursor");
  }
}
