# Kaspi Waybill Summary

## Product Goal

Build a static, browser-only dashboard that reads ZIP archives containing text-based Kaspi PDF waybills and produces a daily product summary.

## Required Constraints

- Keep `Theme1` as the visual and structural foundation.
- Preserve the admin-dashboard feel: sidebar, cards, tables, responsive layout.
- Use HTML, CSS, and vanilla JavaScript only.
- Do not add a backend or upload files to a server.
- Read ZIP files with JSZip and PDF text with PDF.js.
- Do not add OCR.
- Process PDFs in small batches and yield between batches.
- Continue after individual PDF failures and show those failures in the UI.
- Store only compact extracted records and settings in `localStorage`.
- Keep the app deployable to Netlify without a build command.
- Keep parsing logic separate from DOM/UI logic so it can be tested and extended.
- Preserve Russian UI copy and UTF-8 encoding.

## MVP Scope

1. ZIP selection and drag-and-drop.
2. Processing date selection.
3. Batched PDF text extraction with progress, stop, and resume.
4. Resilient extraction of order number, product, quantity, city, pickup service, address, delivery date, weight, and PDF filename.
5. Daily product aggregation with search, sorting, inline naming rules, and niche overrides.
6. Basic city/niche views and compact local history.

## Future Scope

- Rich day-over-day comparison.
- Weekday and Monday-specific analytics.
- Seasonality and monthly trends.
- More format-specific parsing adapters.

## Verification

- Run `node tests/parser.test.js`.
- Open `Theme1/index.html` through a local static server.
- Verify desktop and mobile layouts.
- Test a ZIP containing multiple text-based PDFs, including at least one unreadable file.
