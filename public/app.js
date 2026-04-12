const els = {
  metaBox: document.getElementById("metaBox"),
  filtersForm: document.getElementById("filtersForm"),
  q: document.getElementById("q"),
  category: document.getElementById("category"),
  subcategory: document.getElementById("subcategory"),
  hasDiscount: document.getElementById("hasDiscount"),
  sort: document.getElementById("sort"),
  priceMin: document.getElementById("priceMin"),
  priceMax: document.getElementById("priceMax"),
  discountMin: document.getElementById("discountMin"),
  discountMax: document.getElementById("discountMax"),
  limit: document.getElementById("limit"),
  offset: document.getElementById("offset"),
  clearBtn: document.getElementById("clearBtn"),
  requestPreview: document.getElementById("requestPreview"),
  productId: document.getElementById("productId"),
  getByIdBtn: document.getElementById("getByIdBtn"),
  syncMax: document.getElementById("syncMax"),
  syncConcurrency: document.getElementById("syncConcurrency"),
  syncFull: document.getElementById("syncFull"),
  syncBtn: document.getElementById("syncBtn"),
  actionOutput: document.getElementById("actionOutput"),
  resultInfo: document.getElementById("resultInfo"),
  productsList: document.getElementById("productsList"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn")
};

const state = {
  categoryMap: new Map(),
  lastTotal: 0,
  lastLimit: 50,
  lastOffset: 0,
  loadingProducts: false,
  lastFilterKey: null
};

function safeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatGs(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `Gs. ${value.toLocaleString("es-PY")}`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-PY");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Error ${response.status}`);
  }

  return data;
}

function getFiltersFromForm() {
  const params = new URLSearchParams();

  const addOptionalNumericParam = (key, rawValue) => {
    const normalized = String(rawValue ?? "").trim();
    if (!normalized) return;

    const num = Number(normalized);
    if (!Number.isFinite(num) || num < 0) return;

    params.set(key, String(Math.floor(num)));
  };

  if (els.q.value.trim()) params.set("q", els.q.value.trim());
  if (els.category.value) params.set("category", els.category.value);
  if (els.subcategory.value) params.set("subcategory", els.subcategory.value);
  if (els.hasDiscount.value) params.set("hasDiscount", els.hasDiscount.value);
  if (els.sort.value) params.set("sort", els.sort.value);

  addOptionalNumericParam("priceMin", els.priceMin.value);
  addOptionalNumericParam("priceMax", els.priceMax.value);
  addOptionalNumericParam("discountMin", els.discountMin.value);
  addOptionalNumericParam("discountMax", els.discountMax.value);

  if (els.limit.value) params.set("limit", els.limit.value);

  const offsetNumber = Number(els.offset.value || 0);
  params.set("offset", String(Number.isFinite(offsetNumber) && offsetNumber >= 0 ? Math.floor(offsetNumber) : 0));

  return params;
}

function getFilterKey() {
  return JSON.stringify({
    q: els.q.value.trim(),
    category: els.category.value,
    subcategory: els.subcategory.value,
    hasDiscount: els.hasDiscount.value,
    sort: els.sort.value,
    priceMin: els.priceMin.value,
    priceMax: els.priceMax.value,
    discountMin: els.discountMin.value,
    discountMax: els.discountMax.value,
    limit: els.limit.value
  });
}

function updateRequestPreview(path, params) {
  const query = params.toString();
  els.requestPreview.textContent = query ? `${path}?${query}` : path;
}

function setOutput(value, isError = false) {
  els.actionOutput.style.color = isError ? "#ffd0d0" : "#d4f2ff";
  els.actionOutput.textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function fillSubcategoryOptions() {
  const selectedCategory = els.category.value;
  const subcategories = selectedCategory ? state.categoryMap.get(selectedCategory) || [] : [];
  const current = els.subcategory.value;

  els.subcategory.innerHTML = '<option value="">Todas</option>';

  subcategories.forEach((sub) => {
    const option = document.createElement("option");
    option.value = sub;
    option.textContent = sub;
    els.subcategory.appendChild(option);
  });

  if (subcategories.includes(current)) {
    els.subcategory.value = current;
  }
}

async function loadMeta() {
  const meta = await api("/meta");
  els.metaBox.innerHTML = [
    `<div><strong>Total cargados:</strong> ${safeText(meta.total)}</div>`,
    `<div><strong>Ultima sync:</strong> ${safeText(formatDate(meta.updatedAt))}</div>`,
    `<div><strong>Fallidos:</strong> ${safeText(meta.failed)}</div>`,
    `<div><strong>Sync activa:</strong> ${meta.syncInProgress ? "si" : "no"}</div>`
  ].join("");
}

async function loadCategories() {
  const data = await api("/categories");

  state.categoryMap.clear();
  data.items.forEach((item) => state.categoryMap.set(item.category, item.subcategories));

  const current = els.category.value;
  els.category.innerHTML = '<option value="">Todas</option>';

  [...state.categoryMap.keys()].forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    els.category.appendChild(option);
  });

  if (state.categoryMap.has(current)) {
    els.category.value = current;
  }

  fillSubcategoryOptions();
}

