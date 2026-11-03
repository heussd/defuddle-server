import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import buildApp from '../app.js';
import { blockListOf } from '../fetch-html.js';

const articleHtml = `
<html>
  <head>
    <title>Hello World</title>
    <meta name="author" content="Jane Doe">
  </head>
  <body>
    <nav>Menu</nav>
    <article>
      <h1>Hello World</h1>
      <p>This is the main article content, long enough to be picked up as the primary content of the page.</p>
    </article>
    <footer>Footer</footer>
  </body>
</html>`;

const latin1ArticleHtml = articleHtml.replace('Hello World', 'Café Crème');

const hugeBody = 'x'.repeat(6 * 1024 * 1024);

const fakeWebsitePages = {
  '/article': { contentType: 'text/html', body: articleHtml },
  '/empty': { contentType: 'text/html', body: '' },
  '/missing': { status: 404, contentType: 'text/html', body: articleHtml },
  '/document.pdf': { contentType: 'application/pdf', body: '%PDF-1.4' },
  '/huge': { contentType: 'text/html', body: hugeBody },
  '/huge-declared': { contentType: 'text/html', body: hugeBody, contentLength: hugeBody.length },
  '/redirect': { status: 302, location: '/article' },
  '/redirect-to-blocked': { status: 302, location: 'http://127.0.0.2/article' },
  '/redirect-to-file': { status: 302, location: 'file:///etc/passwd' },
  '/redirect-loop': { status: 302, location: '/redirect-loop' },
  '/latin1-header': {
    contentType: 'text/html; charset=windows-1252',
    body: Buffer.from(latin1ArticleHtml, 'latin1'),
  },
  '/latin1-meta': {
    contentType: 'text/html',
    body: Buffer.from(latin1ArticleHtml.replace('<head>', '<head><meta charset="windows-1252">'), 'latin1'),
  },
};

const app = await buildApp({ blockedNetworks: blockListOf([['127.0.0.2', 32, 'ipv4']]) });
const appBlockingPrivateNetworks = await buildApp();
let lastRequestHeaders;

const fakeWebsite = createServer((request, response) => {
  lastRequestHeaders = request.headers;
  const { status = 200, contentType, contentLength, location, body } = fakeWebsitePages[request.url];
  const headers = {
    ...(contentType && { 'content-type': contentType }),
    ...(contentLength && { 'content-length': contentLength }),
    ...(location && { location }),
  };
  response.writeHead(status, headers).end(body);
});

let fakeWebsiteUrl;

before(async () => {
  await new Promise((resolve) => fakeWebsite.listen(0, '127.0.0.1', resolve));
  fakeWebsiteUrl = `http://127.0.0.1:${fakeWebsite.address().port}`;
});

after(async () => {
  await app.close();
  await appBlockingPrivateNetworks.close();
  fakeWebsite.closeAllConnections();
  await new Promise((resolve) => fakeWebsite.close(resolve));
});

function postParse(body) {
  return app.inject({ method: 'POST', url: '/parse', payload: body });
}

test('health check reports ok', async () => {
  const response = await app.inject('/health');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('extracts the article from raw html', async () => {
  const response = await postParse({ html: articleHtml });
  const result = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(result.title, 'Hello World');
  assert.equal(result.author, 'Jane Doe');
  assert.match(result.content, /main article content/);
  assert.doesNotMatch(result.content, /Menu|Footer/);
  assert.equal(typeof result.wordCount, 'number');
});

test('accepts empty html', async () => {
  const response = await postParse({ html: '' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().wordCount, 0);
});

test('extracts content from an html fragment', async () => {
  const response = await postParse({ html: '<p>Just a fragment without html or body tags</p>' });

  assert.equal(response.statusCode, 200);
  assert.match(response.json().content, /Just a fragment/);
});

test('extracts title and content from html without an html tag', async () => {
  const response = await postParse({ html: '<title>No Html Tag</title><p>Text right after the title</p>' });
  const result = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(result.title, 'No Html Tag');
  assert.match(result.content, /Text right after the title/);
});

test('extracts content from a fetched page with an empty body', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/empty` });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().wordCount, 0);
});

test('passes options through to defuddle', async () => {
  const response = await postParse({ html: articleHtml, options: { markdown: true } });

  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(response.json().content, /<p>/);
});

test('fetches and extracts the article from a url', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/article` });
  const result = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(result.title, 'Hello World');
  assert.equal(result.domain, '127.0.0.1');
});

test('identifies itself and asks for html when fetching', async () => {
  await postParse({ url: `${fakeWebsiteUrl}/article`, options: { language: 'de' } });

  assert.match(lastRequestHeaders['user-agent'], /defuddle-server/);
  assert.match(lastRequestHeaders.accept, /text\/html/);
  assert.equal(lastRequestHeaders['accept-language'], 'de');
});

test('decodes pages using the charset from the content-type header', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/latin1-header` });

  assert.equal(response.json().title, 'Café Crème');
});

test('decodes pages using the charset from a meta tag', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/latin1-meta` });

  assert.equal(response.json().title, 'Café Crème');
});

