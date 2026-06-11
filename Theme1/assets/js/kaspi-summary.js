(function () {
  "use strict";

  const BATCH_SIZE = 12;
  const BATCH_PAUSE_MS = 80;
  const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const STORAGE = {
    history: "kaspiWaybill.history.v1",
    namingRules: "kaspiWaybill.namingRules.v1",
    nicheRules: "kaspiWaybill.nicheRules.v1",
    settings: "kaspiWaybill.settings.v1"
  };
  const PAGE_META = {
    upload: ["Рабочее пространство", "Загрузка накладных"],
    summary: ["Аналитика дня", "Сводка дня"],
    products: ["Каталог дня", "Товары"],
    cities: ["География", "Города"],
    niches: ["Категории", "Ниши"],
    history: ["Локальные данные", "История"],
    seasonality: ["Расширенная аналитика", "Сезонность"],
    settings: ["Параметры", "Настройки"]
  };
  const WEEKDAYS = [
    { value: 1, label: "ПН" }, { value: 2, label: "ВТ" },
    { value: 3, label: "СР" }, { value: 4, label: "ЧТ" },
    { value: 5, label: "ПТ" }, { value: 6, label: "СБ" },
    { value: 0, label: "ВС" }
  ];

  const state = {
    archiveFile: null,
    archive: null,
    archiveName: "",
    pdfEntries: [],
    nextIndex: 0,
    records: [],
    errors: [],
    isRunning: false,
    stopRequested: false,
    pendingNames: {},
    pendingNiches: {},
    aggregates: [],
    aggregateById: new Map(),
    namingRules: readStorage(STORAGE.namingRules, {}),
    nicheRules: readStorage(STORAGE.nicheRules, {}),
    history: readStorage(STORAGE.history, []),
    settings: readStorage(STORAGE.settings, { workdays: [1, 2, 3, 4, 5] })
  };
  const dom = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheDom();
    bindNavigation();
    bindUpload();
    bindTables();
    bindHistory();
    bindSettings();
    if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    dom.processDate.value = todayLocal();
    renderAll();
    navigate("upload");
  }

  function cacheDom() {
    [
      "appSidebar", "sidebarBackdrop", "mobileMenu", "pageEyebrow", "pageTitle",
      "helpButton", "processDate", "dropZone", "zipInput", "selectedFile",
      "selectedFileName", "selectedFileMeta", "resetUploadButton", "processingPanel",
      "statusLabel", "statusTitle", "statusText", "processStatusDot", "progressBar",
      "foundCount", "processedCount", "successCount", "errorCount", "percentCount",
      "stopButton", "resumeButton", "errorPanel", "errorBadge", "errorList",
      "summarySubtitle", "summarySearch", "summarySort", "summaryTableBody",
      "summaryEmpty", "productsSearch", "productsTableBody", "productsEmpty",
      "mergeProductsButton", "saveRulesButton", "resetRulesButton",
      "citiesOrdersChart", "citiesQuantityChart", "cityProductGrid",
      "nichesOrdersChart", "nichesQuantityChart", "historyGrid", "historyEmpty",
      "exportHistoryButton", "importHistoryInput", "clearHistoryButton",
      "weekdayPicker", "storageDays", "storageNamingRules", "storageNicheRules",
      "appToast", "toastBody"
    ].forEach(function (id) { dom[id] = document.getElementById(id); });
  }

  function bindNavigation() {
    document.querySelectorAll("[data-page-link]").forEach(function (element) {
      element.addEventListener("click", function (event) {
        event.preventDefault();
        navigate(element.dataset.pageLink);
      });
    });
    dom.mobileMenu.addEventListener("click", function () { document.body.classList.toggle("sidebar-open"); });
    dom.sidebarBackdrop.addEventListener("click", closeSidebar);
    dom.helpButton.addEventListener("click", function () {
      showToast("ZIP и PDF обрабатываются только в вашем браузере. Сканированные PDF без текста требуют OCR и в MVP не поддерживаются.");
    });
  }

  function navigate(pageName) {
    if (!PAGE_META[pageName]) return;
    document.querySelectorAll(".app-page").forEach(function (page) {
      page.classList.toggle("active", page.dataset.page === pageName);
    });
    document.querySelectorAll(".nav-item[data-page-link]").forEach(function (item) {
      item.classList.toggle("active", item.dataset.pageLink === pageName);
    });
    dom.pageEyebrow.textContent = PAGE_META[pageName][0];
    dom.pageTitle.textContent = PAGE_META[pageName][1];
    closeSidebar();
    if (pageName === "cities" || pageName === "niches") renderAnalytics();
    if (pageName === "history") renderHistory();
    if (pageName === "settings") renderSettings();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeSidebar() { document.body.classList.remove("sidebar-open"); }

  function bindUpload() {
    dom.zipInput.addEventListener("change", function () {
      if (dom.zipInput.files && dom.zipInput.files[0]) selectArchive(dom.zipInput.files[0]);
    });
    dom.dropZone.addEventListener("click", function (event) {
      if (!event.target.closest(".file-button")) dom.zipInput.click();
    });
    dom.dropZone.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); dom.zipInput.click(); }
    });
    ["dragenter", "dragover"].forEach(function (name) {
      dom.dropZone.addEventListener(name, function (event) { event.preventDefault(); dom.dropZone.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (name) {
      dom.dropZone.addEventListener(name, function (event) { event.preventDefault(); dom.dropZone.classList.remove("dragover"); });
    });
    dom.dropZone.addEventListener("drop", function (event) {
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) selectArchive(file);
    });
    dom.stopButton.addEventListener("click", stopProcessing);
    dom.resumeButton.addEventListener("click", resumeProcessing);
    dom.resetUploadButton.addEventListener("click", function () { resetSession(); });
  }

  async function selectArchive(file) {
    const validZip = /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
    if (!validZip) { showToast("Выберите ZIP-архив."); return; }
    if (!window.JSZip || !window.pdfjsLib || !window.KaspiParser) {
      showToast("Библиотеки обработки не загрузились. Проверьте подключение к интернету и обновите страницу.");
      return;
    }
    resetSession(false);
    state.archiveFile = file;
    state.archiveName = file.name;
    dom.selectedFile.hidden = false;
    dom.selectedFileName.textContent = file.name;
    dom.selectedFileMeta.textContent = formatBytes(file.size) + " · распаковываем архив";
    updateStatus("Подготовка", "Открываем ZIP-архив", "Ищем PDF-файлы внутри архива.");
    setStep("archive");
    try {
      state.archive = await window.JSZip.loadAsync(file);
      state.pdfEntries = Object.values(state.archive.files).filter(function (entry) { return !entry.dir && /\.pdf$/i.test(entry.name); });
      if (!state.pdfEntries.length) throw new Error("В архиве не найдено PDF-файлов");
      if (state.pdfEntries.length > 2000) throw new Error("В архиве больше 2000 PDF. Разделите его на несколько частей");
      dom.selectedFileMeta.textContent = pluralize(state.pdfEntries.length, "PDF найден", "PDF найдено", "PDF найдено") + " · " + formatBytes(file.size);
      updateProgress();
      await processRemaining();
    } catch (error) {
      state.archive = null;
      state.pdfEntries = [];
      updateStatus("Ошибка архива", "Не удалось открыть ZIP", error.message || String(error));
      showToast(error.message || "Не удалось открыть ZIP.");
      updateProgress();
    }
  }

  async function processRemaining() {
    if (!state.archive || state.isRunning || state.nextIndex >= state.pdfEntries.length) return;
    state.isRunning = true;
    state.stopRequested = false;
    dom.stopButton.disabled = false;
    dom.resumeButton.hidden = true;
    dom.processStatusDot.className = "status-dot running";
    setStep("extract");
    updateStatus("Обработка идет", "Извлекаем текст из PDF", "Интерфейс остается доступным, ошибки отдельных файлов не остановят архив.");
    while (state.nextIndex < state.pdfEntries.length && !state.stopRequested) {
      const batch = state.pdfEntries.slice(state.nextIndex, state.nextIndex + BATCH_SIZE);
      await Promise.all(batch.map(processEntry));
      state.nextIndex += batch.length;
      updateProgress();
      renderErrors();
      await pause(BATCH_PAUSE_MS);
    }
    state.isRunning = false;
    dom.stopButton.disabled = true;
    if (state.stopRequested && state.nextIndex < state.pdfEntries.length) {
      dom.resumeButton.hidden = false;
      dom.processStatusDot.className = "status-dot";
      updateStatus("Обработка остановлена", "Можно продолжить с текущего места", "Уже обработанные результаты сохранены в текущей сессии.");
      return;
    }
    await finalizeProcessing();
  }

  async function processEntry(entry) {
    try {
      const arrayBuffer = await entry.async("arraybuffer");
      const text = await extractPdfText(arrayBuffer);
      state.records.push(window.KaspiParser.parseWaybill(text, baseName(entry.name), { namingRules: state.namingRules, nicheRules: state.nicheRules }));
    } catch (error) {
      state.errors.push({ fileName: entry.name, message: error && error.message ? error.message : String(error) });
    }
  }

  async function extractPdfText(arrayBuffer) {
    const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer), disableFontFace: true, useSystemFonts: true, stopAtErrors: false });
    let pdf;
    try {
      pdf = await withTimeout(loadingTask.promise, 30000, "PDF не ответил за 30 секунд");
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await withTimeout(pdf.getPage(pageNumber), 20000, "Не удалось открыть страницу PDF");
        const content = await withTimeout(page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false }), 20000, "Не удалось извлечь текст страницы");
        pages.push(textItemsToLines(content.items));
        page.cleanup();
        await pause(0);
      }
      const text = pages.filter(Boolean).join("\n").trim();
      if (text.length < 8) throw new Error("В PDF не найден текстовый слой");
      return text;
    } finally {
      try {
        if (pdf) await withTimeout(pdf.destroy(), 5000, "PDF cleanup timeout");
        else if (loadingTask.destroy) await withTimeout(loadingTask.destroy(), 5000, "PDF cleanup timeout");
      } catch (_error) { /* cleanup errors do not mask parsing */ }
    }
  }

  function textItemsToLines(items) {
    const positioned = items.filter(function (item) { return item && typeof item.str === "string" && item.str.trim(); }).map(function (item) {
      return { text: item.str.trim(), x: item.transform ? item.transform[4] : 0, y: item.transform ? item.transform[5] : 0, hasEOL: Boolean(item.hasEOL) };
    }).sort(function (a, b) { return Math.abs(b.y - a.y) > 2.5 ? b.y - a.y : a.x - b.x; });
    const lines = [];
    positioned.forEach(function (item) {
      const current = lines[lines.length - 1];
      if (!current || Math.abs(current.y - item.y) > 2.5 || current.closed) lines.push({ y: item.y, items: [item], closed: item.hasEOL });
      else { current.items.push(item); current.closed = current.closed || item.hasEOL; }
    });
    return lines.map(function (line) {
      return line.items.sort(function (a, b) { return a.x - b.x; }).map(function (item) { return item.text; }).join(" ").replace(/\s+/g, " ").trim();
    }).filter(Boolean).join("\n");
  }

  function stopProcessing() {
    if (!state.isRunning) return;
    state.stopRequested = true;
    dom.stopButton.disabled = true;
    updateStatus("Останавливаем", "Завершаем текущую пачку", "Остановка произойдет после уже открытых PDF.");
  }
  function resumeProcessing() { if (state.archive && !state.isRunning) processRemaining(); }

  async function finalizeProcessing() {
    setStep("summary");
    state.aggregates = aggregateRecords();
    dom.processStatusDot.className = "status-dot done";
    updateProgress();
    updateStatus("Готово", "Сводка собрана", pluralize(state.records.length, "накладная обработана", "накладные обработаны", "накладных обработано") + ". Результат сохранен в истории браузера.");
    saveCurrentDay();
    renderAll();
    showToast("Сводка готова и сохранена в истории.");
    await pause(220);
    navigate("summary");
  }

  function resetSession(clearFileInput) {
    if (state.isRunning) state.stopRequested = true;
    Object.assign(state, { archiveFile: null, archive: null, archiveName: "", pdfEntries: [], nextIndex: 0, records: [], errors: [], isRunning: false, stopRequested: false, pendingNames: {}, pendingNiches: {}, aggregates: [], aggregateById: new Map() });
    dom.selectedFile.hidden = true;
    dom.resumeButton.hidden = true;
    dom.stopButton.disabled = true;
    dom.processStatusDot.className = "status-dot";
    if (clearFileInput !== false) dom.zipInput.value = "";
    setStep("archive");
    updateStatus("Ожидание архива", "Готовы начать обработку", "Выберите ZIP, и здесь появится ход обработки.");
    updateProgress();
    renderAll();
  }

  function bindTables() {
    dom.summarySearch.addEventListener("input", renderProductTables);
    dom.productsSearch.addEventListener("input", renderProductTables);
    dom.summarySort.addEventListener("change", renderProductTables);
    [dom.summaryTableBody, dom.productsTableBody].forEach(function (tbody) { tbody.addEventListener("change", handleTableChange); });
    dom.mergeProductsButton.addEventListener("click", function () { state.aggregates = aggregateRecords(); renderAll(); showToast("Товары с одинаковыми нормализованными названиями объединены."); });
    dom.saveRulesButton.addEventListener("click", saveRules);
    dom.resetRulesButton.addEventListener("click", resetRules);
  }

  function handleTableChange(event) {
    const row = event.target.closest("tr[data-aggregate-id]");
    if (!row) return;
    const aggregate = state.aggregateById.get(row.dataset.aggregateId);
    if (!aggregate) return;
    if (event.target.classList.contains("product-name-input")) {
      const value = window.KaspiParser.normalizeWhitespace(event.target.value);
      if (!value) { event.target.value = aggregate.name; return; }
      aggregate.sourceKeys.forEach(function (key) { state.pendingNames[key] = value; });
    }
    if (event.target.classList.contains("niche-select")) aggregate.sourceKeys.forEach(function (key) { state.pendingNiches[key] = event.target.value; });
    state.aggregates = aggregateRecords();
    renderAll();
  }

  function saveRules() {
    state.namingRules = Object.assign({}, state.namingRules, state.pendingNames);
    state.nicheRules = Object.assign({}, state.nicheRules, state.pendingNiches);
    writeStorage(STORAGE.namingRules, state.namingRules);
    writeStorage(STORAGE.nicheRules, state.nicheRules);
    state.pendingNames = {};
    state.pendingNiches = {};
    state.records.forEach(applyStoredRulesToRecord);
    state.aggregates = aggregateRecords();
    saveCurrentDay();
    renderAll();
    showToast("Правила названий и ниш сохранены для будущих загрузок.");
  }

  function resetRules() {
    if (!window.confirm("Сбросить все сохраненные правила названий и ниш?")) return;
    state.namingRules = {}; state.nicheRules = {}; state.pendingNames = {}; state.pendingNiches = {};
    localStorage.removeItem(STORAGE.namingRules); localStorage.removeItem(STORAGE.nicheRules);
    state.records.forEach(function (record) { record.productName = record.rawProductName; record.niche = window.KaspiParser.classifyNiche(record.rawProductName, {}); });
    state.aggregates = aggregateRecords(); renderAll(); showToast("Правила сброшены.");
  }

  function applyStoredRulesToRecord(record) {
    const rawKey = window.KaspiParser.normalizeKey(record.rawProductName);
    record.productName = state.namingRules[rawKey] || record.rawProductName;
    const productKey = window.KaspiParser.normalizeKey(record.productName);
    record.niche = state.nicheRules[rawKey] || state.nicheRules[productKey] || window.KaspiParser.classifyNiche(record.productName, state.nicheRules);
  }

  function aggregateRecords() {
    const groups = new Map();
    state.records.forEach(function (record, recordIndex) {
      const rawKey = window.KaspiParser.normalizeKey(record.rawProductName);
      const displayName = state.pendingNames[rawKey] || state.namingRules[rawKey] || record.productName || record.rawProductName;
      const displayKey = window.KaspiParser.normalizeKey(displayName) || "unknown-" + recordIndex;
      const niche = state.pendingNiches[rawKey] || state.nicheRules[rawKey] || record.niche || window.KaspiParser.classifyNiche(displayName, state.nicheRules);
      if (!groups.has(displayKey)) groups.set(displayKey, { name: displayName, quantity: 0, orderIds: new Set(), cityQuantities: new Map(), nicheCounts: new Map(), weightKg: 0, hasWeight: false, files: [], sourceKeys: new Set(), recordIndexes: [] });
      const group = groups.get(displayKey);
      const quantity = Number(record.quantity) || 1;
      group.quantity += quantity;
      group.orderIds.add(record.orderNumber || record.fileName || String(recordIndex));
      group.cityQuantities.set(record.city, (group.cityQuantities.get(record.city) || 0) + quantity);
      group.nicheCounts.set(niche, (group.nicheCounts.get(niche) || 0) + 1);
      if (Number.isFinite(record.weightKg)) { group.weightKg += record.weightKg; group.hasWeight = true; }
      group.files.push(record.fileName); group.sourceKeys.add(rawKey); group.recordIndexes.push(recordIndex);
    });
    const totalQuantity = Array.from(groups.values()).reduce(function (sum, group) { return sum + group.quantity; }, 0);
    const aggregates = Array.from(groups.values()).map(function (group, index) {
      return { id: "product-" + index, name: group.name, quantity: group.quantity, orders: group.orderIds.size,
        cities: Array.from(group.cityQuantities.entries()).sort(function (a, b) { return b[1] - a[1]; }).map(function (entry) { return { name: entry[0], quantity: entry[1] }; }),
        niche: topMapEntry(group.nicheCounts).name || "Другое", weightKg: group.hasWeight ? group.weightKg : null,
        files: group.files, sourceKeys: Array.from(group.sourceKeys), recordIndexes: group.recordIndexes,
        share: totalQuantity ? group.quantity / totalQuantity * 100 : 0 };
    });
    state.aggregateById = new Map(aggregates.map(function (aggregate) { return [aggregate.id, aggregate]; }));
    return aggregates;
  }

  function renderAll() { state.aggregates = aggregateRecords(); renderProgress(); renderErrors(); renderMetrics(); renderProductTables(); renderAnalytics(); renderHistory(); renderSettings(); }
  function renderProgress() {
    const total = state.pdfEntries.length;
    const processed = state.records.length + state.errors.length;
    const percent = total ? Math.min(100, Math.round(processed / total * 100)) : 0;
    dom.foundCount.textContent = total; dom.processedCount.textContent = processed; dom.successCount.textContent = state.records.length; dom.errorCount.textContent = state.errors.length; dom.percentCount.textContent = percent + "%"; dom.progressBar.style.width = percent + "%"; dom.progressBar.parentElement.setAttribute("aria-valuenow", String(percent));
  }
  function updateProgress() { renderProgress(); }
  function updateStatus(label, title, text) { dom.statusLabel.textContent = label; dom.statusTitle.textContent = title; dom.statusText.textContent = text; }
  function setStep(activeStep) {
    const order = ["archive", "extract", "summary"];
    const activeIndex = order.indexOf(activeStep);
    document.querySelectorAll("[data-step]").forEach(function (step) { const index = order.indexOf(step.dataset.step); step.classList.toggle("active", index === activeIndex); step.classList.toggle("done", index < activeIndex); });
  }
  function renderErrors() {
    dom.errorPanel.hidden = state.errors.length === 0; dom.errorBadge.textContent = state.errors.length;
    dom.errorList.innerHTML = state.errors.map(function (error) { return '<div class="error-row"><i class="bi bi-file-earmark-x"></i><div><strong>' + escapeHtml(error.fileName) + "</strong><span>" + escapeHtml(error.message) + "</span></div></div>"; }).join("");
  }

  function renderMetrics() {
    const totalQuantity = state.aggregates.reduce(function (sum, item) { return sum + item.quantity; }, 0);
    const topCity = summarizeDimension("city")[0] || { name: "—", orders: 0 };
    const topNiche = summarizeDimension("niche")[0] || { name: "—", orders: 0 };
    setMetric("invoices", state.records.length); setMetric("quantity", totalQuantity); setMetric("unique", state.aggregates.length);
    setMetric("topCity", topCity.name); setMetric("topCityMeta", topCity.orders ? topCity.orders + " накладных" : "нет данных");
    setMetric("topNiche", topNiche.name); setMetric("topNicheMeta", topNiche.orders ? topNiche.orders + " накладных" : "нет данных"); setMetric("errors", state.errors.length);
    dom.summarySubtitle.textContent = state.records.length ? formatDate(dom.processDate.value) + " · " + (state.archiveName || "архив из истории") : "Загрузите архив, чтобы увидеть показатели.";
  }
  function setMetric(name, value) { document.querySelectorAll('[data-metric="' + name + '"]').forEach(function (element) { element.textContent = value; }); }

  function renderProductTables() {
    const summaryItems = filterAndSortAggregates(state.aggregates, dom.summarySearch.value, dom.summarySort.value);
    const productItems = filterAndSortAggregates(state.aggregates, dom.productsSearch.value, "alpha");
    dom.summaryTableBody.innerHTML = summaryItems.map(summaryRowHtml).join("");
    dom.productsTableBody.innerHTML = productItems.map(productRowHtml).join("");
    dom.summaryEmpty.hidden = summaryItems.length > 0; dom.productsEmpty.hidden = productItems.length > 0;
    dom.summaryTableBody.closest("table").hidden = summaryItems.length === 0; dom.productsTableBody.closest("table").hidden = productItems.length === 0;
  }
  function filterAndSortAggregates(items, query, sort) {
    const normalizedQuery = window.KaspiParser.normalizeKey(query);
    const result = items.filter(function (item) { return !normalizedQuery || window.KaspiParser.normalizeKey(item.name).indexOf(normalizedQuery) >= 0; });
    result.sort(function (a, b) {
      if (sort === "quantity") return b.quantity - a.quantity || compareText(a.name, b.name);
      if (sort === "orders") return b.orders - a.orders || compareText(a.name, b.name);
      if (sort === "cities") return compareText((a.cities[0] || {}).name || "", (b.cities[0] || {}).name || "");
      if (sort === "niche") return compareText(a.niche, b.niche) || compareText(a.name, b.name);
      return compareText(a.name, b.name);
    });
    return result;
  }
  function nicheOptions(item) { return window.KaspiParser.NICHES.map(function (niche) { return '<option value="' + escapeHtml(niche) + '"' + (niche === item.niche ? " selected" : "") + ">" + escapeHtml(niche) + "</option>"; }).join(""); }
  function cityBadges(item, limit) { return item.cities.slice(0, limit || item.cities.length).map(function (city) { return '<span class="badge-soft">' + escapeHtml(city.name) + "</span>"; }).join(""); }
  function summaryRowHtml(item) {
    const more = item.cities.length > 3 ? '<span class="badge-soft">+' + (item.cities.length - 3) + "</span>" : "";
    return '<tr data-aggregate-id="' + item.id + '"><td class="product-name-cell"><input class="product-name-input" value="' + escapeHtml(item.name) + '" aria-label="Название товара"><span class="subline">Нажмите, чтобы изменить название</span></td><td><span class="number-cell">' + item.quantity + '</span></td><td><span class="number-cell">' + item.orders + "</span></td><td>" + cityBadges(item, 3) + more + '</td><td><select class="niche-select" aria-label="Ниша">' + nicheOptions(item) + "</select></td><td>" + (item.weightKg === null ? "—" : formatWeight(item.weightKg)) + '</td><td class="share-cell"><strong>' + item.share.toFixed(1) + '%</strong><div class="share-bar"><span style="width:' + Math.min(100, item.share) + '%"></span></div></td></tr>';
  }
  function productRowHtml(item) {
    return '<tr data-aggregate-id="' + item.id + '"><td class="product-name-cell"><input class="product-name-input" value="' + escapeHtml(item.name) + '" aria-label="Название товара"><span class="subline">' + item.sourceKeys.length + ' исходных вариантов</span></td><td><span class="number-cell">' + item.quantity + '</span></td><td><span class="number-cell">' + item.orders + "</span></td><td>" + cityBadges(item) + '</td><td><select class="niche-select" aria-label="Ниша">' + nicheOptions(item) + "</select></td><td>" + item.files.length + "</td></tr>";
  }

  function renderAnalytics() {
    const cityStats = summarizeDimension("city"), nicheStats = summarizeDimension("niche");
    renderBarChart(dom.citiesOrdersChart, cityStats, "orders"); renderBarChart(dom.citiesQuantityChart, cityStats, "quantity");
    renderBarChart(dom.nichesOrdersChart, nicheStats, "orders"); renderBarChart(dom.nichesQuantityChart, nicheStats, "quantity"); renderCityProducts(cityStats);
  }
  function summarizeDimension(dimension) {
    const map = new Map();
    state.records.forEach(function (record) {
      const rawKey = window.KaspiParser.normalizeKey(record.rawProductName);
      const name = dimension === "city" ? record.city : state.pendingNiches[rawKey] || state.nicheRules[rawKey] || record.niche || "Другое";
      if (!map.has(name)) map.set(name, { name: name, orders: 0, quantity: 0, products: new Map() });
      const entry = map.get(name), quantity = Number(record.quantity) || 1;
      const productName = state.pendingNames[rawKey] || state.namingRules[rawKey] || record.productName || record.rawProductName;
      entry.orders += 1; entry.quantity += quantity; entry.products.set(productName, (entry.products.get(productName) || 0) + quantity);
    });
    return Array.from(map.values()).sort(function (a, b) { return b.orders - a.orders || b.quantity - a.quantity; });
  }
  function renderBarChart(container, data, field) {
    const items = data.slice(0, 10);
    if (!items.length) { container.innerHTML = emptyChartHtml(); return; }
    const max = Math.max.apply(null, items.map(function (item) { return item[field]; })) || 1;
    container.innerHTML = items.map(function (item) { return '<div class="bar-row"><strong>' + escapeHtml(item.name) + '</strong><div class="bar-track"><span style="width:' + Math.max(5, item[field] / max * 100) + '%"></span></div><em>' + item[field] + "</em></div>"; }).join("");
  }
  function renderCityProducts(cityStats) {
    const cities = cityStats.slice(0, 9);
    if (!cities.length) { dom.cityProductGrid.innerHTML = emptyChartHtml(); return; }
    dom.cityProductGrid.innerHTML = cities.map(function (city) {
      const products = Array.from(city.products.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3);
      return '<article class="city-product-card"><strong>' + escapeHtml(city.name) + "</strong><ol>" + products.map(function (product) { return "<li>" + escapeHtml(product[0]) + " · " + product[1] + "</li>"; }).join("") + "</ol></article>";
    }).join("");
  }
  function emptyChartHtml() { return '<div class="empty-state"><i class="bi bi-bar-chart"></i><strong>Нет данных</strong><span>Обработайте ZIP, чтобы построить рейтинг.</span></div>'; }

  function bindHistory() {
    dom.exportHistoryButton.addEventListener("click", exportHistory);
    dom.importHistoryInput.addEventListener("change", importHistory);
    dom.clearHistoryButton.addEventListener("click", function () {
      if (!state.history.length || !window.confirm("Удалить всю историю из этого браузера?")) return;
      state.history = []; writeStorage(STORAGE.history, state.history); renderHistory(); renderSettings(); showToast("История очищена.");
    });
    dom.historyGrid.addEventListener("click", function (event) {
      const card = event.target.closest("[data-history-date]"); if (!card) return;
      const date = card.dataset.historyDate;
      if (event.target.closest(".delete-day")) { state.history = state.history.filter(function (day) { return day.date !== date; }); writeStorage(STORAGE.history, state.history); renderHistory(); renderSettings(); return; }
      if (event.target.closest(".open-day")) openHistoryDay(date);
    });
  }
  function saveCurrentDay() {
    if (!state.records.length) return;
    const date = dom.processDate.value || todayLocal();
    const day = { version: 1, date: date, weekday: new Date(date + "T12:00:00").getDay(), zipName: state.archiveName,
      invoices: state.records.length, quantity: state.aggregates.reduce(function (sum, item) { return sum + item.quantity; }, 0), uniqueProducts: state.aggregates.length,
      products: state.aggregates.map(function (item) { return { name: item.name, quantity: item.quantity, orders: item.orders, cities: item.cities, niche: item.niche, weightKg: item.weightKg }; }),
      cities: summarizeDimension("city").map(compactDimension), niches: summarizeDimension("niche").map(compactDimension), errors: state.errors.slice(),
      records: state.records.map(function (record) { return { orderNumber: record.orderNumber, productName: record.productName, rawProductName: record.rawProductName, quantity: record.quantity, city: record.city, service: record.service, address: record.address, deliveryDate: record.deliveryDate, weightKg: record.weightKg, weightLabel: record.weightLabel, fileName: record.fileName, niche: record.niche, sourceLine: record.sourceLine }; }), savedAt: new Date().toISOString() };
    state.history = state.history.filter(function (item) { return item.date !== date; }); state.history.push(day); state.history.sort(function (a, b) { return b.date.localeCompare(a.date); }); writeStorage(STORAGE.history, state.history);
  }
  function compactDimension(item) { return { name: item.name, orders: item.orders, quantity: item.quantity }; }
  function renderHistory() {
    dom.historyEmpty.hidden = state.history.length > 0;
    dom.historyGrid.innerHTML = state.history.map(function (day) { return '<article class="surface history-card" data-history-date="' + escapeHtml(day.date) + '"><div class="history-card-head"><div><h3>' + escapeHtml(formatDate(day.date)) + "</h3><p>" + escapeHtml(day.zipName || "Импортированная сводка") + '</p></div><button class="delete-day" type="button" aria-label="Удалить день"><i class="bi bi-trash3"></i></button></div><div class="history-metrics"><div><span>Накладных</span><strong>' + (day.invoices || 0) + '</strong></div><div><span>Товаров</span><strong>' + (day.quantity || 0) + '</strong></div><div><span>Позиций</span><strong>' + (day.uniqueProducts || 0) + '</strong></div></div><button class="btn btn-light open-day" type="button">Открыть сводку</button></article>'; }).join("");
  }
  function openHistoryDay(date) {
    const day = state.history.find(function (item) { return item.date === date; }); if (!day) return;
    state.archive = null; state.archiveFile = null; state.archiveName = day.zipName || ""; state.pdfEntries = []; state.nextIndex = 0;
    state.records = Array.isArray(day.records) ? day.records.map(function (record) { return Object.assign({}, record); }) : [];
    state.errors = Array.isArray(day.errors) ? day.errors.slice() : []; state.pendingNames = {}; state.pendingNiches = {}; dom.processDate.value = day.date;
    state.aggregates = aggregateRecords(); renderAll(); navigate("summary"); showToast("Открыта сводка за " + formatDate(day.date) + ".");
  }
  function exportHistory() {
    if (!state.history.length) { showToast("История пока пуста."); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), days: state.history }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "kaspi-waybill-history-" + todayLocal() + ".json"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }
  async function importHistory(event) {
    const file = event.target.files && event.target.files[0]; event.target.value = ""; if (!file) return;
    try {
      const payload = JSON.parse(await file.text()), days = Array.isArray(payload) ? payload : payload.days;
      if (!Array.isArray(days)) throw new Error("В JSON не найден массив days");
      const byDate = new Map(state.history.map(function (day) { return [day.date, day]; }));
      days.forEach(function (day) { if (day && /^\d{4}-\d{2}-\d{2}$/.test(day.date)) byDate.set(day.date, day); });
      state.history = Array.from(byDate.values()).sort(function (a, b) { return b.date.localeCompare(a.date); }); writeStorage(STORAGE.history, state.history); renderHistory(); renderSettings(); showToast("История импортирована.");
    } catch (error) { showToast("Не удалось импортировать JSON: " + error.message); }
  }

  function bindSettings() {
    dom.weekdayPicker.addEventListener("click", function (event) {
      const button = event.target.closest("[data-weekday]"); if (!button) return;
      const day = Number(button.dataset.weekday), current = new Set(state.settings.workdays || []);
      if (current.has(day)) current.delete(day); else current.add(day);
      state.settings.workdays = Array.from(current); writeStorage(STORAGE.settings, state.settings); renderSettings();
    });
  }
  function renderSettings() {
    const workdays = new Set(state.settings.workdays || [1, 2, 3, 4, 5]);
    dom.weekdayPicker.innerHTML = WEEKDAYS.map(function (day) { return '<button class="weekday-button' + (workdays.has(day.value) ? " active" : "") + '" type="button" data-weekday="' + day.value + '">' + day.label + "</button>"; }).join("");
    dom.storageDays.textContent = state.history.length; dom.storageNamingRules.textContent = Object.keys(state.namingRules).length; dom.storageNicheRules.textContent = Object.keys(state.nicheRules).length;
  }

  function topMapEntry(map) { let top = { name: "", value: 0 }; map.forEach(function (value, name) { if (value > top.value) top = { name: name, value: value }; }); return top; }
  function readStorage(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_error) { return fallback; } }
  function writeStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { showToast("Не удалось сохранить данные в браузере: " + error.message); } }
  function showToast(message) { dom.toastBody.textContent = message; if (window.bootstrap && window.bootstrap.Toast) window.bootstrap.Toast.getOrCreateInstance(dom.appToast, { delay: 4400 }).show(); }
  function pause(milliseconds) { return new Promise(function (resolve) { window.setTimeout(resolve, milliseconds); }); }
  function withTimeout(promise, milliseconds, message) { return new Promise(function (resolve, reject) { const timer = window.setTimeout(function () { reject(new Error(message)); }, milliseconds); Promise.resolve(promise).then(function (value) { window.clearTimeout(timer); resolve(value); }, function (error) { window.clearTimeout(timer); reject(error); }); }); }
  function baseName(path) { return String(path || "").split("/").pop(); }
  function todayLocal() { const now = new Date(), offset = now.getTimezoneOffset() * 60000; return new Date(now.getTime() - offset).toISOString().slice(0, 10); }
  function formatDate(date) { return date ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(date + "T12:00:00")) : "Дата не выбрана"; }
  function formatWeight(value) { if (!Number.isFinite(value)) return "—"; return value < 1 ? Math.round(value * 1000) + " г" : value.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " кг"; }
  function formatBytes(bytes) { if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б"; const units = ["Б", "КБ", "МБ", "ГБ"], index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))); return (bytes / Math.pow(1024, index)).toLocaleString("ru-RU", { maximumFractionDigits: index ? 1 : 0 }) + " " + units[index]; }
  function pluralize(number, one, few, many) { const value = Math.abs(number) % 100, last = value % 10; if (value > 10 && value < 20) return number + " " + many; if (last > 1 && last < 5) return number + " " + few; if (last === 1) return number + " " + one; return number + " " + many; }
  function compareText(a, b) { return String(a || "").localeCompare(String(b || ""), "ru", { sensitivity: "base" }); }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
})();
