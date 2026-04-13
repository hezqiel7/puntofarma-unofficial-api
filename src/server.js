const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");

const { scrapeAllProducts } = require("./scraper/puntofarma");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "products.json");
const SEED_FILE = path.join(process.cwd(), "seed", "products.json");
const PUBLIC_DIR = path.join(process.cwd(), "public");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));

const state = {
  products: [],
  meta: {
    updatedAt: null,
    total: 0,
    failed: 0,
    sourceTotal: 0
  },
  errors: [],
  syncInProgress: false,
  syncStartedAt: null
};

let hasLoadedData = false;
let dataLoadPromise = null;

async function loadStoredData() {
  const candidates = [DATA_FILE, SEED_FILE];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const parsed = JSON.parse(raw);

      state.products = Array.isArray(parsed.products) ? parsed.products : [];
      state.errors = Array.isArray(parsed.errors) ? parsed.errors : [];
      state.meta = {
        updatedAt: parsed.meta?.updatedAt || null,
        total: Number(parsed.meta?.total || state.products.length),
        failed: Number(parsed.meta?.failed || 0),
        sourceTotal: Number(parsed.meta?.sourceTotal || 0)
      };

      return;
    } catch {
      continue;
    }
  }

  state.products = [];
  state.errors = [];
}

async function ensureDataLoaded() {
  if (hasLoadedData) return;
  if (!dataLoadPromise) {
    dataLoadPromise = loadStoredData()
      .then(() => {
        hasLoadedData = true;
      })
      .finally(() => {
        dataLoadPromise = null;
      });
  }
  await dataLoadPromise;
}

async function storeData() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const payload = {
    meta: state.meta,
    products: state.products,
    errors: state.errors
  };

  await fs.writeFile(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
  hasLoadedData = true;
}

function parsePositiveInt(value, fallback = null) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

function parsePositiveNumber(value, fallback = null) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return num;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "si", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function mergeErrors(existingErrors, newErrors, products) {
  const knownProductUrls = new Set(
    (products || []).map((product) => product?.url).filter(Boolean)
  );

  const merged = new Map();
  for (const error of [...(existingErrors || []), ...(newErrors || [])]) {
    if (!error?.url) continue;
    const key = error.url;
    if (knownProductUrls.has(key)) {
      merged.delete(key);
      continue;
    }
    merged.set(key, error);
  }

  return [...merged.values()];
}

async function runSync({ maxProducts = null, concurrency = 40, full = false } = {}) {
  if (state.syncInProgress) {
    const message = "Ya hay una sincronizacion en curso";
    const error = new Error(message);
    error.statusCode = 409;
    throw error;
  }

  state.syncInProgress = true;
  state.syncStartedAt = new Date().toISOString();

  try {
    const result = await scrapeAllProducts({
      maxProducts,
      concurrency,
      existingProducts: state.products,
      existingErrors: state.errors,
      skipKnown: !full,
      skipKnownFailures: !full,
      retryAttempts: 2,
      onProgress: ({ finished, total, url }) => {
        if (finished % 100 === 0 || finished === total) {
          console.log(`[SYNC] ${finished}/${total} | ${url}`);
        }
      }
    });

    state.products = result.products;
    state.errors = full
      ? result.errors
      : mergeErrors(state.errors, result.errors, result.products);
    state.meta = {
      updatedAt: new Date().toISOString(),
      total: result.scraped,
      failed: state.errors.length,
      sourceTotal: result.totalUrls
    };

    await storeData();

    return {
      message: "Sincronizacion completada",
      mode: full ? "full" : "incremental",
      requested: result.requestedUrls,
      fetched: result.fetchedUrls,
      preserved: result.preservedUrls,
      skippedKnownFailures: result.preservedFailedUrls,
      scraped: result.scraped,
      failed: state.errors.length,
      newFailed: result.failed,
      sourceTotal: result.totalUrls,
      updatedAt: state.meta.updatedAt
    };
  } finally {
    state.syncInProgress = false;
    state.syncStartedAt = null;
  }
}

app.use(async (_req, _res, next) => {
  try {
    await ensureDataLoaded();
    next();
  } catch (error) {
    next(error);
  }
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    syncInProgress: state.syncInProgress,
    syncStartedAt: state.syncStartedAt,
    productsLoaded: state.products.length,
    updatedAt: state.meta.updatedAt
  });
});

app.get("/meta", (_req, res) => {
  res.json({
    ...state.meta,
    syncInProgress: state.syncInProgress,
    syncStartedAt: state.syncStartedAt,
    dataFile: DATA_FILE
  });
});

app.get("/categories", (_req, res) => {
  const categoryMap = new Map();

  for (const product of state.products) {
    const category = product?.categories?.category;
    if (!category) continue;

    const entry = categoryMap.get(category) || new Set();
    const subcategory = product?.categories?.subcategory;
    if (subcategory) entry.add(subcategory);
    categoryMap.set(category, entry);
  }

  const data = [...categoryMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([category, subcategories]) => ({
      category,
      subcategories: [...subcategories].sort((a, b) => a.localeCompare(b, "es"))
    }));

  res.json({ total: data.length, items: data });
});

