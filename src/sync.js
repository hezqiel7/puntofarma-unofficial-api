const fs = require("node:fs/promises");
const path = require("node:path");

const { scrapeAllProducts } = require("./scraper/puntofarma");

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "products.json");
const SEED_FILE = path.join(process.cwd(), "seed", "products.json");

function parseArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function mergeErrors(existingErrors, newErrors, products) {
  const knownProductUrls = new Set(
    (products || []).map((product) => product?.url).filter(Boolean)
  );

  const merged = new Map();
  for (const error of [...(existingErrors || []), ...(newErrors || [])]) {
    if (!error?.url) continue;
    if (knownProductUrls.has(error.url)) {
      merged.delete(error.url);
      continue;
    }
    merged.set(error.url, error);
  }

  return [...merged.values()];
}

async function loadExistingSnapshot() {
  for (const file of [DATA_FILE, SEED_FILE]) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      return {
        sourceFile: file,
        products: Array.isArray(parsed.products) ? parsed.products : [],
        errors: Array.isArray(parsed.errors) ? parsed.errors : []
      };
    } catch {
      continue;
    }
  }

  return {
    sourceFile: null,
    products: [],
    errors: []
  };
}

async function main() {
  const maxProductsArg = parseArg("--max");
  const concurrencyArg = parseArg("--concurrency", "40");
  let full = hasFlag("--full");

  const maxProducts = maxProductsArg ? Number(maxProductsArg) : null;
  const concurrency = Number(concurrencyArg);

  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error("--concurrency debe ser un numero positivo");
  }

  const startedAt = Date.now();
  console.log("Iniciando scraping con Playwright...");

  let existingProducts = [];
  let existingErrors = [];
  if (!full) {
    const snapshot = await loadExistingSnapshot();
    existingProducts = snapshot.products;
    existingErrors = snapshot.errors;
    if (snapshot.sourceFile) {
      console.log(`Snapshot base cargado desde: ${snapshot.sourceFile}`);
      console.log(`Productos base: ${existingProducts.length} | Errores base: ${existingErrors.length}`);
    }

    if (!snapshot.sourceFile || existingProducts.length === 0) {
      if (process.env.CI) {
        throw new Error(
          "No hay snapshot base para sync incremental en CI. Verifica seed/products.json antes de ejecutar el workflow."
        );
      }

      console.warn("No se encontro snapshot base. Se cambiara automaticamente a modo full.");
      full = true;
      existingProducts = [];
      existingErrors = [];
    }
  }

  const result = await scrapeAllProducts({
    maxProducts: Number.isFinite(maxProducts) ? Math.floor(maxProducts) : null,
    concurrency: Math.floor(concurrency),
    existingProducts,
    existingErrors,
    skipKnown: !full,
    skipKnownFailures: !full,
    retryAttempts: 2,
    onProgress: ({ finished, total }) => {
      if (total > 0 && (finished % 100 === 0 || finished === total)) {
        console.log(`Progreso: ${finished}/${total}`);
      }
    }
  });

  const mergedErrors = full
    ? result.errors
    : mergeErrors(existingErrors, result.errors, result.products);

  const payload = {
    meta: {
      updatedAt: new Date().toISOString(),
      tookSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      total: result.scraped,
      failed: mergedErrors.length,
      newFailed: result.failed,
      sourceTotal: result.totalUrls,
      requested: result.requestedUrls,
      fetched: result.fetchedUrls,
      preserved: result.preservedUrls,
      skippedKnownFailures: result.preservedFailedUrls,
      mode: full ? "full" : "incremental"
    },
    products: result.products,
    errors: mergedErrors
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Listo. Productos guardados en ${DATA_FILE}`);
  console.log(
    `Mode: ${full ? "full" : "incremental"} | Total: ${result.scraped} | Fetch: ${result.fetchedUrls} | Preserve: ${result.preservedUrls} | SkipFail: ${result.preservedFailedUrls} | Fallidos: ${payload.errors.length} (nuevos ${result.failed})`
  );
}

main().catch((error) => {
  console.error("Error en sincronizacion", error);
  process.exit(1);
});
