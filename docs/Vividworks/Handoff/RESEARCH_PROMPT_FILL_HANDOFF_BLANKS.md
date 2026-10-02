# Research Prompt — Fill CC Patio E-Commerce Handoff Blanks

Copy everything below the line into another LLM (Claude / GPT / Gemini with web research).  
Attach [`_research_inventory.json`](_research_inventory.json) from this same folder (full FIN-* / FAB-* / STN-* lists).

When research returns, bring the **JSON blocks** back here so we can populate  
`docs/Vividworks/Handoff/Vividworks_Primeview E-Commerce Handoff.xlsx` without guessing.

---

## PROMPT (copy from here)

You are a senior outdoor-furniture merchandising + e-commerce architect assisting **CC Patio** (Scottsdale / Phoenix, Arizona). We build powder-coated aluminum outdoor furniture with **Sunbrella** cushions and optional **Cosentino Dekton** tops/sidearms. We are locking Phase 1 & 2 web SKUs for:

- **VividWorks** 3D configurator  
- **PrimeView** WooCommerce cart  
- **Katana MRP** sales orders (Master SKU = `FIN-*` only; fabric grade / fabric / powder / dekton are **line attributes**, never SKU suffixes)

Your job: deep research + **initial recommended values** for every blank field listed below so the vendor handoff spreadsheet is ~95% complete. Humans will only adjust outliers.

### Hard rules
1. Prefer **cited industry sources** (Sunbrella grade cards, Cosentino Dekton price groups, NMFC freight classes for furniture, typical AZ outdoor lead times, competitor outdoor brands: RH Outdoor, Restoration Hardware Outdoor, Frontgate, Summer Classics, Brown Jordan, Tropitone, Gloster, etc.).
2. Every numeric recommendation must include: `value`, `unit`, `confidence` (`high|medium|low`), `source` (URL or doc name), `rationale` (1–2 sentences), `needs_cc_patio_confirm` (true/false).
3. Do **not** invent new Master SKUs (`FIN-*`) or Katana `variant_id`s. You may recommend a **new fabric SKU pattern** only for `SOLVE LINEN` (missing `FAB-*`).
4. Do **not** cartesian-expand `FIN × fabric × powder × dekton`.
5. Pricing should be **USD retail upcharge / MSRP** suitable for a premium Phoenix outdoor brand (not contractor cost). Mark ranges when exact is unknown.
6. Where CC Patio already has a filled cell, treat it as ground truth and **do not overwrite** in your recommendations—only fill blanks / propose overrides labeled `override_suggestion`.
7. Return **machine-readable JSON only** for the answer sections (plus a short executive summary in prose at the top). No markdown tables inside JSON.

### Company / stack context (do not contradict)
- Sellable powders only: `PWD-BLACK`, `PWD-BONE`, `PWD-FANUC-GRAY`, `PWD-LITE-BEIGE`, `PWD-OIL-RUB-BRONZE`, `PWD-WILD-RICE`
- Fabric grades: **A–F** (A = $0 baseline)
- Dekton grades: **A–F** cart ladder, with Cosentino **price groups 0–5** as reference
- Katana attributes: `fabric_grade`, `cushion_fabric` (`FAB-*`), `powder_coat` (`PWD-*`), optional `dekton` (`STN-DKT-*`), optional `pillow`
- Typical Dekton furniture thickness: **12 mm / 20 mm** tops; **4 mm Slim** sidearms
- Attach file `_research_inventory.json` lists every product/material currently on the sheet

---

### SECTION A — Fabric grade assignments (tab 02, all 36 upholstery rows)

For each fabric in inventory `fab[]`, recommend:

```json
{
  "fabric_grades": [
    {
      "internal_id": "FAB-CAB-CLA",
      "display_name": "CABANA CLASSIC",
      "pricing_grade": "A",
      "sunbrella_collection_or_family": "",
      "content_notes": "100% solution-dyed acrylic (if known)",
      "hex_preview": "#...... or null",
      "confidence": "medium",
      "source": "",
      "rationale": "",
      "needs_cc_patio_confirm": true
    }
  ],
  "solve_linen_sku_recommendation": {
    "proposed_internal_id": "FAB-SOL-LIN",
    "display_name": "SOLVE LINEN",
    "pricing_grade": "B",
    "rationale": "",
    "confidence": "low",
    "needs_cc_patio_confirm": true
  }
}
```

