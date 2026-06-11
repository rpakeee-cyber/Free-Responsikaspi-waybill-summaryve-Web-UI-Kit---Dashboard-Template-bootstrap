(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.KaspiParser = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CITIES = [
    "Алматы", "Астана", "Шымкент", "Караганда", "Актобе", "Тараз",
    "Павлодар", "Усть-Каменогорск", "Семей", "Атырау", "Костанай",
    "Кызылорда", "Уральск", "Петропавловск", "Актау", "Темиртау",
    "Туркестан", "Кокшетау", "Талдыкорган", "Экибастуз", "Рудный",
    "Жезказган", "Конаев", "Балхаш", "Сатпаев", "Кентау", "Риддер",
    "Жанаозен"
  ];

  const CITY_ALIASES = {
    "нур-султан": "Астана",
    "нурсултан": "Астана",
    "усть каменогорск": "Усть-Каменогорск",
    "устькаменогорск": "Усть-Каменогорск",
    "талды корган": "Талдыкорган",
    "жана озен": "Жанаозен"
  };

  const NICHES = {
    "Спорт / фитнес": [
      "спорт", "фитнес", "гантел", "эспандер", "йога", "мяч", "тренажер",
      "скакал", "турник", "протеин"
    ],
    "Красота / уход": [
      "космет", "крем", "сыворот", "маск", "шампун", "волос", "маникюр",
      "скребок", "язык", "уход", "макияж", "парфюм", "щетка"
    ],
    "Детские товары": [
      "детск", "ребен", "малыш", "игруш", "lego", "лего", "конструктор",
      "подгуз", "коляск", "бутылоч", "пелен"
    ],
    "Дом / быт": [
      "дом", "кухн", "посуда", "органайзер", "уборк", "швабр", "полотен",
      "подуш", "одеял", "контейнер", "лампа", "хранен"
    ],
    "Электроника": [
      "заряд", "кабель", "наушник", "телефон", "смартфон", "usb", "bluetooth",
      "колонк", "мыш", "клавиат", "электрон", "пылесос"
    ],
    "Авто": [
      "авто", "машин", "салон", "стеклоочист", "держатель", "шина", "руль",
      "багаж", "антифриз", "видеорегистратор"
    ],
    "Одежда": [
      "одеж", "футбол", "плать", "брюк", "носк", "куртк", "обув", "кроссов",
      "кофт", "рубаш", "белье", "шапк"
    ]
  };

  const META_LINE = /(?:план\w*\s+дата|доставк|вес\s*:|адрес\s*:|получател|отправител|штрих|накладн|заказ\s*№|итого|стоимост|телефон)/i;
  const SERVICE_PATTERN = /(?:^|[\s,;:(])(IRBIS|ПВЗ|пункт\s+выдачи|точка\s+выдачи|Kaspi\s*(?:Post|Postomat|Delivery)|постамат|курьер\w*\s+служб\w*|служба\s+доставки)(?=$|[\s,;:).])/iu;
  const QUANTITY_PATTERNS = [
    /(\d{1,4})\s*(?:шт\.?|штук(?:а|и)?|pcs?)(?=$|[\s,;:!?])/giu,
    /(?:^|[\s,;])(?:x|х|×)\s*(\d{1,4})\b/gi,
    /(\d{1,4})\s*(?:x|х|×)(?=$|[\s,;])/gi
  ];

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeKey(value) {
    return normalizeWhitespace(value)
      .toLocaleLowerCase("ru-RU")
      .replace(/[«»"'`]/g, "")
      .replace(/[–—-]+/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findOrderNumber(text, fileName) {
    const candidates = [];
    const source = normalizeWhitespace(text);
    const matcher = /(?:^|[^\d])((?:\d[\s-]?){7,12})(?=$|[^\d])/gm;
    let match;

    while ((match = matcher.exec(source))) {
      const digits = match[1].replace(/\D/g, "");
      if (digits.length >= 7 && digits.length <= 12) {
        candidates.push({
          digits,
          score: digits.length === 9 ? 5 : 1,
          index: match.index
        });
      }
    }

    const fileDigits = String(fileName || "").match(/(\d{7,12})/);
    if (fileDigits) {
      candidates.push({ digits: fileDigits[1], score: 4, index: Number.MAX_SAFE_INTEGER });
    }

    candidates.sort(function (a, b) {
      return b.score - a.score || a.index - b.index;
    });
    return candidates.length ? candidates[0].digits : "";
  }

  function findCity(text) {
    const normalized = normalizeKey(text);
    const cityCandidates = CITIES
      .map(function (city) {
        return { city, index: normalized.indexOf(normalizeKey(city)) };
      })
      .filter(function (candidate) {
        return candidate.index >= 0;
      })
      .sort(function (a, b) {
        return a.index - b.index;
      });

    if (cityCandidates.length) {
      return cityCandidates[0].city;
    }

    const alias = Object.keys(CITY_ALIASES).find(function (key) {
      return normalized.indexOf(normalizeKey(key)) >= 0;
    });
    return alias ? CITY_ALIASES[alias] : "Город не найден";
  }

  function collectQuantityCandidates(line) {
    const candidates = [];
    QUANTITY_PATTERNS.forEach(function (pattern) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line))) {
        const quantity = Number(match[1]);
        if (Number.isFinite(quantity) && quantity > 0) {
          candidates.push({
            quantity,
            start: match.index,
            end: match.index + match[0].length,
            raw: match[0].trim()
          });
        }
      }
    });

    return candidates.sort(function (a, b) {
      return a.start - b.start;
    });
  }

  function isProductLine(line) {
    const value = normalizeWhitespace(line);
    if (value.length < 4 || !/\p{L}/u.test(value)) return false;
    if (/^\D*(?:\d[\s-]?){7,12}\D*$/.test(value)) return false;
    if (META_LINE.test(value)) return false;
    return true;
  }

  function selectProductLine(lines) {
    let best = null;

    lines.forEach(function (line, index) {
      if (!isProductLine(line)) return;
      const quantities = collectQuantityCandidates(line);
      let score = Math.min(line.length, 140) / 20;
      if (quantities.length) score += 20;
      if (line.length >= 12 && line.length <= 240) score += 5;
      if (SERVICE_PATTERN.test(line)) score -= 4;
      if (CITIES.some(function (city) {
        return normalizeKey(line) === normalizeKey(city);
      })) score -= 15;

      if (!best || score > best.score) {
        best = { line, index, quantities, score };
      }
    });

    if (!best) {
      return { line: "Товар не распознан", index: -1, quantities: [], score: 0 };
    }

    if (
      best.quantities.length &&
      normalizeWhitespace(best.line.replace(QUANTITY_PATTERNS[0], "")).length < 4 &&
      best.index > 0 &&
      isProductLine(lines[best.index - 1])
    ) {
      const previous = lines[best.index - 1];
      return {
        line: previous + " " + best.line,
        index: best.index - 1,
        quantities: collectQuantityCandidates(previous + " " + best.line),
        score: best.score
      };
    }

    return best;
  }

  function cleanProductName(line, selectedQuantity, orderNumber) {
    let result = String(line || "");

    if (selectedQuantity) {
      result =
        result.slice(0, selectedQuantity.start) +
        " " +
        result.slice(selectedQuantity.end);
    }

    if (orderNumber) {
      const spaced = orderNumber.split("").join("\\s*");
      result = result.replace(new RegExp("\\b" + spaced + "\\b"), " ");
    }

    const normalizedResult = normalizeKey(result);
    let cutAt = result.length;

    CITIES.forEach(function (city) {
      const cityIndex = normalizedResult.indexOf(normalizeKey(city));
      if (cityIndex > 5) {
        const originalIndex = result.toLocaleLowerCase("ru-RU")
          .indexOf(city.toLocaleLowerCase("ru-RU"));
        if (originalIndex >= 0) cutAt = Math.min(cutAt, originalIndex);
      }
    });

    const metadataMatch = result.match(/(?:план\w*\s+дата|вес\s*:|адрес\s*:|IRBIS|ПВЗ|пункт\s+выдачи)/iu);
    if (metadataMatch && metadataMatch.index > 5) {
      cutAt = Math.min(cutAt, metadataMatch.index);
    }

    result = result
      .slice(0, cutAt)
      .replace(/\s*\.{2,}\s*/g, " ")
      .replace(/\s+[|•]\s+/g, " ")
      .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "");

    return normalizeWhitespace(result) || "Товар не распознан";
  }

  function findService(lines) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(SERVICE_PATTERN);
      if (match) return normalizeWhitespace(match[1]);
    }
    return "";
  }

  function findAddress(lines) {
    const labeled = lines.find(function (line) {
      return /\bадрес\s*:/i.test(line);
    });
    if (labeled) {
      return normalizeWhitespace(labeled.replace(/^.*?\bадрес\s*:\s*/i, ""));
    }

    const streetPattern = /(?:^|\s)(?:ул\.?|улица|пр\.?|проспект|мкр\.?|микрорайон|дом|д\.)\s*[\p{L}\d]/iu;
    const streetLine = lines.find(function (line) {
      return streetPattern.test(line);
    });
    return streetLine ? normalizeWhitespace(streetLine) : "";
  }

  function findDeliveryDate(lines) {
    const line = lines.find(function (item) {
      return /(?:план\w*.*доставк|дата\s+доставк)/i.test(item);
    });
    if (!line) return "";
    return normalizeWhitespace(
      line.replace(/^.*?(?:план\w*\s+дата\s+доставки|дата\s+доставки)\s*:?\s*/i, "")
    );
  }

  function findWeight(text) {
    const match = String(text || "").match(/(?:^|\s)вес\s*:\s*(\d+(?:[.,]\d+)?)\s*(кг|г)(?=$|[\s,;:!?])/iu);
    if (!match) return { value: null, unit: "", kg: null };
    const value = Number(match[1].replace(",", "."));
    const unit = match[2].toLocaleLowerCase("ru-RU");
    return {
      value,
      unit,
      kg: unit === "г" ? value / 1000 : value
    };
  }

  function classifyNiche(productName, nicheRules) {
    const key = normalizeKey(productName);
    if (nicheRules && nicheRules[key]) return nicheRules[key];

    const names = Object.keys(NICHES);
    for (let index = 0; index < names.length; index += 1) {
      const niche = names[index];
      if (NICHES[niche].some(function (keyword) {
        return key.indexOf(keyword) >= 0;
      })) {
        return niche;
      }
    }
    return "Другое";
  }

  function applyNamingRule(productName, namingRules) {
    const key = normalizeKey(productName);
    return namingRules && namingRules[key] ? namingRules[key] : productName;
  }

  function parseWaybill(text, fileName, options) {
    const settings = options || {};
    const normalizedText = normalizeWhitespace(text);
    const lines = normalizedText
      .split("\n")
      .map(normalizeWhitespace)
      .filter(Boolean);

    if (!normalizedText || normalizedText.length < 8) {
      throw new Error("В PDF не найден текстовый слой");
    }

    const orderNumber = findOrderNumber(normalizedText, fileName);
    const selectedLine = selectProductLine(lines);
    const selectedQuantity = selectedLine.quantities.length
      ? selectedLine.quantities[selectedLine.quantities.length - 1]
      : null;
    const rawProductName = cleanProductName(
      selectedLine.line,
      selectedQuantity,
      orderNumber
    );
    const productName = applyNamingRule(rawProductName, settings.namingRules);
    const quantity = selectedQuantity ? selectedQuantity.quantity : 1;
    const weight = findWeight(normalizedText);

    return {
      orderNumber,
      productName,
      rawProductName,
      quantity,
      city: findCity(normalizedText),
      service: findService(lines),
      address: findAddress(lines),
      deliveryDate: findDeliveryDate(lines),
      weightKg: weight.kg,
      weightLabel: weight.value === null ? "" : weight.value + " " + weight.unit,
      fileName: fileName || "",
      niche: classifyNiche(productName, settings.nicheRules),
      sourceLine: normalizeWhitespace(selectedLine.line).slice(0, 320)
    };
  }

  return {
    CITIES,
    NICHES: Object.keys(NICHES).concat("Другое"),
    normalizeWhitespace,
    normalizeKey,
    findOrderNumber,
    findCity,
    classifyNiche,
    parseWaybill
  };
});
