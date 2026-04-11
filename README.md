# aaviator/harness v0.6

Web interface for Claude Code. Alpine.js frontend, Hono/Node.js backend.

## Quick start

```bash
cd backend && npm install
cp ../config.json.example ../config.json  # edit with your settings
npx tsx cli/node.ts
```

Or as a systemd service:

```bash
sudo ln -sf $(pwd)/claude-webui.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now claude-webui
journalctl -u claude-webui -f  # watch logs
```

## config.json

All configuration lives in `config.json` at the project root. Blocked from public access by the server.

```json
{
  "port": 19090,
  "host": "127.0.0.1",
  "debug": true,
  "defaultDir": "/path/to/default/dir",
  "allowSudo": true,
  "tmuxIdleHours": 4,
  "convPageSize": 10,
  "defaultModel": "claude-sonnet-4-6",
  "models": ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],

  "auth": true,
  "authUsername": "user",
  "authPasswordHash": "$2b$10$...",

  "corsOrigin": "https://your.domain",

  "env": {
    "NODE_TLS_REJECT_UNAUTHORIZED": "0",
    "ANTHROPIC_SMALL_FAST_MODEL": "claude-haiku-4-5-20251001"
  }
}
```

Generate a password hash:

```bash
node -e "require('bcryptjs').hash('YOUR_PASSWORD', 10, (e,h) => console.log(h))"
```

`env` keys are injected into `process.env` at startup — use for `NODE_TLS_REJECT_UNAUTHORIZED`, `ANTHROPIC_SMALL_FAST_MODEL`, `ANTHROPIC_API_KEY`, etc.

## Sudo setup

Sudo mode lets Claude run commands as root. This requires a wrapper script, a sudoers rule, and enabling `allowSudo` in config. **Only enable on trusted/isolated machines.**

### How it works

1. The web UI sends `useSudo: true` with chat requests
2. The backend swaps the Claude CLI path for `/usr/local/bin/claude-wrapper`
3. The wrapper spawns `sudo -n -E /usr/bin/node /path/to/claude/cli.js <args>`
4. `IS_SANDBOX=1` is set so `bypassPermissions` mode works under root
5. Sudoers grants the web server user passwordless sudo for `/usr/bin/node`

### Step 1: Install the wrapper

```bash
sudo bash setup-claude-wrapper.sh
```

This script:
- Copies `claude-wrapper.js` to `/usr/local/bin/claude-wrapper`
- Sets ownership to `root:root`, mode `755`
- Creates `/etc/sudoers.d/claude-wrapper` with the required rules
- Validates sudoers syntax with `visudo -c`
- Tests `sudo -n /usr/bin/node <claude-cli> --version`

### Step 2: Sudoers rule (created by setup script)

The setup script writes `/etc/sudoers.d/claude-wrapper`:

```
Defaults:YOUR_USER !requiretty
YOUR_USER ALL=(ALL) SETENV: NOPASSWD: /usr/bin/node
```

Key details:
- `!requiretty` — allows sudo from non-TTY processes (the web server)
- `SETENV:` — allows `sudo -E` to preserve environment variables (HOME, ANTHROPIC_API_KEY, etc.)
- `NOPASSWD:` — no password prompt (required for non-interactive use)
- `/usr/bin/node` with no args — allows node to be called with any arguments

### Step 3: Enable in config

```json
{
  "allowSudo": true
}
```

Restart the server. A lock icon appears in the chat header bar — click to toggle sudo for that conversation.

### Step 4: Verify

```bash
# Check wrapper is installed
ls -la /usr/local/bin/claude-wrapper

# Check sudoers syntax
sudo visudo -c -f /etc/sudoers.d/claude-wrapper

# Test passwordless sudo (as the web server user)
sudo -n /usr/bin/node --version

# Check wrapper logs after using sudo in the UI
cat /tmp/claude-wrapper.log
```

### The wrapper script (`claude-wrapper.js`)

Located at `/usr/local/bin/claude-wrapper`. The `REAL_CLAUDE` path can be overridden via environment variable (set in systemd service) when the project relocates. Called by the Claude Code SDK as:

```
node /usr/local/bin/claude-wrapper --output-format stream-json --verbose ...
```

It spawns:

```
sudo -n -E /usr/bin/node /path/to/claude-code/cli.js <same args>
```

Environment:
- `-n` — non-interactive (fail instead of prompting for password)
- `-E` — preserve caller's environment (HOME, API keys)
- `IS_SANDBOX=1` — bypasses Claude Code's root privilege check for `--dangerously-skip-permissions`

Logs to `/tmp/claude-wrapper.log` with timestamps, uid, args, and sudo diagnostics.

### Troubleshooting sudo

**"sudo: a password is required"**
- Check `/etc/sudoers.d/claude-wrapper` exists and has correct syntax
- Verify `!requiretty` is set for your user
- Run `sudo -nl` as the web server user to see allowed commands