Guidance: Use Sunbrella commercial grade practices; `(C)` / `(P)` suffixes on names are pattern codes, **not** price grades. Map similar Canvas / Shelter / Metamorphic families consistently.

---

### SECTION B — Dekton grade + Cosentino group (tab 02, all 70 STN-DKT-* rows)

For each item in inventory `dek[]`:

```json
{
  "dekton_grades": [
    {
      "internal_id": "STN-DKT-AT2.0",
      "display_name": "AGED TIMBER 2.0",
      "thickness_mm": 20,
      "finish_texture": "Matte",
      "series": "Cosentino / Dekton|Onirika|SilverKoast|Pietra Kode|Other",
      "cosentino_price_group": 2,
      "pricing_grade": "C",
      "application": "Tabletop / Sidearm",
      "outdoor_rated": "Y",
      "confidence": "medium",
      "source": "Cosentino Dekton price group PDF / product guide",
      "rationale": "",
      "needs_cc_patio_confirm": true
    }
  ]
}
```

Map Cosentino groups → CC Patio grades roughly: Group 0–1→A/B, 2→C, 3→D, 4→E, 5 / XGloss bookmatch→F. If a color is unknown, still guess with `confidence: low`.

---

### SECTION C — Upcharge matrix dollars (tab 03)

Recommend **flat USD retail upcharges added to Web Base Price**:

```json
{
  "upcharges": {
    "fabric_grades": { "A": 0, "B": null, "C": null, "D": null, "E": null, "F": null },
    "dekton_grades": { "A": 0, "B": null, "C": null, "D": null, "E": null, "F": null },
    "add_ons": [
      {
        "upgrade_type": "Ironwood Arms (per applicable arm)",
        "upcharge_amount_usd": null,
        "unit": "per_arm|per_set|per_item",
        "confidence": "medium",
        "source": "",
        "rationale": "",
        "needs_cc_patio_confirm": true
      }
    ]
  },
  "pricing_methodology": "Explain how you derived grade steps (e.g. % of base, fixed tiers from competitors)."
}
```

Include every add-on name we already list: Ironwood Arms, Casters (per set), Square Pillow 17x17, Square Pillow 23x23, Lumbar Pillow 12x24, Dekton Sidearm, Metal Arms upgrade, Arms, Casters, Dekton Sidearms, Fly Tables, Ironwood, Umbrella Holder, Wheels. Deduplicate synonyms (e.g. Casters vs Casters per set) with a `canonical_name` field.

---

### SECTION D — Powder finishes (tab 02, 6 powders)

```json
{
  "powders": [
    {
      "internal_id": "PWD-BLACK",
      "display_name": "BLACK POWDER",
      "hex_preview": "#1a1a1a",
      "finish_texture": "N/A",
      "pricing_grade": "A",
      "retail_upcharge_usd": 0,
      "outdoor_rated": "Y",
      "confidence": "high",
      "source": "",
      "rationale": "Baseline architectural black powder for outdoor aluminum.",
      "needs_cc_patio_confirm": false
    }
  ]
}
```

Assume all six are sellable web finishes; only recommend a non-zero powder upcharge if industry norms warrant a “premium bronze” style premium.

---

### SECTION E — Product logistics & merchandising blanks (tab 01)

For every `FIN-*` in inventory `noPrice[]` **and** generally for all 265 products where these are blank, recommend:

