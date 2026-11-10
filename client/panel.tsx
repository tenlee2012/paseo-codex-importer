import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { importSession, listSessions } from "../shared/contracts.js";
import { SessionPicker } from "./session-picker.js";

export function CodexImportPanel(props: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(props.workspaceId, ({ directory, title, name }) => ({
    directory,
    name: title || name,
  }));
  const list = useRpc(listSessions);
  const importOne = useRpc(importSession);
  const navigation = props.navigation;
  const openAgent = navigation
    ? (agentId: string) => navigation.openAgent({ agentId, serverId: props.host.id })
    : undefined;
  return (
    <SessionPicker
      key={`${props.host.id}/${props.workspaceId}`}
      hostId={props.host.id}
      workspaceId={props.workspaceId}
      directory={workspace?.directory ?? null}
      workspaceName={workspace?.name ?? null}
      theme={props.theme}
      compact={props.layout.compact}
      list={list}
      importOne={importOne}
      openAgent={openAgent}
    />
  );
}
