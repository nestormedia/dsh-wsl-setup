# dsh-wsl-mode

A DeepSeek Harness plugin that makes a session work in WSL (Windows Subsystem for Linux) by default, and lets you switch that off per session.

- `/wsl on` — this session runs shell work in WSL.
- `/wsl off` — this session uses the local Windows shell.
- `/wsl` — report the current mode.

**On by default**: a fresh session is already in WSL mode; only sessions you explicitly switch off are stored.

## What it actually does

The switch is not a per-request preference the model may forget — it is a system-prompt section registered **into that agent's own scope**, whose text is evaluated on every prompt assembly:

1. `agent/created` fires for each session; the plugin registers a section named `dsh-wsl-mode` on `agent.ctx.systemPrompt`.
2. The section's `text` is a provider: it returns the WSL instructions when the session's switch is on, and an empty string when it is off (empty text contributes nothing).
3. Toggling writes one boolean to disk, so the next prompt assembly already reflects it — no restart, no new turn, and no effect on any other session.

## Requirements

The instructions point the model at the **`wsl` tool**, which is provided by a companion plugin (the `dsh-wsl` plugin's host half). This plugin only decides *whether* the model should prefer WSL; it does not execute anything itself.

Without that tool the section still appears, and its last line tells the model to report the missing tool instead of silently falling back to Windows.

## Install

As a bundle (recommended — the patch inserts the host row):

```bash
dsh plugin --profile <profile> add file:/path/to/dsh-wsl-mode
```

or through the plugin manager's `install_bundle`. Then make sure the profile lists it among its bundles (`dsh.profile.bundles` in `profiles/<profile>/package.json`).

Manual install, without the plugin manager:

1. add `"dsh-wsl-mode": "file:/path/to/dsh-wsl-mode"` to the profile's `dependencies`;
2. `pnpm install` in the profile directory;
3. add the bundle to `dsh.profile.bundles`, or paste its row into `cordis.patch.yml`:
   ```yaml
   - insert:
       - id: dsh-wsl-mode
         name: 'dsh-wsl-mode'
   ```

Restart or reload the profile once so the row activates; after that, toggling is live.

## Configuration

Row config (`cordis.patch.yml`):

| Field | Default | Meaning |
|---|---|---|
| `enabledByDefault` | `true` | Mode for sessions with no stored choice |
| `order` | `900` | Where the section sits among prompt sections (ascending) |

```yaml
- id: dsh-wsl-mode
  name: 'dsh-wsl-mode'
  config:
    enabledByDefault: false
```

## Where the state lives

`%DSH_HOME%/dsh-wsl-mode.json` (or `~/.dsh/dsh-wsl-mode.json`):

```json
{ "sessions": { "sess_abc123": false } }
```

Only deviations are written; the file is rewritten atomically. Delete it to return every session to the default.

## Tests

```bash
npm test
```

Seven unit tests run in plain Node — no harness packages, no WSL, no network — against a fake Cordis context: default state, per-session isolation, toggle round-trip, argument validation, `enabledByDefault: false`, and the stored shape.

## Limits

- The section shapes the model's choice; an explicit user request for Windows still wins, by design.
- It does not change which execution backend a session has. The persistent WSL PTY belongs to the `dsh-wsl` preset (`极简模式 (WSL)`), not to this switch.
- In a preset whose persona is `complete: true` (such as `minimal-wsl`), prompt sections are ignored entirely — that preset already runs in WSL, so the switch is unnecessary there.

## License

MIT
