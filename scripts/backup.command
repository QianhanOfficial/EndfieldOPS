#!/bin/zsh
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
python3 server/server.py --backup
print 'EOPS 备份完成：backups/ 中包含可导入的 JSON 和 SQLite 快照。'
