import { Actor, log } from 'apify';
import {
  findEbayLeads,
  normalizeInput
} from './ebay.js';

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput() ?? {});
  log.info('Starting public eBay product and seller lead extraction.', {
    keywords: input.keywords.length,
    searchUrls: input.searchUrls.length,
    maxResults: input.maxResults
  });

  const proxyConfiguration = input.proxyConfiguration
    ? await Actor.createProxyConfiguration(input.proxyConfiguration)
    : null;

  const results = await findEbayLeads(input, {
    proxyConfiguration,
    logger: log,
    status: (message) => Actor.setStatusMessage(message)
  });

  if (results.length) {
    await Actor.pushData(results);
  }

  await Actor.setValue('RUN_SUMMARY', {
    requestedKeywords: input.keywords.length,
    requestedSearchUrls: input.searchUrls.length,
    results: results.length,
    note: results.length
      ? 'Saved public eBay product and seller lead records.'
      : 'No public eBay product results were found for the provided input.'
  });

  await Actor.setStatusMessage(`Saved ${results.length} eBay product and seller records.`);
  log.info('Finished eBay product and seller extraction.', { results: results.length });
  await Actor.exit();
} catch (error) {
  log.exception(error, 'Actor failed.');
  await Actor.setStatusMessage(`Run failed: ${error.message}`);
  await Actor.fail(error.message);
}
