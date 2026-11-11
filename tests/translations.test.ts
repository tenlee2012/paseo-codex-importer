import { PluginTranslationRuntime } from "@getpaseo/plugin/client/host";
import { expect, test } from "vitest";
import { messages } from "../client/messages.js";
import { errorCodeSchema } from "../shared/errors.js";

const locales = ["en", "ar", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN"];

function flatten(resource: unknown, prefix = ""): Map<string, string> {
  if (!resource || typeof resource !== "object" || Array.isArray(resource))
    throw new Error("Invalid resource");
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(resource)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result.set(path, value);
    else for (const [nested, text] of flatten(value, path)) result.set(nested, text);
  }
  return result;
}

function logicalKeys(resource: unknown) {
  const keys = [...flatten(resource).keys()];
  return [...new Set(keys.map((key) => key.replace(/_(zero|one|two|few|many|other)$/, "")))].sort();
}

test.each(
  locales,
)("%s provides every UI message, error, placeholder, and plural form", (locale) => {
  const resource = messages.resources[locale];
  const translated = flatten(resource);
  expect(logicalKeys(resource)).toEqual(logicalKeys(messages.resources.en));
  const runtime = new PluginTranslationRuntime({
    getLocale: () => locale,
    subscribe: () => () => {},
  });
  try {
    expect(runtime.resolve(messages.message("title"))).toBe(translated.get("title"));
    expect(runtime.resolve(messages.message("commandTitle"))).toBe(translated.get("commandTitle"));
    for (const code of errorCodeSchema.options) {
      expect(runtime.t(messages, `errors.${code}`)).toBe(translated.get(`errors.${code}`));
    }
    expect(runtime.t(messages, "importLabel", { title: "原始标题 / Sample title" })).toContain(
      "原始标题 / Sample title",
    );
    for (const count of [0, 1, 2, 3, 11, 100, 1234, 1000000]) {
      const category = new Intl.PluralRules(locale).select(count);
      const template = translated.get(`filtered_${category}`);
      expect(typeof template).toBe("string");
      const number = new Intl.NumberFormat(locale).format(count);
      expect(runtime.t(messages, "filtered", { count })).toBe(
        template?.replace("{{count, number}}", number),
      );
    }
  } finally {
    runtime.dispose();
  }
});

test("persistent labels follow each client's locale independently and fall back to English", () => {
  let locale = "en";
  const listeners = new Set<() => void>();
  const first = new PluginTranslationRuntime({
    getLocale: () => locale,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  const second = new PluginTranslationRuntime({ getLocale: () => "ja", subscribe: () => () => {} });
  const title = messages.message("title");
  const command = messages.message("commandTitle");
  try {
    expect(first.resolve(title)).toBe("Import Codex sessions");
    locale = "zh-CN";
    for (const listener of listeners) listener();
    expect(first.resolve(title)).toBe("导入 Codex 会话");
    expect(first.resolve(command)).toBe("导入 Codex 会话到当前工作区");
    expect(second.resolve(title)).toBe("Codex セッションをインポート");
    locale = "de";
    for (const listener of listeners) listener();
    expect(first.resolve(title)).toBe("Import Codex sessions");
  } finally {
    first.dispose();
    second.dispose();
  }
});
