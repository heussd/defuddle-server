FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS base
WORKDIR /app
COPY package*.json ./

FROM base AS dependencies
RUN npm ci

FROM dependencies AS test
COPY *.js ./
COPY test ./test
RUN npm test && touch /tests-passed

FROM base AS production
ENV NODE_ENV=production
RUN npm ci --omit=dev
COPY --from=test /tests-passed /tmp/tests-passed
COPY *.js ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]
