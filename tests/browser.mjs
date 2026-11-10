import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));
try {
  await page.goto(server.url);
  await page.getByText("Review sample pull request", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^导入 / }).count(), 50);
  await page.screenshot({ path: ".artifacts/desktop-light.png" });
  await page.getByRole("button", { name: "加载更多会话", exact: true }).click();
  await page.getByRole("button", { name: "导入 Sample conversation 53", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^导入 / }).count(), 53);

  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await page.getByText("Review sample pull request", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "搜索 Codex 会话标题" }).fill("pull request");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="button"][aria-label^="导入 "]').length === 1,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server.url}/?theme=dark`);
  await page.getByText("Review sample pull request", { exact: true }).waitFor();
  await page.screenshot({ path: ".artifacts/compact-dark.png" });
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

  await page.request.post(`${server.url}/api/test/disconnect`);
  await page
    .getByRole("button", { name: "导入 Investigate sample test failure", exact: true })
    .click();
  await page.getByText("无法连接当前 Paseo 主机。请检查连接后重试。", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "导入 Investigate sample test failure", exact: true })
      .isEnabled(),
    true,
  );
  assert.deepEqual(failures, []);
  process.stdout.write(
    "Browser checks passed: pagination, search, archive filter, import, duplicate prevention, connection error, wide/light and compact/dark layouts.\n",
  );
} catch (error) {
  await page.screenshot({ path: ".artifacts/browser-failure.png" });
  await writeFile(".artifacts/browser-failure.txt", await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
  await server.close();
}
