FROM node:20-alpine

WORKDIR /repo

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
