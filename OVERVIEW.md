# Codex session importer

Adds **导入 Codex 会话** (Import Codex sessions) to the workspace **+** menu and Command Center. Search local Codex history, filter by archive state, and import a conversation into its original directory's workspace.

Listing history leaves archive state unchanged. Selecting an archived conversation restores that native thread and uses Paseo's existing import flow. Matching archived Paseo agents keep their ID; already-open conversations are excluded. Cross-directory migration is not supported.

Requires Paseo 0.15.4+, Node.js 22.19+, and Codex CLI 0.167.0+ on the daemon machine. Tested on Linux, with desktop and compact client layouts. Uses the host's existing Codex command and environment. The interface is in Simplified Chinese. See the repository README for setup and development.

Backend code reads local Codex history through app-server and uses the local Paseo connection credential for the official import client. Session titles, paths, timestamps, and IDs travel only through your existing Paseo connection to authorized clients. The plugin has no telemetry or public history upload and starts no model turn. Continuing imported conversations uses your normal provider settings.

If restoring the Codex thread succeeds but importing into Paseo fails, refresh before retrying; the thread may already be unarchived. All listing screenshots use synthetic data.
