# Development Process — aaviator/harness v0.6

Built in a single multi-session conversation between a human developer and Claude Sonnet 4.6 (`claude-sonnet-4-6`), using Claude Code CLI. The entire project — architecture, implementation, debugging, refactoring — was done conversationally with iterative feedback.

---

## Phase 1: Architecture & Frontend Rewrite

### Starting point
Fork of [sugyan/claude-code-webui](https://github.com/sugyan/claude-code-webui) — a React/Vite frontend with a Hono/Deno backend wrapping the Claude Code SDK.

### Decision: drop React entirely
The React frontend (React Router, Vite, SWC, hooks, contexts, TypeScript JSX) was replaced with vanilla HTML + Alpine.js + Tailwind CSS. Reasons:
- No build step for development (ES modules loaded directly)
- Simpler mental model for a single-user tool
- Alpine.js provides reactivity without the React ecosystem overhead
- Vendor JS (Alpine, xterm, marked) copied to `vendor/` — no bundler dependency

### Implementation
Created three HTML pages (`index.html`, `chat.html`, `login.html`) and seven JS modules (`api.js`, `auth.js`, `conversations.js`, `streaming.js`, `folder-picker.js`, `terminal.js`, `project-config.js`). Each module is a self-contained ES module imported dynamically.

Alpine.js patterns used:
- `Alpine.store('ui', {...})` for shared state across components (tab, config panel, sudo, conversation)
- `Alpine.data('componentName', () => ({...}))` for component-scoped state
- `x-show` / `x-cloak` for conditional rendering
- Custom events (`window.dispatchEvent`) for cross-component communication (stream events, modal triggers)

### Bug: Alpine double-init
**Symptom**: Every response rendered twice in the chat UI.
**Root cause**: Alpine.js auto-calls `init()` when it's defined on component data. Adding `x-init="init()"` in the HTML called it a second time. All `window.addEventListener` calls doubled, so every stream event was handled twice.
**Fix**: Removed `x-init="init()"` from all component elements. Alpine's auto-init is sufficient.

---

## Phase 2: Conversation Model

### Design decision
Moved from a "project directory" model (upstream) to a "conversation" model. Each conversation has:
- A working directory (immutable after creation)
- An array of Claude session IDs (new ones created on "clear context")
- A tmux session name
- Per-conversation settings (model, mode, sudo, enter behavior, markdown)

### Backend store
`~/.config/claude-webui/conversations.json` — simple JSON file with in-memory cache. Every `load()` returns the cached array; `save()` writes to disk AND updates cache. This eliminated the per-request disk reads that were causing slow homepage loads.

### History rendering
On conversation open, all session IDs are loaded in order from the Claude Code JSONL history API. `─── context cleared ───` dividers are inserted between sessions. Each history message type (user, assistant, system, result, tool_use, tool_result) is rendered with appropriate formatting.

---

## Phase 3: Sudo Support

### Problem
The Claude Code SDK's `query()` has `executable` as a union type (`'bun' | 'deno' | 'node'`) — can't set it to a custom binary path. Needed a way to run Claude as root.

### Solution: wrapper script
Created `claude-wrapper.js` — a Node.js script installed at `/usr/local/bin/claude-wrapper`. The SDK calls `node /usr/local/bin/claude-wrapper <args>`, and the wrapper spawns `sudo -n -E /usr/bin/node /real/claude/cli.js <args>`.

### Debugging sudo authentication
This was a multi-step debugging process:

1. **Initial sudoers entry had trailing `*` wildcard** → parse error. Removed (no args = any args allowed in sudoers).

2. **`Defaults requiretty`** in system sudoers blocked sudo from non-TTY processes (the web server). Fixed with `Defaults:aavi !requiretty` in the per-user sudoers file.

3. **Sudoers with specific args** (`/usr/bin/node /path/to/cli.js`) required EXACT argument match. The SDK appends many flags (`--output-format stream-json --verbose --model...`). Fixed by using just `/usr/bin/node` (no args = any args allowed).

4. **`bypassPermissions` + sudo fails** — Claude Code checks `process.getuid() === 0 && !process.env.IS_SANDBOX` and refuses to run `--dangerously-skip-permissions` as root. Fixed by setting `IS_SANDBOX=1` in the wrapper's spawn env.

### Diagnostics added
The wrapper logs to `/tmp/claude-wrapper.log` with timestamps, uid, HOME, API key status, full args, and `sudo -nl` output. This was crucial for diagnosing the sudoers arg-matching issue.

---

## Phase 4: Permission Approval UI

### Problem
When Claude tries to use a tool that requires permission (in default/edits mode), the SDK returns a tool_result with an error. The old React UI had a permission dialog — our rewrite didn't.

### Implementation
- Track `_lastToolName` from `stream:tool_use` events
- Detect permission errors in `stream:tool_result` (isError + `/permission|not allowed|blocked|approval/i`)
- Get authoritative tool names from `stream:result.permission_denials` array
- Show amber dialog with "Allow once" / "Allow always" / "Deny"
- "Allow once" temporarily adds tools to `allowedTools`, re-sends the message, then restores
- "Allow always" permanently adds to `allowedTools` for the page session

### Bug: permission dialog looping
**Symptom**: Clicking "Allow once" dismissed the dialog but it reappeared immediately.
**Root cause**: When detected from `stream:tool_result`, `permReq.tools` was `[]` (empty) because the tool name wasn't tracked yet. So `allowOnce()` added nothing to `allowedTools` and re-sent with the same empty list.
**Fix**: Track `_lastToolName` from `stream:tool_use` (fires before `tool_result`), use it to populate `permReq.tools`. Also let `stream:result.permission_denials` override with authoritative tool names.

---

## Phase 5: Markdown Rendering

### Problem 1: marked.js never loaded
The UMD bundle was in `vendor/marked.js` but never included via `<script>` tag. `streaming.js` captured `window.marked?.parse` at module load time → always `undefined`.

### Attempted fix: add `<script>` tag
Added `<script src="/vendor/marked.js"></script>` to `chat.html`. Markdown still didn't render.

### Root cause: UMD bundle broken
Testing revealed the UMD build of marked v17 doesn't properly set `window.marked` in all environments. The double-getter indirection (`Pe(xt)` wrapping lazy getters) was unreliable.

### Final fix: ESM import
Downloaded `marked.esm.js` from the npm package (`marked@17.0.6`). Changed `streaming.js` to use a proper ES module import:
```js
import { parse as markedParse } from "/vendor/marked.esm.js";
```
No more `window.marked`, no UMD, no globals. Tested with Node ESM — `typeof parse === 'function'` and `parse('**bold**')` returns `<p><strong>bold</strong></p>`.

### Problem 2: markdown toggle not working
Multiple iterations of debugging:

1. **Parameter passing through closures** — passed `this.cfg.markdownEnabled` through event handler → `_appendText(text, mdEnabled)` → `renderText(text, md_enabled)`. Toggle changed the config but responses still rendered as markdown.

2. **Tried bypassing Alpine reactivity** — moved to a module-level `mdEnabled` variable in `streaming.js` with `setMdEnabled()` setter. `toggleMd()` called `setMdEnabled(false)`. Still didn't work.

3. **Cache busting** — browser was loading old `streaming.js` without `setMdEnabled` export. Added `?v=N` query params to imports. Then switched to `_import()` helper that appends `Date.now()` to all module imports — permanent fix for all caching issues.

4. **Missing `await`** — after switching to `_import()`, forgot `await` on some calls. Destructuring a Promise instead of the module gave `undefined` for all exports. `this._stream = new ClaudeStream()` silently failed → "can't access property send, this._stream is null".

5. **`this._msgs` null** — `document.getElementById('messages')` returned null because the three sequential `await _import()` calls delayed execution. Fixed by parallelizing imports with `Promise.all()` and adding `await this.$nextTick()` before DOM access.

6. **Toggle only affected new messages** — existing rendered messages didn't re-render when toggling. Fixed by storing raw text in `data-raw-text` attribute on every text element, then on toggle, walking all `[data-raw-text]` elements and re-rendering with `renderText()`.

### Typewriter effect (attempted and reverted)
Implemented progressive text reveal (line-by-line via `setInterval`) to simulate streaming since the SDK yields complete messages. User rejected it — "if getting response only in one go then don't fake slow it down". Reverted to instant render.

---

## Phase 6: Terminal & tmux

### Integrated terminal
xterm.js + WebSocket PTY. Backend spawns `tmux attach-session` or `tmux new-session` (falls back to raw bash if tmux unavailable). One-time warning banner stored in localStorage.

### Tmux session persistence
Each conversation gets a tmux session name (`cw-<id[:8]>`). Sessions survive page reloads. Claude is told about the session via `appendSystemPrompt` injection — can use `tmux send-keys` to start long-running processes and `tmux capture-pane` to check output later.

### Session lifecycle
- **Lazy creation**: sessions created on first chat message or terminal tab open, not at conversation creation
- **Auto-recreate**: if a session was killed (TTL, manual) and the user resumes the conversation, it's recreated automatically
- **Cleanup on boot**: kills any `cw-*` sessions not linked to existing conversations
- **Periodic cleanup**: hourly, kills sessions idle longer than `tmuxIdleHours` (configurable, default 4h)
- **Frontend cleanup**: fire-and-forget `POST /api/tmux/cleanup` on every homepage load
- **Never kill attached**: sessions with active terminal connections are protected

### Debugging tmux list parsing
**Symptom**: session names showed as `cw-50cd6d37_1775564388_1775564388_1_0` — the entire tab-separated line as one string.
**Root cause**: `\t` in a JS string inside `execSync('...\t...')` was being passed as literal backslash-t to the shell, not as a tab character.
**Fix**: switched delimiter from `\t` to `|||` — no shell escaping issues.

---

## Phase 7: Configuration & Auth

### config.json
Consolidated all settings into a single `config.json` at the project root:
- Server: port, host, debug
- Defaults: defaultDir, defaultModel, models list, convPageSize
- Auth: username, bcrypt password hash
- Sudo: allowSudo flag
- Tmux: idle TTL
- Environment: arbitrary env vars injected at startup (NODE_TLS_REJECT_UNAUTHORIZED, ANTHROPIC_SMALL_FAST_MODEL)

Config is loaded in `cli/node.ts`, env vars applied before any imports, settings passed through to `createApp()`. Frontend reads configurable values from `GET /api/server-config`.

### Auth implementation
Existing auth middleware (from upstream) was already built but never enabled. Changes:
- Added username field to login form and handler
- Pre-hashed passwords in config (no plaintext, no runtime hashing)
- Changed cookie `SameSite` from `Strict` to `Lax` (required for HTTPS reverse proxies)
- Added `/js/` to auth middleware skip list (JS modules needed for login page to work)
- Added `_import()` cache-busting to login page

### WebFetch model 404
**Symptom**: Claude's WebFetch tool failed with `not_found_error: model: claude-3-5-haiku-20241022`.
**Root cause**: SDK's internal WebFetch uses a Haiku model for content summarization, but the model ID was outdated.
**Fix**: Set `ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5-20251001` in config.json env vars.

### SSL certificate error
**Symptom**: `unable to get local issuer certificate` on WebFetch.
**Fix**: `NODE_TLS_REJECT_UNAUTHORIZED=0` in config.json env vars.

### Title generation: no API key
**Symptom**: auto-title via Haiku never worked — silent 500 error.
**Root cause**: title handler used `process.env.ANTHROPIC_API_KEY` for a direct API call, but the key wasn't in the environment (auth is via Claude Code's OAuth tokens).
**Fix**: rewrote title handler to use the SDK's `query()` function (which handles auth through the CLI), not a direct API call.