**"Claude Code process exited with code 1" in bypass+sudo mode**
- Verify `IS_SANDBOX=1` is in the wrapper's `spawn` env
- This env var bypasses Claude Code's `--dangerously-skip-permissions cannot be used with root/sudo` check

**Wrapper not being called at all**
- Check `allowSudo: true` in config.json
- Check the sudo toggle is enabled in the conversation (lock icon in header)
- Check `/tmp/claude-wrapper.log` for entries

## Features

### Chat
- Streaming responses from Claude Code SDK
- Session continuity (resume conversations)
- Type-ahead while streaming — type your next message while Claude is responding, auto-sent on completion
- Permission mode cycling: default / edits / plan / bypass
- Permission approval dialog (allow once / allow always / deny)
- Markdown rendering toggle (live switch between rendered and raw, re-renders existing messages)
- Auto-generated conversation titles via Haiku
- Conversation history with context clearing
- Sudo mode (runs Claude as root via wrapper script)
- Persistent tmux sessions — Claude can run long-running processes and check on them later
- Transient errors shown as warnings (not blocking) while Claude is still working

### Terminal
- Integrated xterm.js terminal with tmux persistence
- Tmux sessions auto-created on first use, auto-cleaned when idle
- Claude is told about the tmux session via system prompt and can use `tmux send-keys` / `tmux capture-pane`

### Conversations
- Create with folder browser, subdirectory creation, model/mode selection
- Paginated list (configurable page size)
- Badges: model, permission mode, sudo, active tmux
- Ctrl+click to open in new tab
- Inline title editing

### Tmux management
- Homepage panel showing active sessions with conversation linkage
- Kill individual sessions or bulk cleanup
- Automatic cleanup: orphaned sessions on page load, idle sessions hourly
- Configurable idle TTL (`tmuxIdleHours`)
- Lazy creation — sessions created on first message or terminal open, recreated if expired

### Auth
- Username + bcrypt password hash in config.json
- Stable session tokens (invalidate by changing `authSecret`)
- Session cookie (7-day, HttpOnly, SameSite=Lax)
- All routes protected except login page and static assets

### Security
- CORS restricted to configured origin (not `*`)
- Shell injection prevented — all tmux commands use `execFileSync` (array args, no shell interpolation)
- AbortError handled separately from real errors
- 1MB request body limit on chat endpoint
- `config.json` blocked from public access

## Architecture

```
config.json              # all settings, blocked from public access
claude-webui.service     # systemd unit (symlinked to /etc/systemd/system/)
claude-wrapper.js        # sudo escalation wrapper
setup-claude-wrapper.sh  # installs wrapper + sudoers

backend/
  cli/node.ts            # entry point — loads config, starts server
  cli/args.ts            # CLI arg parsing with config defaults
  cli/version.ts         # version string
  app.ts                 # Hono routes + middleware
  types.ts               # AppConfig type
  handlers/
    chat.ts              # Claude SDK query, streaming, tmux session init
    auth.ts              # login/logout/status
    convStore.ts         # conversation CRUD
    title.ts             # Haiku title generation via SDK
    tmux.ts              # tmux session management API
    fs.ts                # directory listing + mkdir
    serverconfig.ts      # exposes config to frontend
    terminal.ts          # WebSocket PTY + tmux attach
  utils/
    conversationStore.ts # JSON file store (~/.config/claude-webui/) with in-memory cache
    tmux.ts              # tmux session utilities (list, create, kill, cleanup)
  middleware/
    auth.ts              # cookie-based session auth
    config.ts            # injects AppConfig into request context

frontend/
  index.html             # conversation list, tmux panel, new conversation modal
  chat.html              # chat interface + terminal tabs
  login.html             # auth page
  js/
    api.js               # API URL helpers + fetchJson
    auth.js              # login/logout/checkAuth
    conversations.js     # conversation API wrapper + DEFAULT_SETTINGS
    streaming.js         # NDJSON parser, markdown toggle, render helpers
    folder-picker.js     # directory browser component
    terminal.js          # xterm.js WebSocket client
  css/
    src.css              # Tailwind v4 source (with prose styles)
    app.css              # built CSS
  vendor/
    alpine.min.js        # Alpine.js 3.x
    marked.esm.js        # marked v17 ESM build
    xterm.js, addon-fit.js, xterm.css  # xterm.js 6.x
```

## CSS rebuild

```bash
cd frontend && npm install && npm run css
```

Scans `index.html`, `chat.html`, `login.html`, and `js/**/*.js` for Tailwind classes.

## Reverse proxy (Apache)

```apache
<VirtualHost *:443>
    ServerName your.domain
    ProxyPreserveHost On
    ProxyRequests Off
    ProxyPass / http://127.0.0.1:19090/
    ProxyPassReverse / http://127.0.0.1:19090/
    # SSL config...
</VirtualHost>
```

## License

AGPL-3.0. Inspired by [sugyan/claude-code-webui](https://github.com/sugyan/claude-code-webui) (MIT).
