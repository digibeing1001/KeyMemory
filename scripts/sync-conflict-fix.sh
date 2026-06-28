#!/bin/bash
SRC=/mnt/c/Users/zexin/Desktop/KeyMemory
DST=/home/zexin/KeyMemory
FILES=(
  packages/server/src/core/dreaming.ts
  packages/server/src/api/rest.ts
  packages/web/src/lib/api.ts
  packages/web/src/i18n.tsx
  packages/web/src/components/DreamView.tsx
)
for f in "${FILES[@]}"; do
  mkdir -p "$(dirname "$DST/$f")"
  cp "$SRC/$f" "$DST/$f" && echo "OK $f" || echo "FAIL $f"
done
