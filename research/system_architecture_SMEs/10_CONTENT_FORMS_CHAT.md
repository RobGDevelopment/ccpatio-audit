# 10 — Content, Forms & Chat SME

**Domain:** ACF · Gravity Forms · Zapier bridge · Podium · PDF Embedder · Dynamic QR  
**Site:** https://www.ccpatio.com  
**Evidence baseline:** Site Health dump `2026-09-18T12:45:48Z`  

---

## Component Identity & Versioning

| Component | Vendor | Version | Auto-updates | Role |
|-----------|--------|---------|--------------|------|
| Advanced Custom Fields (Free) | WP Engine | **6.8.10** | (org updates) | Custom fields — **5 UI field groups** |
| Gravity Forms | Gravity Forms | **3.1.2** | **Enabled** | Forms / lead capture |
| Gravity Forms Zapier Add-On | Gravity Forms | 4.5.1 | Disabled | Automation egress |
| Podium | Podium | 2.0.9 | Enabled | Messaging / chat |
| PDF Embedder | PDF Embedder | 5.0.2 | Disabled | Inline PDF viewing |
| Dynamic QR Code | SOSidee.com srl | 1.0.1 | Disabled | QR code generation |

### ACF detail from Site Health `acf` section

| Item | Value |
|------|-------|
| Plugin type | Free |
| UI field groups | 5 |
| PHP/JSON field groups | 0 / 0 |
| REST field groups | 0 |
| Post types enabled | true |
| UI post types / taxonomies | 0 |
| JSON save/load paths | 1 / 1 |
| Shortcode enabled | false |
| AI enabled | false |

### EOL / support

- ACF Free vs Pro: Free limits some field types; 5 field groups suggests selective structured content.  
- Gravity Forms auto-updates enabled — good for security, risky mid-incident.  
- Podium auto-updates enabled.

---

## LLM SME Directive

```text
YOU ARE THE SUBJECT MATTER EXPERT FOR CONTENT MODELING, FORMS, AND CHAT CONVERSION SURFACES
ON www.ccpatio.com.

You own ACF field group mechanics, Gravity Forms entry write paths, Zapier egress, Podium
chat, and document embedding — especially under YITH catalog-mode commerce where forms/chat
may BE the conversion path.

MANDATORY BEHAVIORS:
1. Assume catalog-mode retail may route “buy intent” into GF/Podium rather than checkout —
   still treat those endpoints as production-critical.
2. Model GF submits as synchronous DB writes + optional Zapier HTTP — protect against spam
   floods during campaigns.
3. Keep PDF Embedder + large PDFs in mind for bandwidth and Imagick/Ghostscript interactions.
4. Do not store secrets in ACF UI; note JSON save paths exist — encourage versioned ACF JSON
   in repo for portability.
5. Coordinate cache exclusions: form confirmation pages, query-string thank-you URLs must
   bypass NitroPack/CF HTML cache.
6. Freeze new form→Zap complexity until 522 gate clears.

FORMS SME FORBIDDEN:
- Caching POST endpoints.
- Ignoring Zapier retry storms after origin outages.
```

---

## Architectural Role

This layer captures **intent and structured content** when the storefront is not a pure self-serve checkout funnel:

- ACF extends product/page schemas beyond Woo attributes  
- Gravity Forms collects quotes, contact, trade applications, configuration requests  
- Zapier fans those entries into CRM/ops tools  
- Podium provides real-time conversational sales  
- PDF Embedder surfaces catalogs/tear sheets  
- QR codes bridge physical showroom ↔ digital PDPs  

Under instability, **lost form entries / chat failures** are revenue defects equal to storefront 522s.

---

## Deep Technical Mechanics

### 1. ACF Free field groups

ACF attaches meta to posts/products. Render cost:

- Extra `get_post_meta` / ACF API calls on PDPs  
- Admin edit complexity  

With Elementor, ACF values often appear inside dynamic tags — coupling builder + meta.

JSON save/load paths = 1 each ⇒ some versioning intent exists; SME should confirm repo sync.

### 2. Gravity Forms lifecycle

1. Render form (shortcode/block/Elementor widget)  
2. Client validation + honeypot/captcha (unknown config)  
3. POST to WP  
4. Create entry rows + maybe files to uploads  
5. Notifications via WP Mail SMTP  
6. Zapier add-on fires  

**Cache note:** GET pages containing forms can be HTML-cached if GET; confirm forms still submit to uncached admin-ajax or REST endpoints correctly after NitroPack DOM changes.

### 3. Zapier add-on mechanics

Outbound HTTPS on submission. If origin is slow, users may double-submit; Zapier may receive duplicates — CRM hygiene issue.

After 522 incidents, Zapier task histories may show failures needing replay.

### 4. Podium widget

Mostly front-end JS + SaaS. Risks:

- Main-thread weight  
- Privacy/consent  
- Marketing attribution clashes with Site Kit  

Inbound message webhooks to WP are product-dependent — verify if used.

### 5. PDF Embedder + Ghostscript/ImageMagick

PDF viewing may use JS viewers and/or server-side previews. Large brochure PDFs in uploads contribute to **43.69 GB** and bandwidth spikes when uncached.

### 6. Dynamic QR Code

Generates QR images linking to URLs. Low origin risk unless bulk-generating; ensure target URLs use canonical www host.

---

## Interdependencies & Communication Flow

```text
User intent
  → Elementor/Astra page with GF or Podium
  → (optional) ACF-driven content
  → GF POST → MariaDB entries
  → WP Mail SMTP notification
  → Zapier → external CRM
Parallel: Podium SaaS chat
Parallel: PDF assets from uploads
```

### Upstream

Page builders, catalog mode CTAs, marketing campaigns.

### Downstream

MariaDB, SMTP provider, Zapier, Podium cloud, uploads.

---

## Current Known State vs. Critical Vulnerabilities

### Known state

- ACF Free with 5 field groups  
- GF 3.1.2 + Zapier add-on  
- Podium active  
- PDF + QR utilities active  

### Critical vulnerabilities

1. **Conversion path dependency** on forms/chat during catalog mode.  
2. **Spam/doublesubmit** under slow origin.  
3. **Zapier failure recovery** not documented.  
4. **Cached thank-you / form pages** risk.  
5. **Large PDF bandwidth**.  
6. **ACF+Elementor meta cost** on PDPs.  
7. Auto-updates on GF/Podium mid-incident.

---

## Verified vs. Claimed Discrepancies

| Statement | Class |
|-----------|-------|
| Components/versions above active | **Verified** |
| Exact form IDs, Zapier zaps, Podium account mapping | **Unknown** |
| Forms replace checkout as primary conversion | **Inferred risk** from YITH presence — confirm |
| ACF field group definitions exported to git | **Unknown** |

---

## Forms/chat stability checklist

- [ ] Form confirmation URLs excluded from HTML cache  
- [ ] Spam protection enabled (CAPTCHA/Turnstile)  
- [ ] Zapier failure runbook exists  
- [ ] SMTP provider proven delivering  
- [ ] Podium widget deferred / non-blocking  
- [ ] PDF sizes budgeted / CDN cached  
- [ ] ACF JSON in version control  

---

## Cross-references

- Catalog mode → `05_ECOMMERCE_ENGINE_WOOCOMMERCE.md`  
- Zapier/SMTP → `08_THIRD_PARTY_APIS_INTEGRATIONS.md`  
- Uploads/PDFs → `09_DATA_MEDIA_STORAGE.md`  
- Builder embedding → `06_PAGE_BUILDERS_FRONTEND.md`