test('responds with 502 when the website returns an error', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/missing` });

  assert.equal(response.statusCode, 502);
});

test('responds with 502 when the website is not html', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/document.pdf` });

  assert.equal(response.statusCode, 502);
  assert.match(response.json().message, /application\/pdf/);
});

test('responds with 502 when the page is too large', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/huge` });

  assert.equal(response.statusCode, 502);
  assert.match(response.json().message, /larger than/);
});

test('responds with 502 when the page declares a size that is too large', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/huge-declared` });

  assert.equal(response.statusCode, 502);
  assert.match(response.json().message, /larger than/);
});

test('responds with 502 when the website cannot be reached', async () => {
  const response = await postParse({ url: 'http://127.0.0.1:2/article' });

  assert.equal(response.statusCode, 502);
  assert.match(response.json().message, /failed: connect ECONNREFUSED/);
});

test('follows redirects', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/redirect` });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().title, 'Hello World');
});

test('responds with 403 when a redirect leads to a blocked address', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/redirect-to-blocked` });

  assert.equal(response.statusCode, 403);
  assert.match(response.json().message, /127\.0\.0\.2 is not allowed/);
});

test('responds with 502 when a redirect leads to a non-http url', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/redirect-to-file` });

  assert.equal(response.statusCode, 502);
  assert.match(response.json().message, /HTTP\(S\) scheme/);
});

test('responds with 502 when redirects do not end', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/redirect-loop` });

  assert.equal(response.statusCode, 502);
  assert.match(response.json().message, /redirect count exceeded/);
});

for (const host of ['127.0.0.1', 'localhost', '[::1]', '[::ffff:127.0.0.1]', '10.0.0.1', '169.254.169.254', '192.168.1.1']) {
  test(`blocks private network address ${host} by default`, async () => {
    const response = await appBlockingPrivateNetworks.inject({
      method: 'POST',
      url: '/parse',
      payload: { url: `http://${host}/article` },
    });

    assert.equal(response.statusCode, 403);
  });
}

test('accepts html larger than the default request size limit', async () => {
  const largeHtml = articleHtml.replace('</body>', `<!-- ${'x'.repeat(2 * 1024 * 1024)} --></body>`);
  const response = await postParse({ html: largeHtml });

  assert.equal(response.statusCode, 200);
});

test('responds with 400 when the html is larger than the page size limit', async () => {
  const response = await postParse({ html: 'x'.repeat(6 * 1024 * 1024) });

  assert.equal(response.statusCode, 400);
});

test('responds with 400 when neither url nor html is given', async () => {
  const response = await postParse({});

  assert.equal(response.statusCode, 400);
});

test('responds with 400 when the url is invalid', async () => {
  const response = await postParse({ url: 'not a url' });

  assert.equal(response.statusCode, 400);
});

test('responds with 400 when the url is not http or https', async () => {
  const response = await postParse({ url: 'file:///etc/passwd' });

  assert.equal(response.statusCode, 400);
});

test('responds with 400 when the request has unknown fields', async () => {
  const response = await postParse({ html: articleHtml, selector: 'article' });

  assert.equal(response.statusCode, 400);
});

test('responds with 400 when an option is unknown', async () => {
  const response = await postParse({ html: articleHtml, options: { fetch: 'anything' } });

  assert.equal(response.statusCode, 400);
});

test('responds with 400 when an option has the wrong type', async () => {
  const response = await postParse({ html: articleHtml, options: { markdown: 'yes' } });

  assert.equal(response.statusCode, 400);
});

test('accepts every documented option', async () => {
  const options = {
    markdown: false,
    separateMarkdown: true,
    language: 'en',
    contentSelector: 'article',
    includeReplies: 'extractors',
    removeExactSelectors: true,
    removePartialSelectors: true,
    removeImages: false,
    removeSmallImages: true,
    removeHiddenElements: true,
    removeLowScoring: true,
    removeContentPatterns: true,
    standardize: true,
    useAsync: false,
    debug: false,
    profile: true,
  };

  const response = await postParse({ html: articleHtml, options });
  const result = response.json();

  assert.equal(response.statusCode, 200);
  assert.match(result.contentMarkdown, /main article content/);
  assert.ok(Object.values(result.profile).every((duration) => typeof duration === 'number'));
});

test('errors follow the error response model', async () => {
  const response = await postParse({ url: `${fakeWebsiteUrl}/missing` });

  assert.deepEqual(Object.keys(response.json()).sort(), ['error', 'message', 'statusCode']);
});

test('serves the openapi spec generated from the schemas', async () => {
  const response = await app.inject('/docs/json');
  const spec = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(spec.openapi, '3.1.0');
  assert.deepEqual(Object.keys(spec.paths), ['/health', '/parse']);
  assert.deepEqual(spec.paths['/parse'].post.requestBody.content['application/json'].schema, {
    $ref: '#/components/schemas/ParseRequest',
  });
  assert.ok(spec.components.schemas.ParseResult);
});

test('redirects visitors to the swagger ui', async () => {
  const response = await app.inject('/');

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/docs');
});

test('serves the swagger ui', async () => {
  const response = await app.inject('/docs');

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/html/);
});
