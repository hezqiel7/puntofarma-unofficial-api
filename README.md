# API no oficial de Punto Farma (Playwright)

Este proyecto crea una API local para extraer productos de `https://www.puntofarma.com.py/` usando Playwright.

## Que extrae por producto

- ID / SKU / GTIN
- Titulo
- Descripcion
- URL canonica
- Imagen principal
- Marca
- Disponibilidad
- Precios (regular, descuento y otras variantes visibles)
- Si tiene descuento o no
- Porcentaje de descuento (si aparece)
- Categoria, subcategoria y breadcrumb completo
- JSON-LD original del producto (campo `raw`)

## Instalacion

```bash
npm install
```

## Ejecutar API

```bash
npm start
```

Servidor en `http://localhost:3000`.

## Deploy en Vercel

El proyecto ya incluye configuracion para Vercel:

- `vercel.json`
- `api/[[...route]].js` (funcion serverless para API)

Pasos:

```bash
npm i -g vercel
vercel login
vercel
```

Para produccion:

```bash
vercel --prod
```

Notas importantes para Vercel:

- `POST /sync` esta deshabilitado en Vercel (timeout/ephemeral FS).
- El deploy usa `seed/products.json` como snapshot inicial de productos.
- Para refrescar catalogo en produccion, ejecuta `npm run sync -- --full` localmente y vuelve a generar/subir `seed/products.json`.

## Web de consulta

Al levantar el servidor, abre:

- `http://localhost:3000/`

Incluye:

- filtros `q`, `category`, `subcategory`, `hasDiscount`, `sort`, `priceMin`, `priceMax`, `discountMin`, `discountMax`, `limit`, `offset`
- paginacion simple (anterior/siguiente)
- consulta por `GET /products/:id`
- boton para ejecutar `POST /sync`

## Sincronizar productos

### Desde API

```bash
curl -X POST "http://localhost:3000/sync" \
  -H "Content-Type: application/json" \
  -d "{\"concurrency\":40}"
```

Opcional para prueba rapida:

```bash
curl -X POST "http://localhost:3000/sync?maxProducts=100&concurrency=2"
```

### Desde script

```bash
npm run sync -- --max 100 --concurrency 40
```

Los datos se guardan en `data/products.json`.

Por defecto el sync es **incremental** (solo trae productos nuevos del sitemap y preserva los ya guardados).

Si quieres forzar recarga total:

```bash
npm run sync -- --full --concurrency 40
```

o por API:

```bash
curl -X POST "http://localhost:3000/sync" -H "Content-Type: application/json" -d "{\"full\":true}"
```

## Rendimiento

- El scraper usa peticiones HTTP directas (sin render de navegador por cada producto), que es mucho mas rapido.
- Modo incremental por defecto para acelerar syncs repetidos.
- Para maxima velocidad usa `concurrency` entre `32` y `50`.
- Si ves errores por timeout, baja `concurrency`.

## Endpoints

- `GET /health`
- `GET /meta`
- `POST /sync`
- `GET /sync/errors`
- `GET /categories`
- `GET /products`
- `GET /products/:id`

## Filtros de `/products`

- `q` busqueda por texto
- `category` categoria exacta
- `subcategory` subcategoria exacta
- `hasDiscount=true|false`
- `sort=price_asc|price_desc` (usa precio con descuento como referencia)
- `priceMin`, `priceMax` (filtro por precio de referencia)
- `discountMin`, `discountMax` (filtro por porcentaje de descuento)
- `limit` (numero o `all`)
- `offset`

`q`, `category` y `subcategory` usan normalizacion de texto: son case-insensitive y acento-insensitive (`a` = `á`, `e` = `é`, etc.).

Ejemplo:

```bash
curl "http://localhost:3000/products?hasDiscount=true&category=Mundo%20Dermocosm%C3%A9tica&limit=20"
```
