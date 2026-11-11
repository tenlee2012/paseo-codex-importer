import { expect, test } from "vitest";
import { readCatalog } from "../server/catalog.js";
import { CodexConnection } from "../server/codex.js";
import { ImporterError } from "../shared/errors.js";
import { createCodexFixture } from "./fixtures.js";

test("real Codex pagination merges both archive states without omissions and scopes search cursors", async () => {
  const samples = Array.from({ length: 80 }, (_, index) => ({
    id: `55555555-5555-4555-8555-${index.toString(16).padStart(12, "0")}`,
    title: `Sample item ${index}`,
    updatedAt: 1767268800 - index * 60,
    archived: index % 2 === 0,
  }));
  const foreign = [
    {
      id: "55555555-5555-4555-8555-fffffffffff1",
      title: "Sample other project newest",
      updatedAt: 1767268860,
      archived: true,
      directory: "/example/other-project",
    },
    {
      id: "55555555-5555-4555-8555-fffffffffff2",
      title: "Sample other project oldest",
      updatedAt: 1767200000,
      directory: "/example/other-project",
    },
  ];
  const fixture = await createCodexFixture([...samples, ...foreign]);
  const codex = await CodexConnection.open(fixture.launch);
  const input = {
    workspaceId: "sample-workspace",
    directories: [fixture.workspace],
    query: "",
    status: "all" as const,
    cursor: null,
    excluded: new Set<string>(),
  };
  try {
    const first = await readCatalog(codex, input);
    expect(first.entries.map(({ id }) => id)).toEqual(samples.slice(0, 50).map(({ id }) => id));
    expect(typeof first.nextCursor).toBe("string");
    const second = await readCatalog(codex, { ...input, cursor: first.nextCursor });
    expect(second.entries.map(({ id }) => id)).toEqual(samples.slice(50).map(({ id }) => id));
    expect(second.nextCursor).toBeNull();
    await expect(
      readCatalog(codex, { ...input, query: "different", cursor: first.nextCursor }),
    ).rejects.toEqual(new ImporterError("invalid_cursor"));

    const searched = await readCatalog(codex, { ...input, query: "item 42", status: "archived" });
    expect(searched.entries.map(({ id, archived }) => ({ id, archived }))).toEqual([
      { id: samples[42].id, archived: true },
    ]);
    const excluded = new Set(samples.slice(0, 4).map(({ id }) => id));
    const filtered = await readCatalog(codex, { ...input, excluded });
    expect(filtered.filteredCount).toBe(4);
    expect(filtered.entries.map(({ id }) => id)).toEqual(samples.slice(4, 54).map(({ id }) => id));

    const all = await readCatalog(codex, { ...input, directories: null });
    const allNext = await readCatalog(codex, {
      ...input,
      directories: null,
      cursor: all.nextCursor,
    });
    expect([...all.entries, ...allNext.entries].map(({ id }) => id)).toEqual(
      [foreign[0], ...samples, foreign[1]].map(({ id }) => id),
    );
    expect(allNext.nextCursor).toBeNull();
    await expect(readCatalog(codex, { ...input, cursor: all.nextCursor })).rejects.toEqual(
      new ImporterError("invalid_cursor"),
    );
    const foreignSearch = await readCatalog(codex, {
      ...input,
      directories: null,
      query: "other project",
      status: "archived",
    });
    expect(foreignSearch.entries.map(({ id }) => id)).toEqual([foreign[0].id]);
  } finally {
    await codex.close();
    await fixture.cleanup();
  }
}, 30_000);
