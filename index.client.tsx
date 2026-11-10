import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CodexImportPanel } from "./client/panel.js";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: "import-codex",
    title: "导入 Codex 会话",
    icon: "Import",
    locations: ["workspace"],
    Component: CodexImportPanel,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "import-codex",
    title: "导入 Codex 会话到当前工作区",
    icon: "Import",
    context: "workspace",
    keywords: ["codex", "import", "archive", "session", "导入", "归档", "会话"],
    onSelect({ openPanel }) {
      openPanel("import-codex");
    },
  });
  return () => {
    removeCommand();
    removePanel();
  };
}