---

## Phase 8: Polish & Deployment

### UI refinements
- Badges lowercase (`bypass` not `Bypass`)
- Active tmux badge (green) on conversation cards
- Ctrl+click opens conversation in new tab
- Pagination (configurable page size, "Show more" button)
- Folder picker: "Select" not "Open", auto-expand root, cache reset on reset
- Subdirectory creation in new conversation modal
- Full path tooltip on WD badge in chat header
- Send/Stop button height matches textarea
- "Waiting for response..." loading indicator
- List styles (bullets, numbers) in rendered markdown
- Tool result blocks wrap long lines

### Tailwind v4 migration
The upstream project used Tailwind v3 via Vite plugin (scanning React source). After nuking React:
- Installed `@tailwindcss/cli` v4 as standalone package
- CSS uses `@import "tailwindcss"` with `@source` directives pointing to HTML and JS files
- `@layer components` with `@apply` — had to inline `.btn` styles into each variant (v4 doesn't allow `@apply` with custom component classes)
- Build: `npm run css` from `frontend/`

### systemd service
Created `claude-webui.service` — symlinked to `/etc/systemd/system/`. Runs as user `aavi`, auto-restarts on crash, starts on boot.

### React cleanup
Deleted `frontend/src/` (React components, hooks, contexts, types, tests), `vite.config.ts`, all TypeScript configs, ESLint config, Playwright config, demo scripts. Stripped `package.json` to just `tailwindcss` and `@tailwindcss/cli`. Node modules went from hundreds of packages to 2.

### Git & deployment
- Set origin to `git@github-aaviator:aaviator/harness.git` (SSH with host alias)
- Created clean repo (no upstream history) with single commit
- `config.json` in `.gitignore`, `config.json.example` committed
- AGPL-3.0 license

---

## Recurring patterns

### Browser caching
ES module imports are cached aggressively. After any JS file change, the browser served stale code. Multiple bugs were caused by this before implementing the `_import()` helper:
```js
const _v = Date.now();
function _import(path) { return import(path + '?v=' + _v); }
```
All dynamic imports in all HTML files go through this function.

### The `await` tax
Every `_import()` call returns a Promise. Forgetting `await` gives `undefined` destructured values with no error — just silent failures downstream. This caused "null is not an object" errors multiple times.

### Alpine reactivity boundaries
Alpine's reactivity works within component scope but not across plain event listeners. Stream events (`window.addEventListener`) capture `this` correctly via arrow functions, but the reactive proxy doesn't auto-update plain JS variables. This was the root cause of the markdown toggle not working — ultimately solved by moving the flag to a module-level variable in streaming.js.

### Discuss → plan → implement → test
Every feature batch followed this pattern:
1. User describes desired behavior
2. Discussion of approach, tradeoffs, questions
3. Written plan file (PLAN-N.md) with file-by-file changes
4. Implementation, easiest to hardest
5. User tests, reports bugs
6. Debug cycle

The plans were useful as alignment checkpoints but often needed adjustment during implementation as edge cases emerged.

---

## Tools and environment

- **Model**: Claude Sonnet 4.6 (`claude-sonnet-4-6`) via Claude Code CLI
- **Server**: Ubuntu 22.04, Node.js 22.22.0
- **Reverse proxy**: Apache with ProxyPass to localhost:19090
- **Domain**: private (HTTPS via Apache reverse proxy) (HTTPS)
- **Session**: Single extended conversation with context compaction (session summary preserved across context window resets)
