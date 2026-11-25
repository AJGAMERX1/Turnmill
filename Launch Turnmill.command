#!/bin/zsh
cd -- "${0:a:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if command -v node >/dev/null 2>&1; then
  exec node scripts/serve.mjs --open
else
  print 'Install Node.js 22 or later, then open Launch Turnmill.command again.'
  read -k 1
fi
