Drop any locally-trusted extra CA certificates here as `*.crt` files (e.g. a corporate
proxy or antivirus TLS-inspection root cert) if `docker compose build` fails with
`npm error ... UNABLE_TO_VERIFY_LEAF_SIGNATURE` — that means something on your network
path is intercepting HTTPS to the npm registry with a certificate Alpine's default trust
store doesn't know about, even though your OS trusts it.

Files placed here are picked up by every service's Dockerfile (`update-ca-certificates`
runs before `npm ci`) and are gitignored — never committed, since they're specific to
one machine's network, not the project.

Nothing needs to be here for a normal environment; the build is a no-op without any
`.crt` file present.
