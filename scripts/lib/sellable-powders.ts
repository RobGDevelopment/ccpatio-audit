/** Sellable powder coats exposed to VividWorks / PrimeView (web configurator). */
export const SELLABLE_POWDER_IDS = [
  "PWD-BLACK",
  "PWD-BONE",
  "PWD-FANUC-GRAY",
  "PWD-LITE-BEIGE",
  "PWD-OIL-RUB-BRONZE",
  "PWD-WILD-RICE",
] as const;

export type SellablePowderId = (typeof SELLABLE_POWDER_IDS)[number];

const ALLOW = new Set<string>(SELLABLE_POWDER_IDS);

/** True when ID is not a powder, or is one of the 6 sellable powders. */
export function isVendorSafeMaterialId(internalId: string): boolean {
  const id = internalId.trim().toUpperCase();
  if (!id.startsWith("PWD-")) return true;
  return ALLOW.has(id);
}

export function isSellablePowderId(internalId: string): boolean {
  return ALLOW.has(internalId.trim().toUpperCase());
}
