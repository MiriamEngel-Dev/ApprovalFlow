#!/bin/sh
set -e

echo "submission-service: applying migrations..."
npx drizzle-kit migrate

exec "$@"
