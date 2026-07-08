FROM node:20-alpine

WORKDIR /repo

# Trust any locally-provided extra CA certs (corporate proxy / AV TLS inspection) before
# hitting the npm registry — harmless no-op when docker/certs/ has no *.crt file (empty
# bundle, Node just warns and ignores it). See docker/certs/README.md.
COPY docker/certs/ /tmp/extra-ca/
RUN cat /tmp/extra-ca/*.crt > /tmp/extra-ca-bundle.pem 2>/dev/null; touch /tmp/extra-ca-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/tmp/extra-ca-bundle.pem

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY services/decision-service/package.json services/decision-service/package.json
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY shared shared
COPY services/decision-service services/decision-service
COPY policy.md policy.md
COPY sample-invoices.json sample-invoices.json

RUN npm run build -w shared
RUN npm run build -w @approvalflow/decision-service

WORKDIR /repo/services/decision-service
RUN chmod +x docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
