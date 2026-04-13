const fs = require("node:fs/promises");
const path = require("node:path");

const DATA_FILE = path.join(process.cwd(), "data", "products.json");
const SEED_FILE = path.join(process.cwd(), "seed", "products.json");

function slimProduct(product) {
  if (!product || typeof product !== "object") return product;
  const { raw: _raw, ...rest } = product;
  return rest;
}

async function main() {
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);

  const payload = {
    meta: parsed.meta || {},
    products: Array.isArray(parsed.products) ? parsed.products.map(slimProduct) : [],
    errors: Array.isArray(parsed.errors) ? parsed.errors : []
  };

  await fs.mkdir(path.dirname(SEED_FILE), { recursive: true });
  await fs.writeFile(SEED_FILE, JSON.stringify(payload), "utf8");

  console.log(`Seed actualizado: ${SEED_FILE}`);
  console.log(`Productos en seed: ${payload.products.length}`);
}

main().catch((error) => {
  console.error("No se pudo construir seed", error);
  process.exit(1);
});
