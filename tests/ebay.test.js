import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSearchUrl,
  normalizeInput,
  parseCard,
  parseItemPage,
  parseSearchPage
} from '../src/ebay.js';
import * as cheerio from 'cheerio';

test('normalizeInput requires keywords or search URLs and validates price range', () => {
  assert.throws(() => normalizeInput({}), /keyword/);
  assert.throws(() => normalizeInput({ keywords: ['camera'], minPrice: 100, maxPrice: 10 }), /maxPrice/);
  const input = normalizeInput({ keywords: [' vintage camera '], maxResults: 5 });
  assert.deepEqual(input.keywords, ['vintage camera']);
  assert.equal(input.maxResults, 5);
});

test('buildSearchUrl creates a public eBay search URL with filters', () => {
  const url = buildSearchUrl('vintage camera', { minPrice: 20, maxPrice: 500, condition: 'used' });
  assert.match(url, /^https:\/\/www\.ebay\.com\/sch\/i\.html/);
  assert.match(url, /_nkw=vintage\+camera/);
  assert.match(url, /_udlo=20/);
  assert.match(url, /_udhi=500/);
  assert.match(url, /LH_ItemCondition=3000/);
});

test('parseCard extracts product and seller fields from eBay result card', () => {
  const html = `
    <li class="s-item">
      <a class="s-item__link" href="https://www.ebay.com/itm/Vintage-Camera/123456789012?hash=x">View</a>
      <div class="s-item__title">New Listing Vintage 35mm Film Camera</div>
      <span class="s-item__price">$89.99</span>
      <span class="s-item__shipping">+$8.95 shipping</span>
      <span class="SECONDARY_INFO">Used</span>
      <img class="s-item__image-img" src="https://i.ebayimg.com/images/g/example/s-l300.jpg" />
      <span class="s-item__seller-info-text">camera-store (12,450) 99.7% positive</span>
      <span class="s-item__location">from United States</span>
      <span>42 sold Buy It Now</span>
    </li>
  `;
  const $ = cheerio.load(html);
  const row = parseCard($, $('.s-item').first(), {
    input: normalizeInput({ keywords: ['camera'] }),
    sourceKeyword: 'camera',
    scrapedAt: '2026-05-30T12:00:00.000Z',
    startPosition: 1
  });
  assert.equal(row.productTitle, 'Vintage 35mm Film Camera');
  assert.equal(row.productUrl, 'https://www.ebay.com/itm/123456789012');
  assert.equal(row.itemId, '123456789012');
  assert.equal(row.price, 89.99);
  assert.equal(row.currency, 'USD');
  assert.equal(row.shippingPrice, 8.95);
  assert.equal(row.sellerName, 'camera-store');
  assert.equal(row.sellerRating, 12450);
  assert.equal(row.sellerFeedbackPercent, 99.7);
  assert.equal(row.soldCount, 42);
  assert.equal(row.itemLocation, 'United States');
});

test('parseSearchPage skips eBay placeholder cards', () => {
  const html = `
    <ul>
      <li class="s-item"><div class="s-item__title">Shop on eBay</div><a class="s-item__link" href="https://www.ebay.com/itm/111111111111"></a></li>
      <li class="s-item"><div class="s-item__title">Vintage Camera</div><a class="s-item__link" href="https://www.ebay.com/itm/123456789012"></a><span class="s-item__price">$50.00</span></li>
    </ul>
  `;
  const rows = parseSearchPage(html, {
    input: normalizeInput({ keywords: ['camera'] }),
    scrapedAt: '2026-05-30T12:00:00.000Z',
    startPosition: 1
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].productTitle, 'Vintage Camera');
});

test('parseItemPage extracts visible seller/store details', () => {
  const html = `
    <html><body>
      <a href="/usr/camera-store">camera-store</a>
      <a href="/str/camerastore">Camera Store</a>
      <p>12,450 feedback 99.7% positive 42 sold</p>
    </body></html>
  `;
  const data = parseItemPage(html, 'https://www.ebay.com/itm/123456789012');
  assert.equal(data.sellerName, 'camera-store');
  assert.equal(data.sellerUrl, 'https://www.ebay.com/usr/camera-store');
  assert.equal(data.storeName, 'Camera Store');
  assert.equal(data.storeUrl, 'https://www.ebay.com/str/camerastore');
  assert.equal(data.sellerRating, 12450);
  assert.equal(data.sellerFeedbackPercent, 99.7);
  assert.equal(data.soldCount, 42);
});
