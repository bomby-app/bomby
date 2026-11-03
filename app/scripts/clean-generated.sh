#!/usr/bin/env bash
# After `shadcn add`: generated registry code imports `React` it doesn't use (the classic
# JSX runtime habit), which our strict tsconfig (noUnusedLocals) rejects. Drop that default
# import from any generated file that never references `React.`. Run by `just app add`.
set -euo pipefail
cd "$(dirname "$0")/.."
for file in $(grep -rlE '^import React(,| from)' src/components/ui src/components/agents-ui src/hooks 2>/dev/null); do
  grep -q 'React\.' "$file" && continue
  perl -0pi -e 's/^import React, \{/import {/mg; s/^import React from ["\x27]react["\x27];?\n//mg' "$file"
done
