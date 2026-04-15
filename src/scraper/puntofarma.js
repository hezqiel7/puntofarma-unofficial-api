const { request } = require("playwright");

const BASE_URL = "https://www.puntofarma.com.py";
const SITEMAP_URL = `${BASE_URL}/sitemap.xml`;

function parseSitemap(xml) {
  const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());
  return [...new Set(matches.filter((url) => /\/producto\/\d+\//.test(url)))];
}

async function getProductUrlsFromSitemap() {
  const api = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  });

  try {
    const response = await api.get(SITEMAP_URL, { timeout: 120000 });
    if (!response.ok()) {
      throw new Error(`No se pudo descargar sitemap: HTTP ${response.status()}`);
    }
    const xml = await response.text();
    return parseSitemap(xml);
  } finally {
    await api.dispose();
  }
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function createApiContext() {
  return request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    },
    locale: "es-PY"
  });
}

function getProductIdFromUrl(url) {
  return String(url || "").match(/\/producto\/(\d+)\//)?.[1] || null;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : value;
}

function parsePyg(value) {
  if (!value) return null;
  const digits = String(value).replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseJsonLdBlocks(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1].trim()
  );

  const items = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block);
      if (Array.isArray(parsed)) {
        items.push(...parsed);
      } else if (parsed?.["@graph"] && Array.isArray(parsed["@graph"])) {
        items.push(...parsed["@graph"]);
      } else if (parsed) {
        items.push(parsed);
      }
    } catch {
      continue;
    }
  }

  return items;
}

