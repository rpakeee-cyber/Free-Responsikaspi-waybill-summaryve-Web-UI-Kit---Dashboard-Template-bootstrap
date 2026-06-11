const assert = require("assert");
const parser = require("../Theme1/assets/js/kaspi-parser.js");

const sample = [
  "954 722 539",
  "MiBaby Скребок для языка Mi-003 очиститель языка средняя 2 шт ... 1 шт.",
  "Тараз IRBIS",
  "план дата доставки: июн.14",
  "Вес: 0.08кг"
].join("\n");

const result = parser.parseWaybill(sample, "KASPI_SHOP-954722539.pdf");
assert.strictEqual(result.orderNumber, "954722539");
assert.strictEqual(result.quantity, 1);
assert.strictEqual(result.city, "Тараз");
assert.strictEqual(result.service, "IRBIS");
assert.strictEqual(result.deliveryDate, "июн.14");
assert.strictEqual(result.weightKg, 0.08);
assert.match(result.productName, /MiBaby/i);
assert.match(result.productName, /2 шт/i);
assert.strictEqual(result.niche, "Красота / уход");

const lego = parser.parseWaybill(
  "123 456 789\nКонструктор LEGO 1000 деталей — 1 шт.\nАлматы",
  "KASPI_SHOP-123456789.pdf"
);
assert.strictEqual(lego.quantity, 1);
assert.strictEqual(lego.city, "Алматы");
assert.strictEqual(lego.niche, "Детские товары");

const fallback = parser.parseWaybill(
  "Заказ\nУниверсальный органайзер для кухни\nКостанай",
  "KASPI_SHOP-987654321.pdf"
);
assert.strictEqual(fallback.orderNumber, "987654321");
assert.strictEqual(fallback.quantity, 1);
assert.strictEqual(fallback.city, "Костанай");

const alias = parser.parseWaybill(
  "777 888 999\nКабель USB-C 2 м x 3\nНур-Султан",
  "test.pdf"
);
assert.strictEqual(alias.quantity, 3);
assert.strictEqual(alias.city, "Астана");
assert.strictEqual(alias.niche, "Электроника");

console.log("Parser tests passed");
