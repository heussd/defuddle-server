import Fastify from 'fastify';
import { parseHTML } from 'linkedom';
import { parse, serialize } from 'parse5';
import { Defuddle } from 'defuddle/node';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import * as schemas from './schemas.js';
import { createHtmlFetcher, MAX_PAGE_BYTES } from './fetch-html.js';
import packageJson from './package.json' with { type: 'json' };

const MAX_REQUEST_BYTES = 2 * MAX_PAGE_BYTES;

const strictValidation = {
  customOptions: { removeAdditional: false, coerceTypes: false },
};

const apiDocumentation = {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'Defuddle Server',
      description: 'Extracts the main content and metadata of web pages using [defuddle](https://github.com/kepano/defuddle).',
      version: packageJson.version,
    },
  },
  refResolver: {
    buildLocalReference: (schema, baseUri, fragment, index) => schema.$id ?? `def-${index}`,
  },
};

const healthRoute = {
  schema: {
    summary: 'Check that the service is running',
    tags: ['System'],
    response: { 200: { $ref: 'HealthResponse#' } },
  },
};

const parseRoute = {
  schema: {
    summary: 'Extract content and metadata from a web page',
    tags: ['Parse'],
    body: { $ref: 'ParseRequest#' },
    response: {
      200: { $ref: 'ParseResult#' },
      '4xx': { $ref: 'ErrorResponse#' },
      '5xx': { $ref: 'ErrorResponse#' },
    },
  },
};

function parseCompleteDocument(html) {
  const htmlWithMissingTagsAdded = serialize(parse(html));

  return parseHTML(htmlWithMissingTagsAdded).document;
}

export default async function buildApp({ blockedNetworks, ...fastifyOptions } = {}) {
  const app = Fastify({ ...fastifyOptions, ajv: strictValidation, bodyLimit: MAX_REQUEST_BYTES });
  const { fetchHtml, close } = createHtmlFetcher({ blockedNetworks });

  Object.values(schemas).forEach((schema) => app.addSchema(schema));
  await app.register(swagger, apiDocumentation);
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.addHook('onClose', close);

  app.get('/', { schema: { hide: true } }, (request, reply) => reply.redirect('/docs'));

  app.get('/health', healthRoute, async () => ({ status: 'ok' }));

  app.post('/parse', parseRoute, async (request) => {
    const { url, html, options } = request.body;
    const document = parseCompleteDocument(html ?? (await fetchHtml(url, options?.language)));

    return Defuddle(document, url, options);
  });

  return app;
}