function extractMetaContent(html, key) {
  const escaped = escapeRegex(key);

  const patterns = [
    new RegExp(`<meta[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function extractCanonical(html) {
  const match = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  return match?.[1] || null;
}

function extractTextPrice(source, label, maxWindow = 220) {
  const pattern = new RegExp(`${escapeRegex(label)}[\\s\\S]{0,${maxWindow}}?Gs\\.\\s*([\\d.]+)`, "i");
  const match = source.match(pattern);
  const amount = parsePyg(match?.[1] || null);
  return amount;
}

function extractDiscountPercent(source) {
  const match = source.match(/-?\s*(\d+)\s*%\s*de descuento/i);
  return Number(match?.[1] || 0) || null;
}

function extractCodeAndGtin(source) {
  const code = source.match(/C[o\u00F3]digo:\s*(\d+)/i)?.[1] || null;
  const gtin = source.match(/C[o\u00F3]digo:\s*\d+\s*(\d{8,14})/i)?.[1] || null;
  return { code, gtin };
}

function buildProductFromHtml(html, url, options = {}) {
  const { includeRaw = false } = options;

  const ldData = parseJsonLdBlocks(html);
  const productLd = ldData.find((item) => item?.["@type"] === "Product") || null;
  const breadcrumbLd = ldData.find((item) => item?.["@type"] === "BreadcrumbList") || null;

  const bodySource = html
    .replace(/\r?\n/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const { code, gtin } = extractCodeAndGtin(bodySource);
  const skuFromUrl = url.match(/\/producto\/(\d+)\//)?.[1] || null;

  const regularPrice = parsePyg(productLd?.offers?.price) || extractTextPrice(bodySource, "Regular") || null;
  const discountedPrice = extractTextPrice(bodySource, "Con descuento");
  const itauPrice = extractTextPrice(bodySource, "Con Itau QR Debito", 260);

  const priceOptions = [];
  if (regularPrice) {
    priceOptions.push({
      label: "Regular",
      amount: regularPrice,
      displayAmount: `Gs. ${regularPrice.toLocaleString("es-PY")}`,
      currency: "PYG",
      note: null
    });
  }
  if (discountedPrice) {
    priceOptions.push({
      label: "Con descuento",
      amount: discountedPrice,
      displayAmount: `Gs. ${discountedPrice.toLocaleString("es-PY")}`,
      currency: "PYG",
      note: null
    });
  }
  if (itauPrice) {
    priceOptions.push({
      label: "Con Itau QR Debito",
      amount: itauPrice,
      displayAmount: `Gs. ${itauPrice.toLocaleString("es-PY")}`,
      currency: "PYG",
      note: null
    });
  }

  const discountPercent = extractDiscountPercent(bodySource);
  const hasDiscount =
    Boolean(discountPercent) ||
    (discountedPrice !== null && regularPrice !== null && discountedPrice < regularPrice);

  const breadcrumbItems = (breadcrumbLd?.itemListElement || [])
    .map((item) => ({
      name: clean(item?.name || ""),
      url: item?.item ? normalizeUrl(item.item) : null
    }))
    .filter((item) => item.name && item.name.toLowerCase() !== "inicio")
    .map((item) => ({
      ...item,
      name: item.name.replace(/^\.{3}/, "").trim()
    }));

  const categoryPath = breadcrumbItems.map((item) => item.name);

  const title =
    clean(productLd?.name) ||
    clean(extractMetaContent(html, "og:title")) ||
    clean(html.match(/<title>(.*?)<\/title>/i)?.[1]?.replace(/\s*\|\s*Punto Farma$/i, "")) ||
    null;

  const description =
    clean(productLd?.description) || clean(extractMetaContent(html, "description")) || null;

  const image =
    clean(productLd?.image) || clean(extractMetaContent(html, "og:image")) || null;

  const canonical =
    normalizeUrl(productLd?.url || extractCanonical(html) || url);

  const sku = String(productLd?.sku || code || skuFromUrl || "").trim() || null;

  return {
    id: sku ? Number(sku) || null : null,
    sku,
    gtin: clean(productLd?.gtin) || gtin || null,
    title,
    description,
    url: canonical,
    image,
    brand: clean(productLd?.brand?.name) || null,
    availability: clean(productLd?.offers?.availability) || null,
    priceCurrency: clean(productLd?.offers?.priceCurrency) || "PYG",
    prices: {
      regular: regularPrice,
      discounted: discountedPrice,
      options: priceOptions
    },
    hasDiscount,
    discountPercent,
    categories: {
      category: categoryPath[0] || null,
      subcategory: categoryPath[1] || null,
      path: categoryPath,
      breadcrumbs: breadcrumbItems
    },
    ...(includeRaw
      ? {
          raw: {
            productSchema: productLd,
            breadcrumbSchema: breadcrumbLd
          }
        }
      : {}),
    scrapedAt: new Date().toISOString()
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeProductFromUrl(api, url, options = {}) {
  const { retryAttempts = 2, includeRaw = false } = options;
  let lastError = null;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const response = await api.get(url, { timeout: 45000 });

      if (!response.ok()) {
        if (response.status() === 404) {
          throw new Error("No se pudo obtener producto: HTTP 404");
        }
        throw new Error(`No se pudo obtener producto: HTTP ${response.status()}`);
      }

      const html = await response.text();
      return buildProductFromHtml(html, url, { includeRaw });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const noRetry = /HTTP 404/.test(message);
      if (noRetry || attempt >= retryAttempts) {
        break;
      }
      await wait(200 * attempt);
    }
  }

  throw lastError || new Error("Error desconocido al scrapear producto");
}

async function scrapeAllProducts(options = {}) {
  const {
    maxProducts = null,
    concurrency = 24,
    onProgress = null,
    existingProducts = [],
    existingErrors = [],
    skipKnown = false,
    skipKnownFailures = false,
    retryAttempts = 2,
    includeRaw = false,
    apiResetEvery = 500
  } = options;

  const allUrls = await getProductUrlsFromSitemap();
  const targetUrls = Number.isInteger(maxProducts) ? allUrls.slice(0, maxProducts) : allUrls;

  const existingByUrl = new Map();
  const existingById = new Map();
  const knownFailedUrls = new Set();

  if (skipKnown && Array.isArray(existingProducts)) {
    for (const product of existingProducts) {
      if (product?.url) {
        existingByUrl.set(normalizeUrl(product.url), product);
      }
      const id = String(product?.id || product?.sku || "").trim();
      if (id) {
        existingById.set(id, product);
      }
    }
  }

  if (skipKnown && skipKnownFailures && Array.isArray(existingErrors)) {
    for (const error of existingErrors) {
      if (!error?.url) continue;
      knownFailedUrls.add(normalizeUrl(error.url));
    }
  }

  const preserved = [];
  let preservedFailedUrls = 0;
  const urlsToFetch = [];
  for (const url of targetUrls) {
    const normalized = normalizeUrl(url);
    if (skipKnown && skipKnownFailures && knownFailedUrls.has(normalized)) {
      preservedFailedUrls += 1;
      continue;
    }

    const idFromUrl = getProductIdFromUrl(url);
    const known =
      (skipKnown && existingByUrl.get(normalized)) ||
      (skipKnown && idFromUrl ? existingById.get(idFromUrl) : null) ||
      null;

    if (known) {
      preserved.push(known);
    } else {
      urlsToFetch.push(url);
    }
  }

  const fetched = [];
  const errors = [];
  let nextIndex = 0;
  let finished = 0;
  const totalWork = urlsToFetch.length;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    let api = await createApiContext();
    let requestsInContext = 0;

    try {
      while (nextIndex < urlsToFetch.length) {
        if (requestsInContext >= apiResetEvery) {
          await api.dispose();
          api = await createApiContext();
          requestsInContext = 0;
        }

        const index = nextIndex;
        nextIndex += 1;

        const url = urlsToFetch[index];
        try {
          const product = await scrapeProductFromUrl(api, url, {
            retryAttempts,
            includeRaw
          });
          fetched.push(product);
        } catch (error) {
          errors.push({
            url,
            message: error instanceof Error ? error.message : String(error)
          });
        }

        requestsInContext += 1;
        finished += 1;
        if (typeof onProgress === "function") {
          onProgress({ finished, total: totalWork, url });
        }
      }
    } finally {
      await api.dispose();
    }
  });

  await Promise.all(workers);

  const mergedByKey = new Map();

  for (const product of [...preserved, ...fetched]) {
    const key = product?.url ? normalizeUrl(product.url) : product?.sku || product?.id || Math.random();
    mergedByKey.set(key, product);
  }

  const products = [...mergedByKey.values()].sort((a, b) => {
    const left = a?.id || 0;
    const right = b?.id || 0;
    return left - right;
  });

  return {
    totalUrls: allUrls.length,
    requestedUrls: targetUrls.length,
    fetchedUrls: urlsToFetch.length,
    preservedUrls: preserved.length,
    preservedFailedUrls,
    scraped: products.length,
    failed: errors.length,
    products,
    errors
  };
}

module.exports = {
  BASE_URL,
  SITEMAP_URL,
  getProductUrlsFromSitemap,
  scrapeProductFromPage: scrapeProductFromUrl,
  scrapeAllProducts
};
