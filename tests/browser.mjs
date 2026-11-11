import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

await mkdir(".artifacts", { recursive: true });
await build({
  entryPoints: ["tests/browser-server.ts"],
  outfile: ".artifacts/browser-server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
await build({
  entryPoints: ["tests/browser-entry.jsx"],
  outfile: ".artifacts/browser-ui.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: { "react-native": "react-native-web" },
  define: { "process.env.NODE_ENV": '"production"' },
});
const { startBrowserServer } = await import("../.artifacts/browser-server.mjs");
const server = await startBrowserServer();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: "UTC" });
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));
try {
  await page.goto(server.url);
  await page.getByText("Review sample pull request", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^导入 / }).count(), 50);
  await page.getByRole("button", { name: "加载更多会话", exact: true }).click();
  await page.getByRole("button", { name: "导入 Sample conversation 53", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^导入 / }).count(), 53);
  assert.equal(
    await page.getByText("Archived history from another project", { exact: true }).count(),
    0,
  );

  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await page.getByText("Review sample pull request", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "搜索 Codex 会话标题" }).fill("pull request");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="button"][aria-label^="导入 "]').length === 1,
  );

  await page.getByRole("textbox", { name: "搜索 Codex 会话标题" }).fill("pending draft");
  const beforeSwitch = await (await page.request.get(`${server.url}/api/test/stats`)).json();
  const selectedFilterColor = await page
    .getByRole("button", { name: "已归档", exact: true })
    .evaluate((element) => getComputedStyle(element.firstElementChild).backgroundColor);
  for (const locale of ["en", "ar", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN"]) {
    const text = JSON.parse(
      await readFile(new URL(`../client/locales/${locale}.json`, import.meta.url), "utf8"),
    );
    await page.getByRole("combobox", { name: "Preview language" }).selectOption(locale);
    await page.getByRole("heading", { name: text.title, exact: true }).waitFor();
    assert.equal(await page.locator("#preview-panel-title").innerText(), text.title);
    assert.equal(await page.locator("#preview-command-title").innerText(), text.commandTitle);
    assert.equal(
      await page.getByRole("button", { name: text.allPaths, exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await page.getByRole("textbox", { name: text.searchLabel }).inputValue(),
      "pending draft",
    );
    assert.equal(
      await page
        .getByRole("button", { name: text.archived, exact: true })
        .evaluate((element) => getComputedStyle(element.firstElementChild).backgroundColor),
      selectedFilterColor,
    );
    assert.equal(
      await page.getByText("Review sample pull request", { exact: true }).isVisible(),
      true,
    );
    const expectedDate = await page.evaluate(
      (language) =>
        new Intl.DateTimeFormat(language, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(1767268800 * 1000),
      locale,
    );
    await page.getByText(expectedDate, { exact: true }).waitFor();
  }
  const afterSwitch = await (await page.request.get(`${server.url}/api/test/stats`)).json();
  assert.equal(afterSwitch.listRequests, beforeSwitch.listRequests);

  await page.getByRole("combobox", { name: "Preview language" }).selectOption("en");
  await page.getByRole("textbox", { name: "Search Codex session titles" }).fill("");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="button"][aria-label^="Import "]').length === 50,
  );
  await page.getByRole("button", { name: "All paths", exact: true }).click();
  await page.getByText("Archived history from another project", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Load more sessions", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="button"][aria-label^="Import "]').length === 55,
  );
  await page.getByRole("button", { name: "Current workspace", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="button"][aria-label^="Import "]').length === 50,
  );
  assert.equal(
    await page.getByText("Archived history from another project", { exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await page.getByRole("textbox", { name: "Search Codex session titles" }).fill("another project");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="button"][aria-label^="Import "]').length === 0,
  );
  await page.getByRole("button", { name: "All paths", exact: true }).click();
  await page.getByText("Archived history from another project", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Import / }).count(), 1);
  assert.equal(
    await page.getByRole("textbox", { name: "Search Codex session titles" }).inputValue(),
    "another project",
  );
  await page.getByRole("textbox", { name: "Search Codex session titles" }).fill("");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByText("Unarchived history from another project", { exact: true }).waitFor();
  await page
    .getByTestId("codex-session-picker")
    .screenshot({ path: ".artifacts/desktop-light.png" });
  const second = await browser.newPage({
    viewport: { width: 900, height: 700 },
    timezoneId: "UTC",
  });
  await second.goto(`${server.url}/?lang=ja`);
  await second
    .getByRole("heading", { name: "Codex セッションをインポート", exact: true })
    .waitFor();
  await page.getByRole("combobox", { name: "Preview language" }).selectOption("fr");
  assert.equal(
    await second
      .getByRole("heading", { name: "Codex セッションをインポート", exact: true })
      .isVisible(),
    true,
  );
  await second.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server.url}/?theme=dark`);
  await page.getByText("Review sample pull request", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("Archived history from another project", { exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "所有路径", exact: true }).click();
  await page.getByText("Archived history from another project", { exact: true }).waitFor();
  for (const locale of ["en", "ar", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN"]) {
    const text = JSON.parse(
      await readFile(new URL(`../client/locales/${locale}.json`, import.meta.url), "utf8"),
    );
    await page.getByRole("combobox", { name: "Preview language" }).selectOption(locale);
    await page.getByRole("heading", { name: text.title, exact: true }).waitFor();
    await page.getByText(text.crossDirectoryHint, { exact: true }).waitFor();
    assert.equal(
      await page
        .getByText(text.sourceDirectory.replace("{{directory}}", "/example/other-project"), {
          exact: true,
        })
        .count(),
      2,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
  }
  await page
    .getByTestId("codex-session-picker")
    .screenshot({ path: ".artifacts/compact-dark.png" });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page
    .getByRole("button", { name: "导入 Review sample pull request", exact: true })
    .click({ clickCount: 2 });
  await page.getByText("会话已导入当前工作区。", { exact: true }).waitFor({ timeout: 60_000 });
  await page.getByText("已打开导入的会话", { exact: true }).waitFor();
  const stats = await (await page.request.get(`${server.url}/api/test/stats`)).json();
  assert.equal(stats.importRequests, 1);
  await page.getByRole("combobox", { name: "Preview language" }).selectOption("en");
  await page
    .getByText("The session was imported into the current workspace.", { exact: true })
    .waitFor();
  await page.getByText(/^Hidden 1 session already open in Paseo\. /).waitFor();

  await page
    .getByRole("button", { name: "Import Archived history from another project", exact: true })
    .click({ clickCount: 2 });
  await page
    .getByText("History was copied into a new session in the current workspace.", { exact: true })
    .waitFor({ timeout: 60_000 });
  // Wait for the refreshed list, not the temporary empty state while it loads.
  await page
    .getByRole("button", { name: "Import Investigate sample test failure", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Import Archived history from another project", exact: true })
      .count(),
    0,
  );
  const copiedStats = await (await page.request.get(`${server.url}/api/test/stats`)).json();
  assert.equal(copiedStats.importRequests, 2);
  await page.getByRole("combobox", { name: "Preview language" }).selectOption("zh-CN");
  await page.getByText("历史已复制为新会话，并导入当前工作区。", { exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Preview language" }).selectOption("en");

  await page.request.post(`${server.url}/api/test/disconnect`);
  await page
    .getByRole("button", { name: "Import Investigate sample test failure", exact: true })
    .click();
  await page
    .getByText("Could not connect to the current Paseo host. Check the connection and retry.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("combobox", { name: "Preview language" }).selectOption("zh-CN");
  await page.getByText("无法连接当前 Paseo 主机。请检查连接后重试。", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "导入 Investigate sample test failure", exact: true })
      .isEnabled(),
    true,
  );
  assert.deepEqual(failures, []);
  process.stdout.write(
    "Browser checks passed: current/all paths, scoped pagination and search, original-directory labels, same-directory restore, cross-directory copy, duplicate prevention, nine live locales, preserved state, and wide/compact layouts.\n",
  );
} catch (error) {
  await page.screenshot({ path: ".artifacts/browser-failure.png" });
  await writeFile(".artifacts/browser-failure.txt", await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
  await server.close();
}
