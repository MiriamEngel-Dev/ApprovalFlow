#!/usr/bin/env node
// N1: mints a self-signed dev/test JWT for one of the three roles (submitter | approver | admin).
//
// This is a standalone script with no Dapr sidecar of its own, so — unlike the services, which
// fetch JWT_SIGNING_KEY from the Dapr secret store at startup — it reads the same value from
// process.env. It MUST match dapr/secrets.json's JWT_SIGNING_KEY (two separate files, nothing
// syncs them automatically): export JWT_SIGNING_KEY from your .env before running, e.g.
//
//   node --env-file=.env scripts/generate-jwt.js submitter
//   node --env-file=.env scripts/generate-jwt.js approver alice@example.com
//
// Prints just the token to stdout, so it's easy to use directly:
//   TOKEN=$(node --env-file=.env scripts/generate-jwt.js admin)
//   curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/policy

import jwt from 'jsonwebtoken';

const ROLES = ['submitter', 'approver', 'admin'];
const [, , role, sub] = process.argv;

if (!role || !ROLES.includes(role)) {
  console.error(`Usage: generate-jwt.js <${ROLES.join('|')}> [sub]`);
  process.exit(1);
}

const signingKey = process.env.JWT_SIGNING_KEY;
if (!signingKey) {
  console.error(
    'JWT_SIGNING_KEY is not set — pass it via .env (must match dapr/secrets.json), e.g.\n' +
      '  node --env-file=.env scripts/generate-jwt.js ' + role,
  );
  process.exit(1);
}

const token = jwt.sign({ sub: sub ?? `${role}@example.com`, role }, signingKey, {
  algorithm: 'HS256',
  expiresIn: '12h',
});

console.log(token);
