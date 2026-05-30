import * as cheerio from 'cheerio';
import { gotScraping } from 'got-scraping';

const DEFAULT_INPUT = {
  keywords: [],
  searchUrls: [],
  maxResults: 100,
  includeSellerInfo: true,
  includeImages: true,
  includeShipping: true,
  includeSoldCount: true,
  minPrice: null,
  maxPrice: null,
  condition: '',
  location: '',
  deduplicateResults: true,
  debugMode: false,
  maxRetries: 2,
  requestTimeoutSecs: 30
};

const EBAY_ORIGIN = 'https://www.ebay.com';

export function normalizeInput(rawInput = {}) {
  const input = { ...DEFAULT_INPUT, ...rawInput };
  input.keywords = normalizeStringArray(input.keywords);
  input.searchUrls = normalizeUrlArray(input.searchUrls).filter((url) => getHostname(url).includes('ebay.'));
  input.maxResults = toBoundedInteger(input.maxResults, 1, 1000, DEFAULT_INPUT.maxResults, 'maxResults');
  input.minPrice = toOptionalNumber(input.minPrice, 'minPrice');
  input.maxPrice = toOptionalNumber(input.maxPrice, 'maxPrice');
  input.condition = String(input.condition ?? '').trim();
  input.location = String(input.location ?? '').trim();

  if (input.minPrice != null && input.maxPrice != null && input.maxPrice < input.minPrice) {
    throw new Error('Input "maxPrice" must be greater than or equal to "minPrice".');
  }
  if (!input.keywords.length && !input.searchUrls.length) {
    throw new Error('Provide at least one keyword or eBay search/category URL.');
  }

  return input;
}

export async function findEbayLeads(input, options = {}) {
  const scrapedAt = new Date().toISOString();
  const rows = [];

  const jobs = [
    ...input.searchUrls.map((url) => ({ searchUrl: url, sourceKeyword: null })),
    ...input.keywords.map((keyword) => ({ searchUrl: buildSearchUrl(keyword, input), sourceKeyword: keyword }))
  ];

  for (const job of jobs) {
    if (rows.length >= input.maxResults) break;
    await options.status?.(`Downloading public eBay results: ${job.sourceKeyword ?? job.searchUrl}`);
    let parsed = [];
    try {
      const response = await requestText(job.searchUrl, options);
      parsed = parseSearchPage(response.body, {
        searchUrl: response.url,
        sourceKeyword: job.sourceKeyword,
        input,
        scrapedAt,
        startPosition: rows.length + 1
      });
    } catch (error) {
      if (!job.sourceKeyword) throw error;
      options.logger?.warning?.('Direct eBay search request failed; using public search fallback.', {
        sourceKeyword: job.sourceKeyword,
        error: error.message
      });
    }
    const candidates = parsed.length || !job.sourceKeyword
      ? parsed
      : await searchEbayProductsWithBing(job.sourceKeyword, input, {
        ...options,
        scrapedAt,
        startPosition: rows.length + 1
      });
    for (const row of candidates) {
      if (rows.length >= input.maxResults) break;
      const enriched = await enrichWithItemPage(row, input, options);
      rows.push(enriched);
    }
  }

  const filtered = filterByPrice(rows, input);
  const deduped = input.deduplicateResults ? deduplicateBy(filtered, (row) => row.itemId || normalizeUrlForKey(row.productUrl)) : filtered;
  return deduped.slice(0, input.maxResults);
}

export function buildSearchUrl(keyword, input = {}) {
  const url = new URL('/sch/i.html', EBAY_ORIGIN);
  url.searchParams.set('_nkw', keyword);
  url.searchParams.set('_sop', '12');
  if (input.minPrice != null) url.searchParams.set('_udlo', String(input.minPrice));
  if (input.maxPrice != null) url.searchParams.set('_udhi', String(input.maxPrice));
  if (/new/i.test(input.condition ?? '')) url.searchParams.set('LH_ItemCondition', '1000');
  if (/used/i.test(input.condition ?? '')) url.searchParams.set('LH_ItemCondition', '3000');
  if (/refurb/i.test(input.condition ?? '')) url.searchParams.set('LH_ItemCondition', '2000');
  return url.toString();
}

export function parseSearchPage(html, context = {}) {
  const $ = cheerio.load(html);
  const cards = $('.s-item').toArray();
  const rows = [];
  let cardIndex = 0;
  for (const element of cards) {
    const row = parseCard($, element, { ...context, cardIndex });
    if (row?.productTitle && row?.productUrl && !/Shop on eBay/i.test(row.productTitle)) {
      rows.push(row);
      cardIndex += 1;
    }
  }
  return rows;
}