```json
{
  "products": [
    {
      "master_sku": "FIN-BRV-SOF-72X34",
      "product_name": "...",
      "collection": "Bravada",
      "web_base_price_usd": null,
      "msrp_aluminum_usd": null,
      "dimensions_lxwxh": "72 x 34 x 31",
      "unit_weight_lbs": null,
      "packaged_dimensions": "",
      "freight_class": "175",
      "shipping_flat_rate_usd": null,
      "lead_time": "6-8 weeks",
      "fabric_color_slot": "Y|N|N/A",
      "frame_color_slot": "Y|N|N/A",
      "dekton_color_slot": "Y|N|N/A",
      "pillow_color_slot": "Y|N|N/A",
      "add_ons": "",
      "marketing_description": "150-220 words, premium outdoor tone, Phoenix climate durability without medical claims",
      "details": "80-120 words: frame material, finish, cushion, care",
      "price_basis": "extrapolated_from_sibling|competitor_band|unknown",
      "confidence": "low",
      "source": "",
      "rationale": "",
      "needs_cc_patio_confirm": true
    }
  ]
}
```

Prioritize:
1. All rows missing **Web Base Price** (`noPrice[]` — ~154 SKUs)
2. All rows missing **weight**, **freight class**, **lead time**, **packaged dimensions**
3. Slot flags (Fabric/Frame/Dekton/Pillow) when blank — infer from product type (sofa/chair → fabric+frame+pillow; dining table → frame+dekton; etc.)
4. Marketing copy only when blank (do not rewrite filled copy)

Freight: use NMFC furniture classes typical for outdoor metal seating / tables; state assumed subclass.  
Lead time: premium made-to-order outdoor aluminum norms for US Southwest.  
Weight: estimate from category + dimensions if needed; mark confidence low.

If the full 265-product price pass is too large for one response, return:
- a **pricing model** (rules by collection + typology + size), then
- explicit prices for all `noPrice[]` SKUs, then
- apply the model to the rest as a compact `pricing_rules` JSON.

---

### SECTION F — Operational defaults (checklist / policy)

```json
{
  "ops_defaults": {
    "standard_lead_time": "",
    "rush_lead_time": "",
    "default_freight_class_seating": "",
    "default_freight_class_tables": "",
    "warranty_blurb": "",
    "care_blurb_sunbrella": "",
    "care_blurb_dekton": "",
    "pillow_vs_cushion_rule": "Pillows use same FAB-* namespace but separate Woo option / Katana pillow attribute; do not change Master SKU.",
    "confidence": "medium",
    "sources": []
  }
}
```

---

### SECTION G — Explicit out-of-scope (say “SKIP”)
- VividWorks texture asset IDs / PBR map URIs (vendors fill tab 07)
- Katana `variant_id` integers
- Actual CC Patio confidential cost sheets
- Drawing/CAD images

---

### Output order
1. Executive summary (≤200 words): biggest pricing assumptions + risk items for CC Patio to confirm  
2. JSON: `fabric_grades` + `solve_linen_sku_recommendation`  
3. JSON: `dekton_grades`  
4. JSON: `upcharges`  
5. JSON: `powders`  
6. JSON: `products` (or `pricing_rules` + `products` for noPrice set)  
7. JSON: `ops_defaults`  
8. JSON: `open_questions` — max 15 questions CC Patio must answer that research cannot

### Success criteria
A downstream engineer must be able to map each JSON field → spreadsheet cell with **no ambiguous joins** (always key by `internal_id` or `master_sku`).

## END PROMPT

---

## How to use the answer when you bring it back

Paste the JSON (or attach files) and ask:

> “Apply this research to `Vividworks_Primeview E-Commerce Handoff.xlsx`. Fill blanks only; do not overwrite existing prices/copy on tab 01. Populate tab 02 grades/Cosentino groups/hex; tab 03 upcharge $; mark checklist items DONE where filled. Show a diff summary of cell counts filled.”

---

## Snapshot of current blanks (why this prompt exists)

| Area | Gap |
|------|-----|
| Tab 02 | 0/112 pricing grades; 0 Cosentino groups; all fabric grades empty; `SOLVE LINEN` missing `FAB-*` |
| Tab 03 | Fabric B–F, Dekton B–F, and all add-ons missing `$` (A = $0 only) |
| Tab 01 | ~154 products missing Web Base Price; ~265 missing weight / freight / lead time; most missing packaged dims; many missing marketing/slot flags |
| Tab 07 | VW asset bindings intentionally empty (out of scope for research) |
