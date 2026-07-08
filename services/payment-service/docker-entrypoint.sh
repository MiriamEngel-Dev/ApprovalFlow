#!/bin/sh
set -e

echo "payment-service: applying migrations..."
npx drizzle-kit migrate

exec "$@"
