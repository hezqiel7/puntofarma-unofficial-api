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

La interfaz publica no muestra controles de sincronizacion.

## Endpoints

- `GET /`
- `GET /health`
- `GET /meta`
- `GET /categories`
- `GET /products`
- `GET /products/:id`
- `GET /sync/errors`
- `POST /sync` (solo uso manual privado, ver seguridad)

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
- Si aplicas `sort=price_asc|price_desc`, se mantiene primero la seccion de mejores coincidencias de busqueda (incluyendo unidades) y el orden por precio se aplica dentro de cada seccion.

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
  -H "x-sync-token: TU_TOKEN" \
  -d "{\"concurrency\":40,\"full\":true}"
```

Opcional:

- `maxProducts` para pruebas rapidas
- `full=true` para recarga completa

## Seguridad de sync manual

- Si defines `SYNC_API_TOKEN`, el endpoint `POST /sync` exige autenticacion.
- Puedes enviar el token en `x-sync-token` o `Authorization: Bearer <token>`.
- Esto permite sincronizacion manual privada sin exponerla al publico.

Ejemplo PowerShell:

```powershell
$env:SYNC_API_TOKEN = "tu-token-seguro"
npm start
```

```bash
curl -X POST "http://localhost:3000/sync" -H "x-sync-token: tu-token-seguro" -H "Content-Type: application/json" -d "{\"full\":true}"
```

## Sincronizacion automatica diaria (04:00 Paraguay)

- Workflow: `.github/workflows/sync-catalog.yml`
- Horario: todos los dias a las `04:00` hora Paraguay (`08:00 UTC`)
- Flujo:
  1. divide el catalogo en fases independientes (chunks de 5000 URLs)
  2. ejecuta cada fase en proceso aislado (libera memoria entre fases)
  3. aplica reintentos por fase con concurrencia mas baja si falla
  4. mergea todos los chunks en un solo `data/products.json`
  5. genera `seed/products.json`
  6. hace commit y push automatico si hay cambios
  7. Vercel redeploya por integracion con GitHub

El schedule corre full cada noche para reflejar cambios de precio. La ejecucion manual (`workflow_dispatch`) permite `full=true` (por fases) o `full=false` (incremental rapido).

Tambien puedes dispararlo manualmente desde GitHub Actions con `workflow_dispatch` (solo usuarios con permisos de escritura al repo).

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
- El refresh productivo recomendado es por GitHub Actions programado (04:00 Paraguay).

## Estructura clave

- `src/scraper/puntofarma.js`: scraping y estrategia incremental
- `src/server.js`: API Express
- `src/sync.js`: sync por CLI
- `src/sync-chunk.js`: sync por fase (chunk) para full nocturno
- `src/merge-chunks.js`: merge final de fases en un snapshot unico
- `public/`: interfaz web
- `seed/products.json`: snapshot para produccion
- `api/[[...route]].js`: entrada serverless para Vercel
