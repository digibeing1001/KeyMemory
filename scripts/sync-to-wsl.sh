#!/bin/bash
# 把 Windows 仓库的修改同步到 WSL 仓库
SRC=/mnt/c/Users/zexin/Desktop/KeyMemory
DST=/home/zexin/KeyMemory

FILES=(
  packages/shared/src/types.ts
  packages/shared/src/constants.ts
  packages/server/src/core/memory-schema.ts
  packages/server/src/core/atom.ts
  packages/server/src/core/mcp-tools.ts
  packages/server/src/api/mcp.ts
  packages/server/src/core/mcp-executor.ts
  packages/server/src/core/migration.ts
  packages/server/src/core/auto.ts
  packages/server/src/core/forgetting.ts
  packages/server/src/core/dreaming.ts
  packages/server/src/core/scheduler.ts
  packages/server/src/core/project.ts
  packages/server/src/core/health.ts
  packages/server/src/api/rest.ts
  packages/server/src/db/mapper.ts
  packages/server/src/adapters/hermes.ts
  packages/web/src/lib/api.ts
  packages/web/src/i18n.tsx
  packages/web/src/components/Sidebar.tsx
  packages/web/src/App.tsx
  packages/web/src/hooks/useWorkingSet.ts
  packages/web/src/components/WorkingSetView.tsx
)

for f in "${FILES[@]}"; do
  mkdir -p "$(dirname "$DST/$f")"
  cp "$SRC/$f" "$DST/$f" && echo "OK $f" || echo "FAIL $f"
done

echo "--- 同步完成 ---"
