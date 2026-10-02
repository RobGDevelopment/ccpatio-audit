/**
 * Google Apps Script — Extract Sunbrella fabric names from the active Google Doc
 * and overwrite a target Google Sheet with a single "Fabric Name" column.
 *
 * Setup:
 * 1. Open the Google Doc that contains the fabric list (and images).
 * 2. Extensions → Apps Script → paste this file.
 * 3. Set TARGET_SPREADSHEET_ID (and optional TARGET_SHEET_NAME) below.
 * 4. Run extractFabricNamesToSheet(). Authorize Document + Spreadsheet access when prompted.
 *
 * Fabric name rules (from CC Patio Core Sunbrella Fabric Colors):
 * - Entirely uppercase letters / digits / spaces
 * - Optional trailing parenthetical code, e.g. (C) or (P)
 * - Examples: CABANA CLASSIC | CASSAVA CORAL (C) | CHARTRES SILK (P)
 * - Images and empty / mixed-case paragraphs are ignored
 */
var TARGET_SPREADSHEET_ID = "PASTE_GOOGLE_SHEET_ID_HERE";
/** Leave blank to use the first sheet in the spreadsheet. */
var TARGET_SHEET_NAME = "";

/**
 * Full-line fabric name: UPPERCASE words, optional (CODE) suffix.
 * Allows an optional space before the parenthetical (METAMORPHIC SAND(C) vs SAND (C)).
 */
var FABRIC_NAME_LINE =
  /^[A-Z][A-Z0-9]*(?:\s+[A-Z0-9]+)*(?:\s*\([A-Z0-9]+\))?\s*$/;

/**
 * Global matcher for one or more fabric names stuck in a single paragraph
 * (e.g. "CHARTRES SILK (P)CRUSH ASH (C)").
 */
var FABRIC_NAME_TOKEN =
  /[A-Z][A-Z0-9]*(?:\s+[A-Z0-9]+)*(?:\s*\([A-Z0-9]+\))?/g;

/**
 * Entry point: active Doc → extract uppercase fabric names → overwrite Sheet.
 */
function extractFabricNamesToSheet() {
  if (
    !TARGET_SPREADSHEET_ID ||
    TARGET_SPREADSHEET_ID.indexOf("PASTE_") === 0
  ) {
    throw new Error(
      "Set TARGET_SPREADSHEET_ID to your Google Sheet ID before running.",
    );
  }

  var doc = DocumentApp.getActiveDocument();
  var paragraphs = doc.getBody().getParagraphs();
  var names = [];
  var seen = {};

  for (var i = 0; i < paragraphs.length; i++) {
    var raw = paragraphs[i].getText();
    if (!raw) continue;

    var line = String(raw).replace(/\u00A0/g, " ").trim();
    if (!line) continue;

    // Ignore any paragraph that still has lowercase (body copy, captions, etc.)
    if (/[a-z]/.test(line)) continue;

    var matches = [];
    if (FABRIC_NAME_LINE.test(line)) {
      matches.push(normalizeFabricName(line));
    } else {
      // Fallback: pull discrete UPPERCASE tokens out of a glued line
      var token;
      FABRIC_NAME_TOKEN.lastIndex = 0;
      while ((token = FABRIC_NAME_TOKEN.exec(line)) !== null) {
        var candidate = normalizeFabricName(token[0]);
        if (FABRIC_NAME_LINE.test(candidate)) {
          matches.push(candidate);
        }
      }
    }

    for (var m = 0; m < matches.length; m++) {
      var name = matches[m];
      if (!name || seen[name]) continue;
      seen[name] = true;
      names.push([name]);
    }
  }

  var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  var sheet = TARGET_SHEET_NAME
    ? ss.getSheetByName(TARGET_SHEET_NAME)
    : ss.getSheets()[0];
  if (!sheet) {
    throw new Error(
      TARGET_SHEET_NAME
        ? 'Sheet not found: "' + TARGET_SHEET_NAME + '"'
        : "Spreadsheet has no sheets.",
    );
  }

  sheet.clearContents();
  sheet.getRange(1, 1).setValue("Fabric Name");
  if (names.length > 0) {
    sheet.getRange(2, 1, names.length + 1, 1).setValues(names);
  }

  Logger.log(
    "Wrote " +
      names.length +
      ' fabric name(s) to "' +
      sheet.getName() +
      '" in spreadsheet ' +
      TARGET_SPREADSHEET_ID,
  );
}

/**
 * Collapse whitespace and normalize missing space before (CODE).
 * METAMORPHIC SAND(C) → METAMORPHIC SAND (C)
 */
function normalizeFabricName(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/([A-Z0-9])\(/g, "$1 (")
    .trim();
}
