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
COPY services/submission-service/package.json services/submission-service/package.json
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY shared shared
COPY services/submission-service services/submission-service

RUN npm run build -w shared
RUN npm run build -w @approvalflow/submission-service

WORKDIR /repo/services/submission-service
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
