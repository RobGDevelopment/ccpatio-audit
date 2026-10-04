/**
 * Split a minted hub SKU into collection code, category code, and the remainder.
 * Collection and category codes are matched longest-first against the live
 * nomenclature dictionaries, so a hyphen inside a category or a 3P token is
 * not treated as another code boundary.
 */
export function matchHubSku(
  globalSku: string,
  collectionCodes: string[],
  categoryCodes: string[],
): { collectionCode: string; categoryCode: string; token: string } {
  const origin = globalSku.startsWith("3P-")
    ? "3P-"
    : globalSku.startsWith("FIN-")
      ? "FIN-"
      : "";
  if (!origin) return { collectionCode: "", categoryCode: "", token: "" };

  const after = globalSku.slice(origin.length);
  const cols = [...collectionCodes].filter(Boolean).sort((a, b) => b.length - a.length);
  const cats = [...categoryCodes].filter(Boolean).sort((a, b) => b.length - a.length);

  // Collection codes never contain a hyphen, so the first segment is the code
  // even when that code was minted before it was added to the dictionary.
  const collectionCode =
    cols.find((code) => after === code || after.startsWith(`${code}-`)) ||
    after.split("-")[0] ||
    "";
  if (!collectionCode) return { collectionCode: "", categoryCode: "", token: "" };

  const afterCol = after.slice(collectionCode.length + (after === collectionCode ? 0 : 1));
  const categoryCode = cats.find((code) => afterCol === code || afterCol.startsWith(`${code}-`)) ?? "";
  if (!categoryCode) return { collectionCode, categoryCode: "", token: "" };

  const token = afterCol === categoryCode ? "" : afterCol.slice(categoryCode.length + 1);
  return { collectionCode, categoryCode, token };
}
