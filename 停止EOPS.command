#!/bin/zsh
exec "$(dirname -- "$0")/scripts/stop.command" "$@"
