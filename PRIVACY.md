# Publication and runtime data

The public repository contains implementation, public dependency metadata, synthetic tests, and screenshots of generated sample conversations. It contains no captured user histories or local machine configuration.

Before publishing:

- Run `npm run check:privacy` against the complete project and tracked commit history.
- Inspect the staged file list and the first public commit. Keep `.env` files, credentials, logs, databases, real rollout files, local paths, and browser diagnostics out of Git.
- Use a public GitHub identity and GitHub's privacy email for commit authors and committers.
- Generate screenshots only with `npm run test:browser`. Inspect each selected image before copying it from `.artifacts/` to `assets/`. Do not publish screenshots of an ordinary connected workspace.
- Keep dependency lockfile URLs on the public npm registry. Never publish private registry configuration or authentication.

The automated scan detects common credentials, personal home paths, unexpected file types and private dependency sources. It does not replace a review of text or images. Its output names offending files without printing their contents.

At runtime, the plugin reads Codex session metadata from the selected daemon's local app-server. Restoring a selected archived session changes native Codex state. Paseo performs the actual agent import and history hydration. Listing and importing do not submit a model turn.

The server reads local Paseo connection credentials for the official Node import client because the high-level plugin API does not expose native-session import. These credentials remain on the daemon. Raw provider errors and stderr are discarded. The frontend receives structured error codes and the session summary required by its UI.

Titles, directory names, timestamps, and IDs remain visible to your authorized Paseo clients. The plugin does not anonymize your own live history, export it to GitHub, or add telemetry. Query data is held in memory and released when its panel query becomes unused. Normal Paseo persistence and the provider's existing data policies still apply.
