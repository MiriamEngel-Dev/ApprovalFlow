#!/bin/sh
set -e

echo "decision-service: applying migrations..."
npx drizzle-kit migrate

exec "$@"
