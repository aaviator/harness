#!/bin/bash
set -e

WRAPPER_SRC="$(dirname "$0")/claude-wrapper.js"
WRAPPER_DEST="/usr/local/bin/claude-wrapper"
SUDOERS_FILE="/etc/sudoers.d/claude-wrapper"
USER="${SUDO_USER:-$(logname 2>/dev/null || echo "$USER")}"

# Locate claude-code cli.js — prefer explicit env var, then auto-detect
if [ -n "$REAL_CLAUDE" ]; then
  CLAUDE_CLI="$REAL_CLAUDE"
else
  CLAUDE_CLI="$(node -e "console.log(require.resolve('@anthropic-ai/claude-code/cli.js'))" 2>/dev/null || true)"
fi
if [ -z "$CLAUDE_CLI" ]; then
  echo "Error: could not locate @anthropic-ai/claude-code/cli.js. Set REAL_CLAUDE env var or install from the backend directory." >&2
  exit 1
fi
echo "Using REAL_CLAUDE=$CLAUDE_CLI"

echo "Installing claude-wrapper for user: $USER"

# Install wrapper
cp "$WRAPPER_SRC" "$WRAPPER_DEST"
chown root:root "$WRAPPER_DEST"
chmod 755 "$WRAPPER_DEST"
echo "✓ Installed $WRAPPER_DEST"

# Write sudoers entry
cat > "$SUDOERS_FILE" << EOF
Defaults:$USER !requiretty
$USER ALL=(ALL) SETENV: NOPASSWD: /usr/bin/node
EOF
chmod 440 "$SUDOERS_FILE"
echo "✓ Wrote $SUDOERS_FILE"

# Validate
if visudo -c -f "$SUDOERS_FILE"; then
  echo "✓ Sudoers syntax OK"
else
  echo "✗ Sudoers syntax error — removing file"
  rm "$SUDOERS_FILE"
  exit 1
fi

# Test
echo "Testing sudo access..."
if sudo -n /usr/bin/node "$CLAUDE_CLI" --version; then
  echo "✓ sudo claude works"
else
  echo "✗ sudo test failed"
  exit 1
fi

echo ""
echo "Done. Sudo wrapper is active."
