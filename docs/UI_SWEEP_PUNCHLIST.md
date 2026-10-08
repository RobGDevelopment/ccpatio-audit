# Master Catalog UI Sweep Punch List

**Status:** Proposed. Not authorized for implementation.
**Date:** 2026-10-05
**Source review:** `docs/MASTER_CATALOG_UI_UX_POLISH_GUARDRAILS.md` against the Product Owner’s 12-point visual list.
**Method:** Source inspection of the live drawer, grids, catalog queries, and tear-sheet generator. No application code in this pass.

Eight of the twelve points are certified in the review that accompanies this file. Do not rebuild them. The four items below are the only remaining work.

---

## P1 — Product name helper is one clause short

**Point 2.** Incomplete copy, not a missing field.

`NewProductDrawer` already removes the lounge-chair placeholder and shows:

```text
Customer-facing Display Name (e.g., 'Bravada Armless Sofa 34"').
```

The requested sentence is:

```text
Customer-facing Display Name used on the website and tear sheets (e.g., 'Bravada Armless Sofa 34"').
```

Change that one string in `src/app/embed/admin/master-catalog/ecommerce/NewProductDrawer.tsx`. The edit drawer has no product-name input; the name is the drawer title. Do not add a second name field.

---

## P2 — SKU token picker does not show meanings

**Point 3.** The dictionary is real. The control is not a combobox.

What already works, and must stay:

- Options come from `getDictionaries()`: active `nomenclature_sku_tokens` rows unioned with token suffixes parsed from live `3P-` SKUs.
- Typing is uppercased to `A-Z0-9-`.
- Blur inserts a new row through `createDictionaryCode("token", ...)`.
- Reserved codes `FIN`, `FAB`, `MIS`, `RM`, `PWD`, `3P`, `ASM`, `SA` and prefixes `RM-`, `PWD-`, `FAB-`, `ASM-`, `SA-` are rejected on the server.

What fails the visual review:

- The control is a native `<input list="token-options">` in `NewProductDrawer.tsx`. Browser datalists show the value. They do not reliably show the option label, so `BLK — Black` never appears as a choice.
- A custom token is saved with `label` equal to the code (`createDictionaryCode("token", token, token)`). The next operator still sees no meaning.

Replace the datalist with a visible combobox:

- Each row shows `code` and `label` when they differ.
- The operator can commit a code that is not in the list.
- A new code asks for a meaning before insert. Do not store the code as its own label.
- Keep the reserved-code rejection and the mint shape `3P-{collection}-{category}-{token}`.

---

## P3 — Extract from CAD is on Details, not Freight

**Point 6.** The extractor is done. The Freight tab cannot reach it.

Certified behavior, do not rewrite:

- `extractCadDimensions` loads the latest `cad_uploads` row with `ext = dae` and `status = draft_ready`.
- It uses the existing Collada walker (`parseDaeWeldmentFromXml`) and writes `finished_goods_catalog.length`, `.depth`, and `.height` in inches.
- `.skp` is not parsed. The button stays disabled unless that `.dae` exists, with title `Upload a .dae file to extract dimensions.`
- It does not write `catalog_ship_profiles`. Freight changes only when the operator clicks **Apply display dimensions** or saves the freight form.

Gap:

- The button labeled `[Extract from CAD]` is in the Details hub header of `ProductDrawer.tsx`. The Freight tab renders `FreightPanel` from `ListingContentPanels.tsx` with only `globalSku`. It does not receive display length, depth, height, or weight, so **Apply display dimensions** cannot appear on that tab.
- The new-product Freight tab has the same split: extract is absent there, and height and weight are passed as empty strings.

Put **Extract from CAD** on the Freight tab of both drawers. Pass the current display dimensions into that `FreightPanel`. Leave the Details copy of the button, or remove it, but the Freight tab must be able to extract and then apply. Do not write the bounding box straight into the ship profile.

---

## P4 — Tear sheet is a text page, and the catalog action is a toast

**Point 8.** This is the visual gap called out in the review.

### Catalog menu does nothing

`handleTearSheets` in `src/app/embed/admin/master-catalog/page.tsx` closes the menu and toasts `Tear sheet PDF generation coming soon`. The menu label is **Generate Tear Sheets (PDF)**. It does not call `generateTearSheetPdf`.

### Drawer download is a stacked text list

`src/server/pim/tear-sheet.ts` does load the right facts: product name, SKU, collection, display dimensions, steel and aluminum MSRP, marketing copy, and the current primary image (rejected under 1200px). Wholesale cost is correctly absent.

The page is still a memo:

- 22pt title, then gray SKU line, then a “Dimensions” heading and one pipe-separated line (`L | D | H | AH | SH`), then a “Pricing” heading, then a “Description” heading and wrapped plain text.
- The hero image is drawn after the full description. A long story pushes it into the footer or off the letter page.
- There is no image-led client layout, no spec block, and no price treatment a customer would recognize as a tear sheet.

### Required result

One letter page per finished good:

- Primary image large enough to identify the product, not an afterthought under the copy.
- Marketing copy as the customer paragraph.
- Dimensions as a short spec block (length, depth, height, and arm or seat height only when they are not N/A).
- MSRP. Manufactured goods show steel and aluminum when both exist. Third-party goods show the retail price. Never wholesale, vendor cost, or hub `base_cost`.
- Existing gates stay: no hero, hero under 1200px, or missing marketing copy omits that SKU with a reason. Do not emit a blank page.

Wire **Generate Tear Sheets (PDF)** to that same page, one page per visible finished good, and return the omission list in the UI instead of `alert`. The drawer download uses the same renderer.

Hub-only products have no `ecommerce_listings` row. The generator currently returns “Product data incomplete” for them, while the drawer still shows the download icon. Either hide the action in hub-only mode or say why that SKU was omitted. Do not invent a listing row to print a sheet.

---

## Explicitly not in this punch list

| Point | Verdict |
| --- | --- |
| 1 Collection placeholder | Certified. Exact string `Enter 2-4 letter code (e.g., BRV)`. |
| 4 Row opens the drawer | Certified, including hub-only when no listing exists. |
| 5 Red / amber / green | Certified on the catalog grid edge and the web-visible toggle, and on the e-commerce row edge. |
| 7 Raw materials banned | Certified in SQL on both catalog queries. |
| 9 Wholesale warning | Certified. Exact rose sentence under both wholesale inputs. |
| 10 Sale price and end | Certified on the Details listing block. There is no tab named Commerce. |
| 11 Locked collection and category | Certified. Codes are gray and padlocked after mint. The customer-facing collection name stays editable. |
| 12 Public publish warning | Certified. Save is intercepted; the server requires `publishConfirmed`. |

Do not start this punch list until it is approved. Do not fold it into the financial pipeline.
