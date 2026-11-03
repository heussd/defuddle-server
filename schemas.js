import { MAX_PAGE_BYTES } from './fetch-html.js';

const nullableString = { type: ['string', 'null'] };

const flag = (description) => ({ type: 'boolean', description });

export const ParseOptions = {
  $id: 'ParseOptions',
  type: 'object',
  description: 'Options passed through to defuddle.',
  additionalProperties: false,
  properties: {
    markdown: flag('Return `content` as Markdown instead of HTML. Default: false.'),
    separateMarkdown: flag('Additionally return Markdown in `contentMarkdown`. Default: false.'),
    language: {
      type: 'string',
      description: 'Preferred language as BCP 47 tag. Sent as Accept-Language when fetching and used to pick transcript languages.',
      examples: ['en'],
    },
    contentSelector: {
      type: 'string',
      description: 'CSS selector of the main content element, bypassing auto-detection.',
      examples: ['article'],
    },
    includeReplies: {
      anyOf: [{ type: 'boolean' }, { const: 'extractors' }],
      description: '`extractors`: replies from site-specific extractors only (default). `true`: all replies including comment sections. `false`: no replies.',
    },
    removeExactSelectors: flag('Remove elements matching exact clutter selectors like ads and social buttons. Default: true.'),
    removePartialSelectors: flag('Remove elements matching partial clutter selectors. Default: true.'),
    removeImages: flag('Remove all images. Default: false.'),
    removeSmallImages: flag('Remove small images. Default: true.'),
    removeHiddenElements: flag('Remove hidden elements. Default: true.'),
    removeLowScoring: flag('Remove low-scoring content blocks. Default: true.'),
    removeContentPatterns: flag('Remove boilerplate like read times and article cards. Default: true.'),
    standardize: flag('Standardize footnotes, headings, code blocks and similar. Default: true.'),
    useAsync: flag('Allow site-specific extractors to call third-party APIs (e.g. YouTube transcripts) when the page itself has no content. Default: true.'),
    debug: flag('Return `debug` information about removed elements. Default: false.'),
    profile: flag('Return per-step timings in `profile`. Default: false.'),
  },
};

export const ParseRequest = {
  $id: 'ParseRequest',
  type: 'object',
  description: 'Provide `url` to have the server fetch the page, or `html` to parse it directly. When both are given, `html` is parsed and `url` is used to resolve links and pick site-specific extractors.',
  additionalProperties: false,
  properties: {
    url: {
      type: 'string',
      format: 'uri',
      pattern: '^https?://',
      description: 'Page to fetch. Only http and https are allowed. Addresses in private networks are refused unless the server runs with ALLOW_PRIVATE_NETWORKS=true.',
      examples: ['https://en.wikipedia.org/wiki/Web_scraping'],
    },
    html: {
      type: 'string',
      maxLength: MAX_PAGE_BYTES,
      description: 'Raw HTML to parse instead of fetching `url`.',
    },
    options: { $ref: 'ParseOptions#' },
  },
  anyOf: [{ required: ['url'] }, { required: ['html'] }],
};

export const MetaTag = {
  $id: 'MetaTag',
  type: 'object',
  description: 'A `<meta>` tag of the page.',
  properties: {
    name: nullableString,
    property: nullableString,
    content: nullableString,
  },
};

export const DebugInfo = {
  $id: 'DebugInfo',
  type: 'object',
  description: 'Present when `options.debug` is true.',
  required: ['contentSelector', 'removals'],
  properties: {
    contentSelector: { type: 'string', description: 'Selector of the element chosen as main content.' },
    removals: {
      type: 'array',
      description: 'Elements removed during cleanup.',
      items: {
        type: 'object',
        required: ['step', 'text'],
        properties: {
          step: { type: 'string' },
          selector: { type: 'string' },
          reason: { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
    errors: { type: 'array', items: { type: 'string' } },
  },
};

export const ParseResult = {
  $id: 'ParseResult',
  type: 'object',
  description: 'The extracted content and metadata as returned by defuddle.',
  required: [
    'content', 'title', 'description', 'domain', 'favicon', 'image', 'language',
    'published', 'author', 'site', 'schemaOrgData', 'wordCount', 'parseTime',
  ],
  properties: {
    content: { type: 'string', description: 'Cleaned main content as HTML, or Markdown when `options.markdown` is true.' },
    contentMarkdown: { type: 'string', description: 'Markdown version of the content when `options.separateMarkdown` is true.' },
    title: { type: 'string' },
    description: { type: 'string' },
    domain: { type: 'string' },
    favicon: { type: 'string', description: 'Favicon URL.' },
    image: { type: 'string', description: 'Main image URL.' },
    language: { type: 'string', description: 'Page language as BCP 47 tag.' },
    published: { type: 'string', description: 'Publication date as found on the page.' },
    author: { type: 'string' },
    site: { type: 'string', description: 'Site name.' },
    schemaOrgData: { description: 'schema.org data found on the page, as is.' },
    wordCount: { type: 'integer' },
    parseTime: { type: 'number', description: 'Parse duration in milliseconds.' },
    extractorType: { type: 'string', description: 'Name of the site-specific extractor that was used, if any.' },
    metaTags: { type: 'array', items: { $ref: 'MetaTag#' } },
    debug: { $ref: 'DebugInfo#' },
    profile: {
      type: 'object',
      description: 'Per-step timings in milliseconds when `options.profile` is true.',
      additionalProperties: { type: 'number' },
    },
    variables: {
      type: 'object',
      description: 'Additional values provided by site-specific extractors.',
      additionalProperties: { type: 'string' },
    },
  },
};

export const ErrorResponse = {
  $id: 'ErrorResponse',
  type: 'object',
  required: ['statusCode', 'error', 'message'],
  properties: {
    statusCode: { type: 'integer', examples: [502] },
    code: { type: 'string' },
    error: { type: 'string', examples: ['Bad Gateway'] },
    message: { type: 'string', examples: ['Fetching https://example.com/missing failed with status 404'] },
  },
};

export const HealthResponse = {
  $id: 'HealthResponse',
  type: 'object',
  required: ['status'],
  properties: {
    status: { const: 'ok' },
  },
};