export function parseCard($, element, context = {}) {
  const card = $(element);
  const link = card.find('a.s-item__link').first();
  const productUrl = cleanEbayItemUrl(link.attr('href'));
  const productTitle = cleanText(card.find('.s-item__title').first().text()).replace(/^New Listing\s*/i, '');
  const priceText = cleanText(card.find('.s-item__price').first().text());
  const shippingText = cleanText(card.find('.s-item__shipping, .s-item__logisticsCost').first().text());
  const sellerText = cleanText(card.find('.s-item__seller-info-text, .s-item__seller-info').first().text());
  const imageUrl = context.input?.includeImages === false
    ? null
    : normalizeImageUrl(card.find('.s-item__image-wrapper img, img.s-item__image-img').first().attr('src')
      || card.find('.s-item__image-wrapper img, img.s-item__image-img').first().attr('data-src'));
  const parsedPrice = parseMoney(priceText);
  const itemId = extractItemId(productUrl);
  const seller = parseSellerText(sellerText);
  const soldCount = context.input?.includeSoldCount === false
    ? null
    : parseSoldCount(cleanText(card.text()));
  const itemLocation = cleanText(card.find('.s-item__location, .s-item__itemLocation').first().text()).replace(/^from\s+/i, '') || null;
  const listingType = inferListingType(cleanText(card.text()));

  return {
    productTitle,
    productUrl,
    itemId,
    price: parsedPrice.amount,
    currency: parsedPrice.currency,
    shippingPrice: context.input?.includeShipping === false ? null : parseMoney(shippingText).amount,
    condition: cleanText(card.find('.SECONDARY_INFO, .s-item__subtitle').first().text()) || null,
    imageUrl,
    sellerName: context.input?.includeSellerInfo === false ? null : seller.name,
    sellerUrl: context.input?.includeSellerInfo === false ? null : seller.url,
    sellerRating: context.input?.includeSellerInfo === false ? null : seller.rating,
    sellerFeedbackPercent: context.input?.includeSellerInfo === false ? null : seller.feedbackPercent,
    storeName: null,
    storeUrl: null,
    soldCount,
    itemLocation,
    listingType,
    sourceKeyword: context.sourceKeyword ?? null,
    rankingPosition: context.startPosition ? context.startPosition + rowsOffset(context) : null,
    scrapedAt: context.scrapedAt
  };
}

async function enrichWithItemPage(row, input, options = {}) {
  if (!row.productUrl || (!input.includeSellerInfo && !input.includeSoldCount)) return row;
  try {
    const response = await requestText(row.productUrl, options);
    const details = parseItemPage(response.body, response.url);
    return {
      ...row,
      sellerName: input.includeSellerInfo ? details.sellerName ?? row.sellerName : null,
      sellerUrl: input.includeSellerInfo ? details.sellerUrl ?? row.sellerUrl : null,
      sellerRating: input.includeSellerInfo ? details.sellerRating ?? row.sellerRating : null,
      sellerFeedbackPercent: input.includeSellerInfo ? details.sellerFeedbackPercent ?? row.sellerFeedbackPercent : null,
      storeName: input.includeSellerInfo ? details.storeName ?? row.storeName : null,
      storeUrl: input.includeSellerInfo ? details.storeUrl ?? row.storeUrl : null,
      soldCount: input.includeSoldCount ? details.soldCount ?? row.soldCount : null
    };
  } catch (error) {
    options.logger?.debug?.('Could not enrich eBay item page.', { productUrl: row.productUrl, error: error.message });
    return row;
  }
}

export function parseItemPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const sellerName = cleanText($('[data-testid="x-sellercard-atf__info__about-seller"] a, a[href*="/usr/"]').first().text());
  const sellerUrl = toAbsoluteUrl($('a[href*="/usr/"]').first().attr('href'), pageUrl);
  const storeUrl = toAbsoluteUrl($('a[href*="/str/"]').first().attr('href'), pageUrl);
  const storeName = cleanText($('a[href*="/str/"]').first().text()) || null;
  const text = cleanText($('body').text());
  return {
    sellerName: sellerName || null,
    sellerUrl,
    sellerRating: toNullableInteger(text.match(/(\d[\d,]*)\s+feedback/i)?.[1]),
    sellerFeedbackPercent: toNullableNumber(text.match(/(\d+(?:\.\d+)?)%\s+positive/i)?.[1]),
    storeName,
    storeUrl,
    soldCount: parseSoldCount(text)
  };
}

