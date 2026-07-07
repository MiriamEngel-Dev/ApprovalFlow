FROM node:20-alpine

WORKDIR /repo

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
