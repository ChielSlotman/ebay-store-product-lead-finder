# eBay Store and Product Lead Finder

Extract public eBay product listings, seller/store information, prices, product URLs, images, ratings, sold counts, item locations, and listing metadata from eBay keywords or search/category URLs.

Best for ecommerce sellers, product researchers, agencies, dropshipping researchers, price monitoring teams, and automation builders who need clean public eBay data without manual copying.

## What this Actor does

eBay Store and Product Lead Finder collects public product and seller/store data from eBay search result pages. Users can enter keywords or direct eBay search/category URLs and receive structured rows that are ready for spreadsheets, dashboards, APIs, and competitor research workflows.

The Actor is focused on public ecommerce research. It does not log in, scrape private buyer data, access private messages, collect payment data, or bypass restricted areas.

## Why use it

Manual eBay research is slow and inconsistent. This Actor turns product searches into clean datasets with product, price, seller, sold count, image, and ranking fields so you can compare listings and sellers faster.

## Who it is for

- Ecommerce sellers
- Market researchers
- Competitor tracking teams
- Dropshipping researchers
- eBay seller researchers
- Price monitoring teams
- Product research teams
- Agencies
- Automation builders using Apify, Make, Zapier, n8n, Google Sheets, or APIs

## Use cases

- Research products by keyword
- Track competitor product listings
- Discover public seller/store leads
- Compare prices and shipping costs
- Monitor visible sold counts
- Build ecommerce research datasets
- Export public eBay listings to CSV, JSON, Excel, or API workflows

## Input

- `keywords` - eBay product search keywords
- `searchUrls` - direct public eBay search/category URLs
- `maxResults` - maximum product results to return
- `includeSellerInfo` - include seller/store fields when visible
- `includeImages` - include product image URLs
- `includeShipping` - include visible shipping prices/details
- `includeSoldCount` - include sold count when visible
- `minPrice` - optional minimum price
- `maxPrice` - optional maximum price
- `condition` - optional condition hint such as new or used
- `location` - optional location hint
- `deduplicateResults` - remove duplicate items
- `proxyConfiguration` - optional Apify proxy support
- `debugMode` - save extra debugging data

## Output

Each dataset item can include:

- `productTitle`
- `productUrl`
- `itemId`
- `price`
- `currency`
- `shippingPrice`
- `condition`
- `imageUrl`
- `sellerName`
- `sellerUrl`
- `sellerRating`
- `sellerFeedbackPercent`
- `storeName`
- `storeUrl`
- `soldCount`
- `itemLocation`
- `listingType`
- `sourceKeyword`
- `rankingPosition`
- `scrapedAt`

## Example input

```json
{
  "keywords": ["vintage camera", "wireless headphones"],
  "maxResults": 50,
  "includeSellerInfo": true,
  "includeImages": true,
  "includeShipping": true,
  "includeSoldCount": true,
  "minPrice": 20,
  "maxPrice": 500,
  "condition": "used",
  "deduplicateResults": true,
  "proxyConfiguration": {
    "useApifyProxy": true
  }
}
```

## Example output

```json
{
  "productTitle": "Vintage 35mm Film Camera with Lens",
  "productUrl": "https://www.ebay.com/itm/123456789012",
  "itemId": "123456789012",
  "price": 89.99,
  "currency": "USD",
  "shippingPrice": 8.95,
  "condition": "Used",
  "imageUrl": "https://i.ebayimg.com/images/example.jpg",
  "sellerName": "example-camera-store",
  "sellerUrl": "https://www.ebay.com/usr/example-camera-store",
  "sellerRating": 12450,
  "sellerFeedbackPercent": 99.7,
  "storeName": "Example Camera Store",
  "storeUrl": "https://www.ebay.com/str/examplecamerastore",
  "soldCount": 42,
  "itemLocation": "United States",
  "listingType": "Buy It Now",
  "sourceKeyword": "vintage camera",
  "rankingPosition": 1,
  "scrapedAt": "2026-05-30T12:00:00.000Z"
}
```

## How to run

1. Open the Actor on Apify.
2. Enter eBay product keywords or direct public search/category URLs.
3. Set result limits and optional filters.
4. Run the Actor.
5. Export the dataset from Apify.

## Export and integrations

Export results as CSV, JSON, JSONL, XML, RSS, or Excel. Use Apify integrations to connect the output to Make, Zapier, n8n, Google Sheets, webhooks, or a custom API pipeline.

## API usage

Start a run with the Apify API:

```bash
curl "https://api.apify.com/v2/acts/esrok~ebay-store-product-lead-finder/runs?token=YOUR_APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"keywords":["vintage camera"],"maxResults":25,"includeSellerInfo":true}'
```

Fetch dataset items:

```bash
curl "https://api.apify.com/v2/datasets/DATASET_ID/items?format=json&clean=true&token=YOUR_APIFY_TOKEN"
```

## Responsible use

Use this Actor only for lawful public ecommerce research. Do not use it to collect private buyer data, scrape private messages, collect payment data, bypass logins, or violate eBay terms.

## Limitations

- eBay page structure and visible fields can vary by region, query, and listing type.
- Sold counts and seller/store data are returned only when publicly visible.
- The Actor does not access login-only data.
- Public pages that block automated traffic may require proxy settings or may not return results.

## FAQ

### Does this scrape private buyer information?

No. It only extracts publicly visible product and seller/store information.

### Can it collect sold counts?

Yes, when the sold count is publicly visible on the page.

### Can I use direct eBay category URLs?

Yes. Add public eBay search or category URLs in `searchUrls`.

### Does it support price filters?

Yes. You can provide `minPrice` and `maxPrice`; keyword searches also pass those filters to eBay search URLs.

## Pricing

This Actor is designed for simple pay-per-result pricing. A practical launch price is around $4.00 per 1,000 public product or seller records, with final pricing shown on the Apify Store page.
