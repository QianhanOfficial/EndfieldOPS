#!/bin/zsh
exec "$(dirname -- "$0")/scripts/backup.command" "$@"
