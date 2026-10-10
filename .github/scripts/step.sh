#!/usr/bin/env bash
# Runs a CI step and, if it fails, surfaces the useful part of its output as a
# GitHub annotation so the error is visible on the PR without opening the logs.
#   usage: step.sh "<title>" <command...>
set -uo pipefail
title="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  # Prefer real error lines; fall back to the tail of the output.
  body=$(grep -E "error TS|Error:|error:|ERR_|FAIL|✗|×|Failed to compile|Type error|Module not found|Cannot find" "$log" | head -n 80)
  [ -z "$body" ] && body=$(tail -n 60 "$log")
  body=$(printf '%s' "$body" | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-400 | sed 's/%/%25/g' | sed ':a;N;$!ba;s/\r//g;s/\n/%0A/g')
  echo "::error title=${title} failed::${body}"
  # Second annotation with the raw tail, for context.
  tailtxt=$(tail -n 40 "$log" | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-300 | sed 's/%/%25/g' | sed ':a;N;$!ba;s/\r//g;s/\n/%0A/g')
  echo "::warning title=${title} (last lines)::${tailtxt}"
fi
exit "$status"