app.get("/products", (req, res) => {
  const {
    q,
    category,
    subcategory,
    hasDiscount,
    sort = "",
    priceMin,
    priceMax,
    discountMin,
    discountMax,
    limit: rawLimit = "100",
    offset: rawOffset = "0"
  } = req.query;

  const limit = rawLimit === "all" ? state.products.length : parsePositiveInt(rawLimit, 100);
  const offset = parsePositiveInt(rawOffset, 0);
  const minPrice = parsePositiveNumber(priceMin, null);
  const maxPrice = parsePositiveNumber(priceMax, null);
  const minDiscount = parsePositiveNumber(discountMin, null);
  const maxDiscount = parsePositiveNumber(discountMax, null);

  const getReferencePrice = (item) => {
    const discounted = item?.prices?.discounted;
    if (typeof discounted === "number") return discounted;
    const regular = item?.prices?.regular;
    return typeof regular === "number" ? regular : null;
  };

  const getDiscountPercent = (item) => {
    const percent = item?.discountPercent;
    return typeof percent === "number" ? percent : 0;
  };

  let filtered = state.products;

  if (typeof q === "string" && q.trim()) {
    const search = normalizeText(q);
    filtered = filtered.filter((item) => {
      return [item.title, item.description, item.brand, item.sku]
        .filter(Boolean)
        .some((value) => normalizeText(value).includes(search));
    });
  }

  if (typeof category === "string" && category.trim()) {
    const needle = normalizeText(category);
    filtered = filtered.filter((item) => normalizeText(item?.categories?.category) === needle);
  }

  if (typeof subcategory === "string" && subcategory.trim()) {
    const needle = normalizeText(subcategory);
    filtered = filtered.filter((item) => normalizeText(item?.categories?.subcategory) === needle);
  }

  if (typeof hasDiscount === "string") {
    const boolValue = ["true", "1", "yes", "si"].includes(hasDiscount.toLowerCase());
    filtered = filtered.filter((item) => Boolean(item.hasDiscount) === boolValue);
  }

  if (minPrice !== null) {
    filtered = filtered.filter((item) => {
      const ref = getReferencePrice(item);
      return ref !== null && ref >= minPrice;
    });
  }

  if (maxPrice !== null) {
    filtered = filtered.filter((item) => {
      const ref = getReferencePrice(item);
      return ref !== null && ref <= maxPrice;
    });
  }

  if (minDiscount !== null) {
    filtered = filtered.filter((item) => getDiscountPercent(item) >= minDiscount);
  }

  if (maxDiscount !== null) {
    filtered = filtered.filter((item) => getDiscountPercent(item) <= maxDiscount);
  }

  const normalizedSort = String(sort || "").trim().toLowerCase();
  if (normalizedSort === "price_asc" || normalizedSort === "price_desc") {
    const direction = normalizedSort === "price_asc" ? 1 : -1;
    filtered = [...filtered].sort((a, b) => {
      const left = getReferencePrice(a);
      const right = getReferencePrice(b);

      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;

      if (left !== right) {
        return (left - right) * direction;
      }

      return String(a?.title || "").localeCompare(String(b?.title || ""), "es");
    });
  }

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);

  res.json({
    total,
    limit,
    offset,
    items
  });
});

app.get("/products/:id", (req, res) => {
  const id = String(req.params.id);

  const item = state.products.find((product) => {
    return String(product.id) === id || String(product.sku) === id;
  });

  if (!item) {
    res.status(404).json({ error: "Producto no encontrado" });
    return;
  }

  res.json(item);
});

app.post("/sync", async (req, res) => {
  try {
    if (process.env.VERCEL) {
      res.status(501).json({
        error: "POST /sync no esta habilitado en Vercel. Ejecuta sync fuera de Vercel y persiste datos en una base externa."
      });
      return;
    }

    const maxProducts = parsePositiveInt(req.body?.maxProducts ?? req.query?.maxProducts, null);
    const concurrency = parsePositiveInt(req.body?.concurrency ?? req.query?.concurrency, 40) || 40;
    const full = parseBoolean(req.body?.full ?? req.query?.full, false);

    const result = await runSync({ maxProducts, concurrency, full });
    res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/sync/errors", (_req, res) => {
  res.json({
    total: state.errors.length,
    items: state.errors
  });
});

async function start() {
  await ensureDataLoaded();

  app.listen(PORT, () => {
    console.log(`API no oficial de Punto Farma escuchando en http://localhost:${PORT}`);
    console.log(`Productos cargados: ${state.products.length}`);
    console.log("Usa POST /sync para refrescar todos los productos");
  });
}

app.use((error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: message });
});

if (require.main === module) {
  start().catch((error) => {
    console.error("No se pudo iniciar el servidor", error);
    process.exit(1);
  });
}

module.exports = app;
