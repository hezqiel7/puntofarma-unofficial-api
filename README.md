# API no oficial de Punto Farma (Playwright)

API y panel web para explorar productos de `https://www.puntofarma.com.py/`.

## Estado actual

- Repositorio: `https://github.com/hezqiel7/puntofarma-unofficial-api`
- Produccion (Vercel): `https://playwright-coral.vercel.app`

## Que devuelve por producto

- `id`, `sku`, `gtin`
- `title`, `description`, `url`, `image`, `brand`, `availability`
- `prices.regular`, `prices.discounted`, `prices.options`
- `hasDiscount`, `discountPercent`
- `categories.category`, `categories.subcategory`, `categories.path`, `categories.breadcrumbs`
- `scrapedAt`

## Instalacion y uso local

```bash
npm install
npm start
```

Servidor local: `http://localhost:3000`

Panel web local: `http://localhost:3000/`

## Endpoints

- `GET /`
- `GET /health`
- `GET /meta`
- `GET /categories`
- `GET /products`
- `GET /products/:id`
- `GET /sync/errors`
- `POST /sync` (solo local, ver seccion Vercel)

## Filtros y orden en `GET /products`

- `q`
- `category`
- `subcategory`
- `hasDiscount=true|false`
- `sort=price_asc|price_desc`
- `priceMin`, `priceMax`
- `discountMin`, `discountMax`
- `limit` (numero o `all`)
- `offset`

Notas:

- El orden por precio usa como referencia `prices.discounted`; si no existe, usa `prices.regular`.
- `q`, `category` y `subcategory` son case-insensitive y acento-insensitive.
  - Ejemplo: `bebe` y `bebé` matchean igual.
- En `q` para multiples palabras: primero prioriza coincidencia de frase exacta (`"cinta hipoalergenica"`), luego resultados que contengan todos los terminos aunque sea en otro orden.
- Si `q` incluye dosis/unidades (ej: `500mg`, `5ml`, `20 unidades`, `500mg/5ml`), el ranking prioriza productos con esas unidades exactas.

Ejemplo:

```bash
curl "http://localhost:3000/products?hasDiscount=true&sort=price_asc&priceMin=10000&priceMax=120000&discountMin=10&limit=20"
```

## Sync de catalogo

### Modo incremental (default, recomendado)

```bash
npm run sync -- --concurrency 40
```

- Reutiliza productos ya guardados y omite errores conocidos.
- Ideal para refrescos frecuentes.

### Modo full (forzar recarga total)

```bash
npm run sync -- --full --concurrency 40
```

### Via API local

```bash
curl -X POST "http://localhost:3000/sync" \
  -H "Content-Type: application/json" \
  -d "{\"concurrency\":40}"
```

Opcional:

- `maxProducts` para pruebas rapidas
- `full=true` para recarga completa

## Rendimiento

- Scraping por HTTP directo (sin render browser por producto).
- Concurrencia recomendada para maxima velocidad: `32` a `50`.
- Si aparecen timeouts o bloqueos, bajar concurrencia.

## Deploy en Vercel

El proyecto ya esta adaptado a Vercel con:

- `vercel.json`
- `api/[[...route]].js`

Deploy manual:

```bash
vercel --prod
```

Importante en Vercel:

- `POST /sync` esta deshabilitado (limitaciones serverless + filesystem efimero).
- Produccion carga un snapshot desde `seed/products.json`.
- Para actualizar datos en produccion:
  1. ejecutar sync local (`npm run sync -- --full`)
  2. actualizar `seed/products.json` con el nuevo snapshot
  3. commit + push (dispara redeploy)

## Estructura clave

- `src/scraper/puntofarma.js`: scraping y estrategia incremental
- `src/server.js`: API Express
- `src/sync.js`: sync por CLI
- `public/`: interfaz web
- `seed/products.json`: snapshot para produccion
- `api/[[...route]].js`: entrada serverless para Vercel
