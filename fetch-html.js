import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, buildConnector, errors, fetch } from 'undici';
import sniffHtmlEncoding from 'html-encoding-sniffer';

export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; defuddle-server/1.0)';
const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];

export function blockListOf(networks) {
  const blockList = new BlockList();
  networks.forEach(([address, prefix, type]) => blockList.addSubnet(address, prefix, type));
  return blockList;
}

export const privateNetworks = blockListOf([
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
]);

export const noNetworks = new BlockList();

export class UpstreamError extends Error {
  statusCode = 502;
}

export class BlockedAddressError extends Error {
  statusCode = 403;
}

function connectToAllowedAddressesOnly(blockedNetworks) {
  function assertAllowed(address) {
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';

    if (blockedNetworks.check(address, family)) {
      throw new BlockedAddressError(`Fetching from ${address} is not allowed`);
    }
  }

  function lookupPreferringIpv4(hostname, options, callback) {
    dnsLookup(hostname, { ...options, family: 4, all: true }, (ipv4Error, ipv4Addresses) => {
      if (!ipv4Error) return callback(null, ipv4Addresses);
      dnsLookup(hostname, { ...options, family: 6, all: true }, callback);
    });
  }

  function lookup(hostname, options, callback) {
    lookupPreferringIpv4(hostname, options, (error, addresses) => {
      try {
        if (error) throw error;
        addresses.forEach(({ address }) => assertAllowed(address));
      } catch (lookupError) {
        return callback(lookupError);
      }

      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  }

  const connect = buildConnector({ lookup });

  return (options, callback) => {
    const host = options.hostname.replace(/^\[|\]$/g, '');

    try {
      if (isIP(host)) assertAllowed(host);
    } catch (blocked) {
      return callback(blocked);
    }

    connect(options, callback);
  };
}

function assertIsHtml(response) {
  const contentType = response.headers.get('content-type') ?? '';

  if (!HTML_CONTENT_TYPES.some((type) => contentType.includes(type))) {
    throw new UpstreamError(`Expected an HTML page but got "${contentType}"`);
  }
}

function decodeHtml(bytes, contentType) {
  const encoding = sniffHtmlEncoding(bytes, {
    transportLayerEncodingLabel: contentType.match(/charset=([^;]+)/i)?.[1],
    defaultEncoding: 'UTF-8',
  });

  return new TextDecoder(encoding).decode(bytes);
}

function explain(error, url) {
  const cause = error.cause ?? error;

  if (error instanceof UpstreamError || cause instanceof BlockedAddressError) return cause;
  if (cause instanceof errors.ResponseExceededMaxSizeError) return new UpstreamError(`Page is larger than ${MAX_PAGE_BYTES} bytes`);

  return new UpstreamError(`Fetching ${url} failed: ${cause.message}`);
}

export function createHtmlFetcher({ blockedNetworks = privateNetworks } = {}) {
  const dispatcher = new Agent({
    connect: connectToAllowedAddressesOnly(blockedNetworks),
    maxResponseSize: MAX_PAGE_BYTES,
  });

  async function fetchHtml(url, language) {
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: HTML_CONTENT_TYPES.join(','),
      ...(language && { 'Accept-Language': language }),
    };

    try {
      const response = await fetch(url, { headers, dispatcher, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

      if (!response.ok) {
        throw new UpstreamError(`Fetching ${url} failed with status ${response.status}`);
      }

      assertIsHtml(response);
      const bytes = new Uint8Array(await response.arrayBuffer());

      return decodeHtml(bytes, response.headers.get('content-type'));
    } catch (error) {
      throw explain(error, url);
    }
  }

  return { fetchHtml, close: () => dispatcher.close() };
}
