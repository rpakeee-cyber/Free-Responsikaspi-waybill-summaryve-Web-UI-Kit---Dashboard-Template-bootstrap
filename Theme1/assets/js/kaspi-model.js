(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.KaspiModel = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeProductKey(value) {
    return normalizeWhitespace(value)
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/g, "е")
      .replace(/\b(?:kaspi|shop)\b/giu, " ")
      .replace(/\bmibaby(?:\s+mibaby)+\b/giu, "mibaby")
      .replace(/[«»"'`]/g, "")
      .replace(/[–—-]+/g, " ")
      .replace(/[.,](?!\d)/g, " ")
      .replace(/(?<!\d)[.,]/g, " ")
      .replace(/[^\p{L}\p{N}\s.]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function ruleFinalName(rule) {
    if (typeof rule === "string") return rule;
    return rule && typeof rule.finalName === "string" ? rule.finalName : "";
  }

  function applyRenameRule(originalName, rules) {
    const key = normalizeProductKey(originalName);
    return ruleFinalName(rules && rules[key]) || originalName;
  }

  function createRenameRule(originalName, finalName, aliases, createdAt) {
    return {
      originalName: normalizeWhitespace(originalName),
      normalizedOriginal: normalizeProductKey(originalName),
      finalName: normalizeWhitespace(finalName),
      createdAt: createdAt || new Date().toISOString(),
      aliases: Array.from(new Set((aliases || [originalName]).map(normalizeWhitespace).filter(Boolean)))
    };
  }

  function aggregateRecords(records, options) {
    const settings = options || {};
    const namingRules = settings.namingRules || {};
    const pendingNames = settings.pendingNames || {};
    const nicheRules = settings.nicheRules || {};
    const pendingNiches = settings.pendingNiches || {};
    const classifyNiche = settings.classifyNiche || function () { return "Другое"; };
    const groups = new Map();

    (records || []).forEach(function (record, recordIndex) {
      const rawName = record.rawProductName || record.productName || "Товар не распознан";
      const rawKey = normalizeProductKey(rawName);
      const savedName = ruleFinalName(namingRules[rawKey]) || record.productName || rawName;
      const displayName = pendingNames[rawKey] || savedName;
      const displayKey = normalizeProductKey(displayName) || "unknown-" + recordIndex;
      const niche = pendingNiches[rawKey] || nicheRules[rawKey] || record.niche || classifyNiche(displayName, nicheRules);

      if (!groups.has(displayKey)) {
        groups.set(displayKey, {
          key: displayKey, name: displayName, quantity: 0, orderIds: new Set(),
          cityQuantities: new Map(), nicheCounts: new Map(), weightKg: 0,
          hasWeight: false, files: [], sourceKeys: new Set(), aliases: new Set(),
          recordIndexes: [], sources: [], manuallyVerified: false
        });
      }

      const group = groups.get(displayKey);
      const quantity = Number(record.quantity) || 1;
      const orderId = record.orderNumber || record.fileName || String(recordIndex);
      const city = record.city || "Город не найден";
      group.quantity += quantity;
      group.orderIds.add(orderId);
      group.cityQuantities.set(city, (group.cityQuantities.get(city) || 0) + quantity);
      group.nicheCounts.set(niche, (group.nicheCounts.get(niche) || 0) + 1);
      if (Number.isFinite(record.weightKg)) {
        group.weightKg += record.weightKg;
        group.hasWeight = true;
      }
      group.files.push(record.fileName || "");
      group.sourceKeys.add(rawKey);
      group.aliases.add(rawName);
      group.recordIndexes.push(recordIndex);
      group.manuallyVerified = group.manuallyVerified || Boolean(namingRules[rawKey] || pendingNames[rawKey]);
      group.sources.push({
        filename: record.fileName || "",
        orderNumber: record.orderNumber || "",
        city,
        rawProductLine: record.rawProductLine || record.sourceLine || rawName,
        textSnippet: record.textSnippet || record.sourceLine || rawName,
        quantity,
        weightKg: Number.isFinite(record.weightKg) ? record.weightKg : null,
        weightLabel: record.weightLabel || "",
        confidence: record.confidence || "medium"
      });
    });

    const values = Array.from(groups.values());
    const totalQuantity = values.reduce(function (sum, group) { return sum + group.quantity; }, 0);
    const aggregates = values.map(function (group) {
      const niche = topMapEntry(group.nicheCounts).name || "Другое";
      return {
        id: "product-" + hashKey(group.key), key: group.key, name: group.name,
        quantity: group.quantity, orders: group.orderIds.size,
        cities: Array.from(group.cityQuantities.entries()).sort(function (a, b) { return b[1] - a[1]; }).map(function (entry) { return { name: entry[0], quantity: entry[1] }; }),
        niche, weightKg: group.hasWeight ? group.weightKg : null, files: group.files,
        sourceKeys: Array.from(group.sourceKeys), aliases: Array.from(group.aliases),
        recordIndexes: group.recordIndexes, sources: group.sources,
        manuallyVerified: group.manuallyVerified, similarIds: [],
        share: totalQuantity ? (group.quantity / totalQuantity) * 100 : 0
      };
    });
    markSimilarGroups(aggregates);
    return aggregates;
  }

  function markSimilarGroups(groups) {
    for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
        const left = groups[leftIndex];
        const right = groups[rightIndex];
        if (similarity(left.name, right.name) >= 0.72) {
          left.similarIds.push(right.id);
          right.similarIds.push(left.id);
        }
      }
    }
    return groups;
  }

  function similarity(left, right) {
    const a = normalizeProductKey(left);
    const b = normalizeProductKey(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const aTokens = new Set(a.split(" "));
    const bTokens = new Set(b.split(" "));
    const intersection = Array.from(aTokens).filter(function (token) { return bTokens.has(token); }).length;
    const union = new Set(Array.from(aTokens).concat(Array.from(bTokens))).size || 1;
    return Math.max(intersection / union, diceCoefficient(a, b));
  }

  function diceCoefficient(left, right) {
    const a = bigrams(left);
    const b = bigrams(right);
    if (!a.length || !b.length) return 0;
    const counts = new Map();
    a.forEach(function (value) { counts.set(value, (counts.get(value) || 0) + 1); });
    let matches = 0;
    b.forEach(function (value) {
      const count = counts.get(value) || 0;
      if (count) { matches += 1; counts.set(value, count - 1); }
    });
    return (2 * matches) / (a.length + b.length);
  }

  function bigrams(value) {
    const compact = value.replace(/\s+/g, " ");
    const result = [];
    for (let index = 0; index < compact.length - 1; index += 1) result.push(compact.slice(index, index + 2));
    return result;
  }

  function topMapEntry(map) {
    let top = { name: "", value: 0 };
    map.forEach(function (value, name) { if (value > top.value) top = { name, value }; });
    return top;
  }

  function hashKey(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    return Math.abs(hash).toString(36);
  }

  return { normalizeProductKey, ruleFinalName, applyRenameRule, createRenameRule, aggregateRecords, markSimilarGroups, similarity };
});
