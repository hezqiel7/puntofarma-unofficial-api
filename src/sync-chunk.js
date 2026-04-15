const fs = require("node:fs/promises");
const path = require("node:path");

const { scrapeAllProducts } = require("./scraper/puntofarma");

function parseArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

function requirePositiveInt(name, value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`${name} debe ser un numero >= 0`);
  }
  return Math.floor(num);
}

async function main() {
  const start = requirePositiveInt("--start", parseArg("--start", "0"));
  const end = requirePositiveInt("--end", parseArg("--end", String(start + 5000)));
  const concurrency = requirePositiveInt("--concurrency", parseArg("--concurrency", "8"));
  const apiResetEvery = requirePositiveInt("--api-reset-every", parseArg("--api-reset-every", "250"));
  const retryAttempts = requirePositiveInt("--retry-attempts", parseArg("--retry-attempts", "2"));
  const outputFile = parseArg("--output", path.join(process.cwd(), "artifacts", `chunk-${start}-${end}.json`));

  if (end <= start) {
    throw new Error("--end debe ser mayor que --start");
  }

  console.log(`Iniciando chunk ${start}-${end} | concurrency=${concurrency} | apiResetEvery=${apiResetEvery}`);

  const startedAt = Date.now();
  const result = await scrapeAllProducts({
    startIndex: start,
    endIndex: end,
    concurrency,
    retryAttempts,
    includeRaw: false,
    apiResetEvery,
    skipKnown: false,
    skipKnownFailures: false,
    onProgress: ({ finished, total }) => {
      if (total > 0 && (finished % 100 === 0 || finished === total)) {
        console.log(`Progreso chunk ${start}-${end}: ${finished}/${total}`);
      }
    }
  });

  const payload = {
    chunk: {
      start,
      end,
      tookSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      totalUrls: result.totalUrls,
      rangeStart: result.rangeStart,
      rangeEnd: result.rangeEnd,
      requested: result.requestedUrls,
      fetched: result.fetchedUrls,
      scraped: result.scraped,
      failed: result.failed,
      updatedAt: new Date().toISOString()
    },
    products: result.products,
    errors: result.errors
  };

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify(payload), "utf8");

  console.log(`Chunk escrito en ${outputFile}`);
  console.log(`Chunk ${start}-${end} | scraped=${result.scraped} | failed=${result.failed}`);
}

main().catch((error) => {
  console.error("Error en sync chunk", error);
  process.exit(1);
});
