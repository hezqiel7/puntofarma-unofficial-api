const fs = require("node:fs/promises");
const path = require("node:path");

function parseArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(url || "");
  }
}

function getProductKey(product) {
  if (product?.url) return `url:${normalizeUrl(product.url)}`;
  if (product?.id !== null && product?.id !== undefined) return `id:${product.id}`;
  if (product?.sku) return `sku:${product.sku}`;
  return `fallback:${Math.random()}`;
}

async function main() {
  const inputDir = parseArg("--input-dir", path.join(process.cwd(), "artifacts", "chunks"));
  const outputFile = parseArg("--output", path.join(process.cwd(), "data", "products.json"));

  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(inputDir, entry.name))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    throw new Error(`No se encontraron chunks JSON en ${inputDir}`);
  }

  const mergedProducts = new Map();
  const productUrls = new Set();
  const mergedErrors = new Map();

  let sourceTotal = 0;
  let requested = 0;
  let fetched = 0;
  let failed = 0;

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);

    const chunkProducts = Array.isArray(parsed.products) ? parsed.products : [];
    const chunkErrors = Array.isArray(parsed.errors) ? parsed.errors : [];

    sourceTotal = Math.max(sourceTotal, Number(parsed.chunk?.totalUrls || 0));
    requested += Number(parsed.chunk?.requested || chunkProducts.length + chunkErrors.length || 0);
    fetched += Number(parsed.chunk?.fetched || chunkProducts.length + chunkErrors.length || 0);
    failed += Number(parsed.chunk?.failed || chunkErrors.length || 0);

    for (const product of chunkProducts) {
      const key = getProductKey(product);
      mergedProducts.set(key, product);
      if (product?.url) {
        const normalized = normalizeUrl(product.url);
        productUrls.add(normalized);
        mergedErrors.delete(`url:${normalized}`);
      }
    }

    for (const error of chunkErrors) {
      if (!error?.url) continue;
      const normalized = normalizeUrl(error.url);
      const key = `url:${normalized}`;
      if (productUrls.has(normalized)) {
        continue;
      }
      mergedErrors.set(key, error);
    }
  }

  const products = [...mergedProducts.values()].sort((a, b) => {
    const left = Number(a?.id || 0);
    const right = Number(b?.id || 0);
    return left - right;
  });

  const errors = [...mergedErrors.values()];

  const payload = {
    meta: {
      updatedAt: new Date().toISOString(),
      total: products.length,
      failed: errors.length,
      newFailed: failed,
      sourceTotal,
      requested,
      fetched,
      mode: "full-phased"
    },
    products,
    errors
  };

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Merge completado: ${outputFile}`);
  console.log(`Productos: ${products.length} | Errores: ${errors.length}`);
}

main().catch((error) => {
  console.error("Error al mergear chunks", error);
  process.exit(1);
});
