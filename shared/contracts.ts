import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { errorCodeSchema } from "./errors.js";

export const statusSchema = z.enum(["all", "archived", "active"]);
export type SessionStatus = z.infer<typeof statusSchema>;
export const scopeSchema = z.enum(["workspace", "all"]);
export type SessionScope = z.infer<typeof scopeSchema>;

export const sessionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  cwd: z.string(),
  updatedAt: z.number(),
  archived: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSchema>;

const failureSchema = z.object({ ok: z.literal(false), error: errorCodeSchema });

export const listSessions = defineRpc({
  name: "codex.sessions.list",
  input: z.object({
    workspaceId: z.string().min(1),
    scope: scopeSchema.default("workspace"),
    query: z.string().max(200).default(""),
    status: statusSchema.default("all"),
    cursor: z.string().max(16384).nullable().default(null),
  }),
  output: z.discriminatedUnion("ok", [
    failureSchema,
    z.object({
      ok: z.literal(true),
      entries: z.array(sessionSchema),
      nextCursor: z.string().nullable(),
      filteredCount: z.number().int().nonnegative(),
    }),
  ]),
});

export const importSession = defineRpc({
  name: "codex.sessions.import",
  input: z.object({
    workspaceId: z.string().min(1),
    threadId: z.string().min(1).max(200),
    archived: z.boolean(),
  }),
  output: z.discriminatedUnion("ok", [
    failureSchema,
    z.object({
      ok: z.literal(true),
      agentId: z.string(),
      workspaceId: z.string(),
      copied: z.boolean(),
    }),
  ]),
});
