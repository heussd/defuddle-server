import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import buildApp from '../app.js';
import { createHtmlFetcher } from '../fetch-html.js';

const articleUrl = 'https://www.tagesschau.de/inland/gesellschaft/gen-z-proteste-verbot-100.html';

const productionOptions = {
  markdown: true,
  removeImages: true,
  removeSmallImages: true,
  standardize: false,
  useAsync: true,
};

const app = await buildApp();
const htmlFetcher = createHtmlFetcher();
let articleHtml;
let productionResult;

async function parse(payload) {
  const response = await app.inject({ method: 'POST', url: '/parse', payload });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

function parseArticleWith(changedOptions) {
  return parse({ url: articleUrl, html: articleHtml, options: { ...productionOptions, ...changedOptions } });
}

function countMarkdownImages(markdown) {
  return markdown.match(/!\[[^\]]*\]\([^)]*\)/g)?.length ?? 0;
}

before(async () => {
  articleHtml = await htmlFetcher.fetchHtml(articleUrl);
  productionResult = await parse({ url: articleUrl, options: productionOptions });
}, { timeout: 30_000 });

after(async () => {
  await app.close();
  await htmlFetcher.close();
});

test('extracts a real article from the internet', () => {
  assert.equal(productionResult.domain, 'tagesschau.de');
  assert.equal(productionResult.language, 'de');
  assert.match(productionResult.title, /Gen Z/);
  assert.match(productionResult.content, /Versammlung/);
  assert.match(productionResult.content, /Frankfurt/);
  assert.doesNotMatch(productionResult.content, /Impressum|Datenschutz/);
  assert.doesNotMatch(productionResult.content, /�/);
  assert.ok(productionResult.wordCount > 300, `expected a full article, got ${productionResult.wordCount} words`);
});

test('defuddle still declares every production option', async () => {
  const defuddleTypes = await readFile(new URL('types.d.ts', import.meta.resolve('defuddle/node')), 'utf8');

  for (const option of Object.keys(productionOptions)) {
    assert.match(defuddleTypes, new RegExp(`\\b${option}\\?: boolean;`), `option ${option} is no longer declared`);
  }
});

test('markdown: true returns markdown instead of html', async () => {
  const htmlResult = await parseArticleWith({ markdown: false });

  assert.match(productionResult.content, /^## /m);
  assert.doesNotMatch(productionResult.content, /<(p|div|h\d|img)[ >]/);
  assert.match(htmlResult.content, /<p[ >]/);
});

test('removeImages: true removes all images', async () => {
  const withImages = await parseArticleWith({ removeImages: false });

  assert.ok(countMarkdownImages(withImages.content) > 0, 'expected the article to contain images');
  assert.equal(countMarkdownImages(productionResult.content), 0);
});

test('removeSmallImages: true removes images smaller than 33px', async () => {
  const html = `<html><body><article>
    <p>An article paragraph that is long enough to be detected as the main content of this page.</p>
    <img src="https://example.com/icon.png" width="16" height="16" alt="icon">
    <img src="https://example.com/photo.png" width="600" height="400" alt="photo">
  </article></body></html>`;
  const options = { ...productionOptions, removeImages: false };

  const withSmallImagesRemoved = await parse({ html, options });
  const withSmallImagesKept = await parse({ html, options: { ...options, removeSmallImages: false } });

  assert.doesNotMatch(withSmallImagesRemoved.content, /icon\.png/);
  assert.match(withSmallImagesRemoved.content, /photo\.png/);
  assert.match(withSmallImagesKept.content, /icon\.png/);
});

test('standardize: false keeps layout markup', async () => {
  const notStandardized = await parseArticleWith({ markdown: false });
  const standardized = await parseArticleWith({ markdown: false, standardize: true });

  assert.match(notStandardized.content, /class="/);
  assert.doesNotMatch(standardized.content, /class="/);
});

test('useAsync: true does not change an article that has content', async () => {
  const withoutAsync = await parseArticleWith({ useAsync: false });
  const withAsync = await parseArticleWith({});

  assert.equal(withAsync.content, withoutAsync.content);
});
