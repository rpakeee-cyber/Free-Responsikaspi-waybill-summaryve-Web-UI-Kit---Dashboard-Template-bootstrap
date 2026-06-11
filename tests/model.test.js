const assert = require("assert");
const model = require("../Theme1/assets/js/kaspi-model.js");

const records = [
  {
    orderNumber: "111111111",
    rawProductName: "MiBaby Флоссер 50 шт",
    productName: "MiBaby Флоссер 50 шт",
    quantity: 1,
    city: "Алматы",
    niche: "Красота / уход",
    weightKg: 0.1,
    fileName: "one.pdf",
    rawProductLine: "MiBaby Флоссер 50 шт 1 шт.",
    textSnippet: "Заказ\nMiBaby Флоссер 50 шт 1 шт.\nАлматы",
    confidence: "high"
  },
  {
    orderNumber: "222222222",
    rawProductName: "Флоссер MiBaby 50 шт.",
    productName: "Флоссер MiBaby 50 шт.",
    quantity: 2,
    city: "Астана",
    niche: "Красота / уход",
    weightKg: 0.2,
    fileName: "two.pdf",
    rawProductLine: "Флоссер MiBaby 50 шт. 2 шт.",
    textSnippet: "Заказ\nФлоссер MiBaby 50 шт. 2 шт.\nАстана",
    confidence: "high"
  }
];

const firstKey = model.normalizeProductKey(records[0].rawProductName);
const renamedRules = {
  [firstKey]: model.createRenameRule(
    records[0].rawProductName,
    "Флоссеры MiBaby, упаковка 50 шт",
    [records[0].rawProductName],
    "2026-06-11T00:00:00.000Z"
  )
};

const renamed = model.aggregateRecords([records[0]], { namingRules: renamedRules });
assert.strictEqual(renamed[0].name, "Флоссеры MiBaby, упаковка 50 шт");
assert.strictEqual(renamed[0].manuallyVerified, true);
assert.strictEqual(
  model.applyRenameRule(records[0].rawProductName, renamedRules),
  "Флоссеры MiBaby, упаковка 50 шт"
);

const mergedRules = {};
records.forEach(function (record) {
  const key = model.normalizeProductKey(record.rawProductName);
  mergedRules[key] = model.createRenameRule(
    record.rawProductName,
    "Флоссеры MiBaby, упаковка 50 шт",
    records.map(function (item) { return item.rawProductName; }),
    "2026-06-11T00:00:00.000Z"
  );
});

const merged = model.aggregateRecords(records, { namingRules: mergedRules });
assert.strictEqual(merged.length, 1);
assert.strictEqual(merged[0].quantity, 3);
assert.strictEqual(merged[0].orders, 2);
assert.strictEqual(merged[0].cities.length, 2);
assert.ok(Math.abs(merged[0].weightKg - 0.3) < 1e-9);
assert.strictEqual(merged[0].sources.length, 2);
assert.strictEqual(merged[0].aliases.length, 2);

assert.strictEqual(
  model.normalizeProductKey("Kaspi Shop MiBaby MiBaby Джуди Mi010, красный"),
  "mibaby джуди mi010 красный"
);
assert.strictEqual(model.normalizeProductKey("Флоссер 1.5 м."), "флоссер 1.5 м");

console.log("Model tests passed");
