FROM node:20-alpine

WORKDIR /repo

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY services/payment-service/package.json services/payment-service/package.json
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY shared shared
COPY services/payment-service services/payment-service
COPY sample-invoices.json sample-invoices.json

RUN npm run build -w shared
RUN npm run build -w @approvalflow/payment-service

WORKDIR /repo/services/payment-service
RUN chmod +x docker-entrypoint.sh

EXPOSE 3002
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
