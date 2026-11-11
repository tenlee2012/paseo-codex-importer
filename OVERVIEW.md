# Codex session importer

Adds **Import Codex sessions** to the workspace and Explorer (**Files / Changes**) **+** menus and Command Center. Search local Codex history and import it into the current workspace. Start with the current directory or switch to **All paths**; archive filters and title search work in either scope.

Same-directory imports restore the original Codex thread and reuse a matching archived Paseo agent. Other directories copy history into a new thread in the current workspace, keeping the source conversation. The working directory always follows the destination. An archived source is temporarily unarchived for copying and re-archived before the copy is imported. Project files are not copied. Already-open conversations and sources already copied into the current workspace are excluded. Listing leaves archive state unchanged.

Requires Paseo 0.15.4+, Node.js 22.19+, and Codex CLI 0.167.0+ on the daemon machine. Tested on Linux, with desktop and compact client layouts. Uses the host's existing Codex command and environment. See the repository README for setup and development.

The interface follows each Paseo client's language setting, including live changes. Supports English, Arabic, Spanish, French, Japanese, Korean, Brazilian Portuguese, Russian, and Simplified Chinese, with English fallback. Menus, errors, dates, numbers, and accessibility labels follow the locale; search drafts and filters are preserved. Original session titles and paths stay unchanged. Translations are bundled locally.

Backend code reads local Codex history through app-server and uses the local Paseo connection credential for the official import client. Session titles, paths, timestamps, and IDs travel only through your existing Paseo connection to authorized clients. The plugin has no telemetry or public history upload and starts no model turn. Continuing imported conversations uses your normal provider settings.

If preparation succeeds but import fails, refresh the current directory to find restored or copied history. If a copy is interrupted or source re-archiving fails, check the original archive state before retrying. All listing screenshots use synthetic data.
