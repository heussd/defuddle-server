FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS base
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
