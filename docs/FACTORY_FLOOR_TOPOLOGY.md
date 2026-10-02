# Factory Floor Topology — Parallel Tracks & Convergence

**Status:** Owner lock (2026-09)  
**Code SSOT:** [`src/lib/factory-routing/resources.ts`](../src/lib/factory-routing/resources.ts)  
**SMV math:** [`src/lib/factory-routing/smv-baselines.ts`](../src/lib/factory-routing/smv-baselines.ts)  
**Research:** [`docs/Research Files/Build_Time_Estimates.md`](./Research%20Files/Build_Time_Estimates.md)

The factory runs **two parallel manufacturing tracks** that converge at Final Assembly for finished goods (`FIN-*`). Specialty stone work runs on a third specialty cell.

```
┌───────────────────────────── 1st FLOOR (METAL) ─────────────────────────────┐
│  Metal Cutting ──► FAB POD A/B/C ──► Sandblast ──► Powder Booth ──► Cure   │
│   (feeder)         (tack/weld/grind)              (active)         (passive)│
└───────────────────────────────────────────┬─────────────────────────────────┘
                                            │
┌───────────────────────────── 2nd FLOOR (UPHOLSTERY) ────────────────────────┐
│  Fabric Cutting ──► Sewing Line ──► Stuffing/Foam ──► Upholstery QC & Xfer │
└───────────────────────────────────────────┬─────────────────────────────────┘
                                            │
                                            ▼
                              ┌─────────────────────────┐
                              │   FINAL ASSEMBLY (FIN-*) │
                              │  Final QC → Assemble/Pack│
                              └─────────────────────────┘

Specialty (as needed):  Dekton Fabrication (34.5 SMV)
```

---

## 1. Metal Track (1st Floor) → `STANDARD_TRACKS.aluminum_frame`

Applies to producible frame parents: `ASM-*-FRAME` / `SA-*-FRAME`.

| Seq | Resource | Floor label | Run (min) | Source |
| ---: | --- | --- | ---: | --- |
| 10 | `Metal Cutting` | Cold Saw Fabrication | **6.9** | Research SMV (8 cuts × 0.86) |
| 20 | `FAB POD A` | Fabrication & Welding | **76.3** | Weld 55.9 + Grind 20.4 |
| 30 | `Sandblasting` | Sandblast | 20 (placeholder) | Out of IE study |
| 40 | `Powder Coating Booth` | Powder Coat (active labor) | **13.8** | Research active labor only |
| 50 | `Curing Oven` | Cure (passive oven) | **20.0** | Machine dwell — not labor |

**Fab pods A / B / C** are capacity-equivalent physical cells (same operation name `Fabrication & Welding`). The Standard Track defaults to **FAB POD A**; managers may reassign a row to B or C without changing the SMV.

**Not on this track:** Final QC and Pack — those live on Final Assembly after metal and upholstery converge.

---

## 2. Upholstery Track (2nd Floor) → `STANDARD_TRACKS.cushion`

Runs **simultaneously** with the metal track. Applies to `ASM-*-CUSH` / `SA-*-CUSH`.

| Seq | Resource | Floor label | Run (min) | Source |
| ---: | --- | --- | ---: | --- |
| 10 | `Fabric Cutting` | Fabric Cut | **~2.9** | 2.5 × 1.15 |
| 20 | `Fabric Sewing` | Sew | **~13.8** | (4.5+2.5+5.0) × 1.15 |
| 30 | `Cushion Stuffing` | Stuff | **~4.0** | 3.5 × 1.15 |
| 40 | `Quality Control` | Upholstery QC & Transfer | 8 (placeholder) | Transfer to staging |

Full box-cushion SAM = **20.7** minutes (research).

---

## 3. Convergence — Final Assembly → `STANDARD_TRACKS.final_assembly`

When powdered frames and completed cushions meet at staging, **Final Assembly** owns the Finished Good (`FIN-*`):

| Seq | Resource | Floor label | Run (min) | Notes |
| ---: | --- | --- | ---: | --- |
| 10 | `Quality Control` | Final QC | 8 (placeholder) | Visual / fit before ship |
| 20 | `Assembly & Packaging` | Assemble & Pack | 15 (+5 setup) | Hardware, marry components, pack |

Do **not** duplicate full metal or upholstery routings onto `FIN-*`. Children own their floor tracks; FIN owns convergence only.

---

## 4. Specialty — Dekton → `STANDARD_TRACKS.dekton_top`

| Seq | Resource | Floor label | Run (min) |
| ---: | --- | --- | ---: |
| 10 | `Dekton Fabrication` | Dekton Fabrication | **34.5** |

Used for sintered-stone tops / producible stone SAs. Parallel specialty cell — not part of the metal feeder line.

---

## 5. SKU → Track assignment (convention)

| SKU pattern | Track | Floor |
| --- | --- | --- |
| `ASM-*-FRAME` / `SA-*-FRAME` | `aluminum_frame` | 1st |
| `ASM-*-CUSH` / `SA-*-CUSH` | `cushion` | 2nd |
| Stone / Dekton SA | `dekton_top` | Specialty |
| `FIN-*` | `final_assembly` | Convergence |
| `RM-*`, `CUT-*`, colorways | none | — |

Factory UI: **Apply Aluminum Frame / Cushion / Dekton / Final Assembly Routing** on `/admin/factory-bom`.

---

## 6. Locked Katana Resources

Physical cells only (no “Heat Primer” / “Heat Powder” duplicate ovens):

**Metal / finish / convergence:**  
`Metal Cutting`, `FAB POD A`, `FAB POD B`, `FAB POD C`, `Sandblasting`, `Powder Coating Booth`, `Curing Oven`, `Quality Control`, `Assembly & Packaging`

**Upholstery:**  
`Fabric Cutting`, `Fabric Sewing`, `Cushion Stuffing`

**Stone:**  
`Dekton Fabrication`

Legacy strings (`Welding Station`, `Grinding Station`, `Building & Welding`, …) normalize onto fab pods or the feeder cell via `LEGACY_RESOURCE_ALIASES`.

---

## 7. Allowances (PF&D)

| Class | Multiplier | Used for |
| --- | ---: | --- |
| General | **1.15** | Cold saw, powder labor, sewing, CNC stone |
| Heavy fab | **1.20** | TIG weld, mechanical grinding |

Encoded in `PF_AND_D` inside `smv-baselines.ts` and locked by unit tests.

---

*Owner workflow is authoritative for sequence. Research file is authoritative for SMV arithmetic. Hub Standard Tracks must keep both aligned.*
