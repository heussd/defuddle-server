FROM node:26-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS base
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