export async function searchEbayProductsWithBing(keyword, input, options = {}) {
  const query = ['site:ebay.com/itm', keyword, input.condition, input.location].filter(Boolean).join(' ');
  const urls = [
    `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`,
    `https://www.bing.com/search?cc=us&setlang=en-US&q=${encodeURIComponent(query)}`
  ];
  let lastError;
  let hadSearchResponse = false;
  for (const searchUrl of urls) {
    try {
      const response = await requestText(searchUrl, options);
      hadSearchResponse = true;
      const rows = parseBingEbayResults(response.body, {
        sourceKeyword: keyword,
        input,
        scrapedAt: options.scrapedAt,
        startPosition: options.startPosition ?? 1
      });
      if (rows.length) return rows;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError && !hadSearchResponse) {
    options.logger?.warning?.('Public search fallback failed for eBay keyword.', {
      keyword,
      error: lastError.message
    });
  }
  return [];
}

export function parseBingEbayResults(html, context = {}) {
  const $ = cheerio.load(html);
  const rows = [];
  $('li.b_algo').each((index, element) => {
    const link = $(element).find('h2 a[href]').first();
    const url = cleanEbayItemUrl(unwrapSearchUrl(link.attr('href')));
    if (!url || !getHostname(url).includes('ebay.')) return;
    const title = cleanText(link.text());
    const snippet = cleanText($(element).find('.b_caption p, p').first().text());
    const money = parseMoney(`${title} ${snippet}`);
    rows.push({
      productTitle: title.replace(/\s*\|\s*eBay.*$/i, ''),
      productUrl: url,
      itemId: extractItemId(url),
      price: money.amount,
      currency: money.currency,
      shippingPrice: null,
      condition: null,
      imageUrl: null,
      sellerName: null,
      sellerUrl: null,
      sellerRating: null,
      sellerFeedbackPercent: null,
      storeName: null,
      storeUrl: null,
      soldCount: context.input?.includeSoldCount === false ? null : parseSoldCount(snippet),
      itemLocation: null,
      listingType: inferListingType(snippet),
      sourceKeyword: context.sourceKeyword ?? null,
      rankingPosition: (context.startPosition ?? 1) + index,
      scrapedAt: context.scrapedAt
    });
  });
  $('a[href*="ebay."][href*="/itm/"]').each((index, element) => {
    const url = cleanEbayItemUrl(unwrapSearchUrl($(element).attr('href')));
    if (!url || !getHostname(url).includes('ebay.')) return;
    const container = $(element).closest('.result-content, article, section, div');
    const title = cleanEbayFallbackTitle(
      cleanText(container.find('.search-snippet-title').first().attr('title'))
      || cleanText(container.find('.search-snippet-title').first().text())
      || cleanText($(element).text())
    );
    const snippet = cleanText(container.text()).slice(0, 600);
    const money = parseSearchPrice(snippet);
    rows.push({
      productTitle: title || snippet.split('. ')[0],
      productUrl: url,
      itemId: extractItemId(url),
      price: money.amount,
      currency: money.currency,
      shippingPrice: null,
      condition: null,
      imageUrl: null,
      sellerName: null,
      sellerUrl: null,
      sellerRating: null,
      sellerFeedbackPercent: null,
      storeName: null,
      storeUrl: null,
      soldCount: context.input?.includeSoldCount === false ? null : parseSoldCount(snippet),
      itemLocation: null,
      listingType: inferListingType(snippet),
      sourceKeyword: context.sourceKeyword ?? null,
      rankingPosition: (context.startPosition ?? 1) + index,
      scrapedAt: context.scrapedAt
    });
  });
  return deduplicateBy(rows, (row) => row.itemId || normalizeUrlForKey(row.productUrl));
}

export async function requestText(url, options = {}) {
  const {
    proxyConfiguration = null,
    maxRetries = DEFAULT_INPUT.maxRetries,
    requestTimeoutSecs = DEFAULT_INPUT.requestTimeoutSecs,
    logger = console
  } = options;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
      const response = await gotScraping({
        url,
        proxyUrl,
        responseType: 'text',
        throwHttpErrors: false,
        timeout: { request: requestTimeoutSecs * 1000 },
        retry: { limit: 0 },
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          referer: EBAY_ORIGIN
        }
      });
      if (response.statusCode >= 200 && response.statusCode < 400) {
        return { body: response.body, url: response.url, statusCode: response.statusCode, headers: response.headers };
      }
      lastError = new Error(`HTTP ${response.statusCode} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxRetries) {
      logger.debug?.(`Request failed, retrying: ${lastError.message}`);
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastError;
}

function rowsOffset(context) {
  return Number.isInteger(context.cardIndex) ? context.cardIndex : 0;
}

function filterByPrice(rows, input) {
  return rows.filter((row) => {
    if (input.minPrice != null && row.price != null && row.price < input.minPrice) return false;
    if (input.maxPrice != null && row.price != null && row.price > input.maxPrice) return false;
    return true;
  });
}

function parseMoney(value) {
  const text = String(value ?? '');
  const amount = toNullableNumber(text.match(/(\d[\d,]*(?:\.\d{1,2})?)/)?.[1]);
  let currency = null;
  if (/\$|US\s*\$/i.test(text)) currency = 'USD';
  if (/€|EUR/i.test(text)) currency = 'EUR';
  if (/£|GBP/i.test(text)) currency = 'GBP';
  return { amount, currency };
}

function parseSearchPrice(value) {
  const text = String(value ?? '');
  const explicit = text.match(/Price\s*[$€£]?\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
  if (explicit) {
    const prefix = text.slice(Math.max(0, explicit.index - 8), explicit.index + explicit[0].length);
    const currency = /\$|US\s*\$/i.test(prefix) ? 'USD' : /€|EUR/i.test(prefix) ? 'EUR' : /£|GBP/i.test(prefix) ? 'GBP' : null;
    return { amount: toNullableNumber(explicit[1]), currency };
  }
  return parseMoney(text);
}

function cleanEbayFallbackTitle(value) {
  const text = cleanText(value).replace(/â€º/g, '›').replace(/\s*\|\s*eBay.*$/i, '');
  const titleAttribute = text.match(/title="([^"]+)"/i)?.[1];
  const source = titleAttribute || text;
  const parts = source.split(/\s+›\s+/).map(cleanText).filter(Boolean);
  return (parts.at(-1) || source)
    .replace(/^eBay\s+/i, '')
    .replace(/^other vintage cameras\s+/i, '')
    .replace(/^vintage cameras\s+/i, '')
    .trim();
}

function parseSellerText(value) {
  const text = cleanText(value);
  const percent = toNullableNumber(text.match(/(\d+(?:\.\d+)?)%\s+positive/i)?.[1]);
  const rating = toNullableInteger(text.match(/\(([\d,]+)\)/)?.[1]);
  const name = cleanText(text.replace(/\([^)]*\)/g, '').replace(/\d+(?:\.\d+)?%\s+positive/ig, '')) || null;
  return { name, url: name ? `${EBAY_ORIGIN}/usr/${encodeURIComponent(name)}` : null, rating, feedbackPercent: percent };
}

function parseSoldCount(text) {
  return toNullableInteger(text.match(/(\d[\d,]*)\s+sold/i)?.[1]);
}

function inferListingType(text) {
  if (/auction/i.test(text)) return 'Auction';
  if (/buy it now/i.test(text)) return 'Buy It Now';
  if (/best offer/i.test(text)) return 'Best Offer';
  return null;
}

function cleanEbayItemUrl(href) {
  const absolute = toAbsoluteUrl(href, EBAY_ORIGIN);
  if (!absolute) return null;
  try {
    const url = new URL(absolute);
    const itemId = extractItemId(url.toString());
    if (itemId) return `${url.origin}/itm/${itemId}`;
    url.hash = '';
    return url.toString();
  } catch {
    return absolute;
  }
}

function unwrapSearchUrl(href) {
  if (!href) return null;
  const absolute = toAbsoluteUrl(href, 'https://www.bing.com/');
  try {
    const url = new URL(absolute);
    const clickUrl = url.searchParams.get('click_url');
    if (clickUrl) return clickUrl;
    const encoded = url.searchParams.get('u');
    if (encoded?.startsWith('a1')) {
      return Buffer.from(encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    }
    return absolute;
  } catch {
    return href;
  }
}

function extractItemId(url) {
  return String(url ?? '').match(/\/itm\/(?:[^/?#]+\/)?(\d{9,})/i)?.[1]
    ?? String(url ?? '').match(/[?&]itm=(\d{9,})/i)?.[1]
    ?? null;
}

function normalizeImageUrl(url) {
  if (!url || /gif\/1x1|s-l64/i.test(url)) return null;
  return trimUrl(url.replace(/\/s-l\d+\./, '/s-l500.'));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function normalizeUrlArray(value) {
  return normalizeStringArray(value).filter(isHttpUrl);
}

function toBoundedInteger(value, min, max, fallback, fieldName) {
  const number = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`Input "${fieldName}" must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function toOptionalNumber(value, fieldName) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Input "${fieldName}" must be a positive number.`);
  }
  return number;
}

function toNullableNumber(value) {
  const number = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function toNullableInteger(value) {
  const number = Number.parseInt(String(value ?? '').replace(/,/g, ''), 10);
  return Number.isInteger(number) ? number : null;
}

function deduplicateBy(rows, keyFactory) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const key = keyFactory(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function toAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeUrlForKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return String(url ?? '').toLowerCase();
  }
}

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function trimUrl(value) {
  return String(value).replace(/[),.;]+$/, '');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? ''));
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
