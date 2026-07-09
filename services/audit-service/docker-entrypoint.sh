#!/bin/sh
set -e

echo "audit-service: applying migrations..."
npx drizzle-kit migrate

exec "$@"
