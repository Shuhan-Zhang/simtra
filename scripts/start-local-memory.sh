#!/bin/sh
set -eu
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export JAVA_HOME="$repo_dir/.local-memory/java/Contents/Home"
if [ ! -x "$JAVA_HOME/bin/java" ] || [ ! -x "$repo_dir/.local-memory/neo4j/bin/neo4j" ]; then
  echo 'Local memory runtime is not installed. See docs/local-memory.md.' >&2
  exit 1
fi
exec "$repo_dir/.local-memory/neo4j/bin/neo4j" start
