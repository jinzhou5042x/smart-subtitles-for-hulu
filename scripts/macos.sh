#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/node/bin:$HOME/.local/bin:$HOME/.volta/bin:$HOME/.fnm/aliases/default/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
# Finder does not load shell initialization files. Resolve nvm's selected Node
# without sourcing user shell code or overriding a bundled/Homebrew runtime.
if ! command -v node >/dev/null; then
  nvm_root="${NVM_DIR:-$HOME/.nvm}"
  nvm_default=""
  if [ -f "$nvm_root/alias/default" ]; then nvm_default=$(cat "$nvm_root/alias/default"); fi
  for candidate in "$nvm_root"/versions/node/*/bin "$nvm_root/versions/node/$nvm_default/bin" "$nvm_root/versions/node/v$nvm_default/bin"; do
    if [ -x "$candidate/node" ]; then export PATH="$candidate:$PATH"; fi
  done
fi
if ! command -v node >/dev/null; then
  echo 'Node.js 22.13 or later is required. Install Node.js, then reopen this launcher.'
  exit 1
fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) { console.error("Node.js 22.13 or later is required."); process.exit(1); }'
case "${1:-}" in
  start)
    if [ -f scripts/build.mjs ]; then node scripts/build.mjs; fi
    node scripts/companion.mjs start ;;
  stop) node scripts/companion.mjs stop ;;
  doctor) node scripts/doctor.mjs ;;
  setup)
    # Use an installed Codex if there is one; otherwise install the official CLI into this
    # folder, at the version this release was run with on macOS. Sign in only when needed.
    codex_version='0.162.1'
    if command -v codex >/dev/null; then
      codex=(codex)
      node scripts/configure-codex.mjs path "$(command -v codex)"
    else
      echo "Installing the Codex CLI $codex_version into this folder (one time)..."
      npm install --prefix "$PWD/codex" --no-audit --no-fund --loglevel=error "@openai/codex@$codex_version"
      codex=(node codex/node_modules/@openai/codex/bin/codex.js)
      node scripts/configure-codex.mjs bundled
    fi
    if ! "${codex[@]}" login status; then
      echo 'Sign in to Codex with your ChatGPT account in the browser window that opens.'
      "${codex[@]}" login || { echo 'Codex sign-in did not complete. Run "Set Up Codex.command" again.'; exit 1; }
    fi
    echo 'Codex is ready. A running subtitle service notices within a few seconds.' ;;
  *) echo 'Usage: macos.sh start|stop|doctor|setup'; exit 1 ;;
esac
