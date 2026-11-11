import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CodexImportPanel } from "./client/panel.js";
import { messages } from "./client/messages.js";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: "import-codex",
    title: messages.message("title"),
    icon: "Import",
    locations: ["workspace"],
    Component: CodexImportPanel,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "import-codex",
    title: messages.message("commandTitle"),
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
