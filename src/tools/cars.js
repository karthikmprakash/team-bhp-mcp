'use strict';

const { z } = require('zod');
const { BASE_URL } = require('../config/constants.js');
const { toolResult } = require('../app/tool-result.js');
const { withCache } = require('../infra/cache.js');
const { fetchPage, fetchRendered } = require('../infra/fetch.js');
const { parseCarListing } = require('../parsers/cars.js');

function registerGetNewCarsTool(server) {
  server.tool(
    'get_new_cars',
    'Browse the Team-BHP New Car Finder catalog — all current new cars in India, or upcoming launches.',
    {
      type: z
        .enum(['all', 'upcoming'])
        .optional()
        .default('all')
        .describe('"all" for current cars on sale, "upcoming" for upcoming launches'),
    },
    async ({ type }) => {
      const url =
        type === 'upcoming'
          ? `${BASE_URL}/new-cars/search-by/upcoming-cars/`
          : `${BASE_URL}/new-cars/search-by/all-cars/`;
      return toolResult(
        await withCache(`new_cars:${type}`, 1_800_000, async () => {
          const cars = parseCarListing(await fetchPage(url));
          return { type, car_count: cars.length, cars };
        })
      );
    }
  );
}

function registerGetCarsByBrandTool(server) {
  server.tool(
    'get_cars_by_brand',
    'List all car models for a given brand from the Team-BHP New Car Finder (e.g. "tata", "hyundai", "maruti-suzuki", "mahindra", "toyota", "kia").',
    {
      brand: z
        .string()
        .describe('Brand slug, e.g. "tata", "hyundai", "maruti-suzuki", "mahindra", "toyota"'),
    },
    async ({ brand }) => {
      const slug = brand.toLowerCase().replace(/\s+/g, '-');
      const url = `${BASE_URL}/new-cars/${slug}/`;
      return toolResult(
        await withCache(`cars_by_brand:${slug}`, 1_800_000, async () => {
          const cars = parseCarListing(await fetchPage(url)).filter((c) => c.brand === slug);
          return { brand: slug, model_count: cars.length, models: cars };
        })
      );
    }
  );
}

function registerGetCarDetailsTool(server) {
  server.tool(
    'get_car_details',
    'Get details for a specific new car — price range, overview, and variant-wise ex-showroom prices. Provide brand + model slugs or the full New Car Finder URL.',
    {
      brand: z.string().optional().describe('Brand slug, e.g. "tata" (omit if passing url)'),
      model: z.string().optional().describe('Model slug, e.g. "nexon" (omit if passing url)'),
      url: z.string().optional().describe('Full car URL (alternative to brand+model)'),
    },
    async ({ brand, model, url }) => {
      let carUrl = url;
      if (!carUrl) {
        if (!brand || !model) {
          throw new Error('Provide either a full url, or both brand and model slugs.');
        }
        carUrl = `${BASE_URL}/new-cars/${brand.toLowerCase()}/${model.toLowerCase()}/`;
      }
      // Client-side rendered — extract from the live DOM. Returns the instant the
      // price range text renders (instead of a flat 3.8s wait).
      const data = await withCache(`car_details:${carUrl}`, 1_800_000, async () =>
        fetchRendered(carUrl, {
        waitForFn: () => /₹[\d.]+\s*L?\s*-\s*[\d.]+/.test(document.body.innerText),
        evaluate: () => {
          const lines = document.body.innerText
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          const priceRange = lines.find((l) => /₹[\d.]+\s*L?\s*-\s*[\d.]+\s*L?/.test(l)) || null;
          const overview = lines.find((l) => l.length > 120) || null;
          // ex-showroom variant prices (de-duped, comparison "Pay ₹X more" excluded)
          const variantPrices = [];
          lines.forEach((l) => {
            const m = l.match(/^₹([\d.]+)\s*Lakh$/);
            if (m) variantPrices.push('₹' + m[1] + ' Lakh');
          });
          return {
            name: (document.querySelector('h1') || {}).innerText?.replace(/\n/g, ' ').trim() || null,
            price_range: priceRange,
            overview: overview ? overview.slice(0, 600) : null,
            variant_prices: variantPrices,
          };
        },
        }).then((d) => ({ url: carUrl, ...d }))
      );
      return toolResult(data);
    }
  );
}

module.exports = {
  registerGetNewCarsTool,
  registerGetCarsByBrandTool,
  registerGetCarDetailsTool,
};
