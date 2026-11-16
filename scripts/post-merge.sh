#!/bin/bash
set -euo pipefail
export CI=true
echo "Installing locked workspace dependencies..."
pnpm install --frozen-lockfile --reporter=append-only
echo "Checking development database schema..."
# Never force destructive schema changes without review.
pnpm --filter @workspace/db run push
echo "Post-merge setup complete."