function renderProducts(items) {
  if (!items.length) {
    els.productsList.innerHTML = '<div class="meta">No hay resultados para estos filtros.</div>';
    return;
  }

  const cards = items.map((item) => {
    const title = safeText(item.title || "Sin titulo");
    const sku = safeText(item.sku || item.id || "-");
    const brand = safeText(item.brand || "-");
    const categoryPath = safeText((item.categories?.path || []).join(" > ") || "-");
    const regular = formatGs(item.prices?.regular);
    const discounted = formatGs(item.prices?.discounted);
    const ita = formatGs(
      item.prices?.options?.find((opt) => /itau/i.test(`${opt.label} ${opt.note}`))?.amount
    );
    const discountPct = item.discountPercent ? `${item.discountPercent}%` : "-";
    const desc = safeText((item.description || "").slice(0, 220));
    const image = item.image ? `<img class="thumb" src="${safeText(item.image)}" alt="${title}" />` : "";

    return `
      <article class="product">
        ${image}
        <h3>${title}</h3>
        <div class="meta">SKU: ${sku} | Marca: ${brand}</div>
        <div class="meta">Categoria: ${categoryPath}</div>
        <div class="price-row">
          <span class="chip">Regular: ${safeText(regular)}</span>
          <span class="chip ${item.hasDiscount ? "discount" : ""}">Desc: ${safeText(discounted)}</span>
          <span class="chip">Itau: ${safeText(ita)}</span>
          <span class="chip">%: ${safeText(discountPct)}</span>
        </div>
        <p class="desc">${desc || "Sin descripcion"}</p>
        <a href="${safeText(item.url || "#")}" target="_blank" rel="noreferrer">Abrir producto</a>
      </article>
    `;
  });

  els.productsList.innerHTML = cards.join("");
}

function updatePager() {
  const limitRaw = String(state.lastLimit);
  const allMode = limitRaw === "all";
  const pageSize = allMode ? state.lastTotal : Number(state.lastLimit) || 0;

  els.prevBtn.disabled = allMode || state.lastOffset <= 0;
  els.nextBtn.disabled = allMode || state.lastOffset + pageSize >= state.lastTotal;
}

async function fetchProducts(options = {}) {
  const { fromPager = false } = options;

  if (state.loadingProducts) return;
  state.loadingProducts = true;

  try {
    const currentFilterKey = getFilterKey();

    if (!fromPager && state.lastFilterKey !== null && currentFilterKey !== state.lastFilterKey) {
      els.offset.value = "0";
    }

    const params = getFiltersFromForm();
    updateRequestPreview("/products", params);

    const data = await api(`/products?${params.toString()}`);

    state.lastTotal = Number(data.total || 0);
    state.lastLimit = els.limit.value;
    state.lastOffset = Number(els.offset.value || 0);
    state.lastFilterKey = currentFilterKey;

    els.resultInfo.textContent = `Mostrando ${data.items.length} de ${data.total} (offset ${data.offset}, limit ${data.limit})`;
    renderProducts(data.items);
    updatePager();
  } catch (error) {
    els.resultInfo.textContent = `Error: ${error.message}`;
    els.productsList.innerHTML = "";
  } finally {
    state.loadingProducts = false;
  }
}

async function fetchById() {
  const id = els.productId.value.trim();
  if (!id) {
    setOutput("Escribe un ID o SKU.", true);
    return;
  }

  try {
    const item = await api(`/products/${encodeURIComponent(id)}`);
    setOutput(item);
    els.resultInfo.textContent = `Mostrando producto ${id}`;
    renderProducts([item]);
  } catch (error) {
    setOutput(error.message, true);
  }
}

async function runSync() {
  const payload = {
    concurrency: Number(els.syncConcurrency.value || 40),
    full: Boolean(els.syncFull.checked)
  };

  const max = Number(els.syncMax.value);
  if (Number.isFinite(max) && max > 0) {
    payload.maxProducts = Math.floor(max);
  }

  els.syncBtn.disabled = true;
  setOutput("Iniciando sincronizacion...");

  try {
    const response = await api("/sync", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    setOutput(response);
    await loadMeta();
    await loadCategories();
    await fetchProducts();
  } catch (error) {
    setOutput(error.message, true);
  } finally {
    els.syncBtn.disabled = false;
  }
}

els.filtersForm.addEventListener("submit", (event) => {
  event.preventDefault();
  fetchProducts();
});

els.category.addEventListener("change", () => {
  fillSubcategoryOptions();
  els.offset.value = "0";
});

els.clearBtn.addEventListener("click", () => {
  els.filtersForm.reset();
  els.offset.value = "0";
  fillSubcategoryOptions();
  fetchProducts();
});

els.getByIdBtn.addEventListener("click", fetchById);
els.syncBtn.addEventListener("click", runSync);

els.prevBtn.addEventListener("click", () => {
  const step = Number(els.limit.value || 0);
  if (!Number.isFinite(step) || step <= 0) return;
  const nextOffset = Math.max(0, Number(els.offset.value || 0) - step);
  els.offset.value = String(nextOffset);
  fetchProducts({ fromPager: true });
});

els.nextBtn.addEventListener("click", () => {
  const step = Number(els.limit.value || 0);
  if (!Number.isFinite(step) || step <= 0) return;
  const nextOffset = Number(els.offset.value || 0) + step;
  els.offset.value = String(nextOffset);
  fetchProducts({ fromPager: true });
});

async function init() {
  try {
    await loadMeta();
    await loadCategories();
    await fetchProducts();
  } catch (error) {
    els.metaBox.textContent = `Error inicial: ${error.message}`;
  }
}

init();
