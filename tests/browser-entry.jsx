import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { SessionPicker } from "../client/session-picker.js";

const dark = new URLSearchParams(window.location.search).get("theme") === "dark";
const theme = {
  colors: {
    surface0: dark ? "#141416" : "#ffffff",
    surface1: dark ? "#232326" : "#f4f4f5",
    surface2: dark ? "#2d2d31" : "#eaeaec",
    border: dark ? "#343439" : "#e4e4e7",
    foreground: dark ? "#f4f4f5" : "#18181b",
    foregroundMuted: dark ? "#a1a1aa" : "#71717a",
    accent: dark ? "#7bb29a" : "#267451",
    accentForeground: dark ? "#141416" : "#ffffff",
    statusSuccess: "#267451",
    statusWarning: "#a16207",
    statusDanger: "#b91c1c",
  },
};

function request(operation, input) {
  return fetch(`/api/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then((response) => response.json());
}

function Preview() {
  const [opened, setOpened] = useState(false);
  return (
    <View style={{ height: "100%", backgroundColor: theme.colors.surface0 }}>
      {opened ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: theme.colors.foreground, padding: 12 }}
        >
          已打开导入的会话
        </Text>
      ) : null}
      <SessionPicker
        hostId="synthetic-host"
        workspaceId={window.importerFixture.workspaceId}
        directory={window.importerFixture.directory}
        workspaceName="Sample project"
        theme={theme}
        compact={window.innerWidth < 600}
        list={(input) => request("list", input)}
        importOne={(input) => request("import", input)}
        openAgent={() => setOpened(true)}
      />
    </View>
  );
}

createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={new QueryClient()}>
    <Preview />
  </QueryClientProvider>,
);
