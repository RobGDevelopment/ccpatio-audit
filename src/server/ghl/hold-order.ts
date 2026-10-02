/** Legacy fabric freeze committed on Katana sales order MIG-HOLD-FABRIC-20260811. */
export const FABRIC_HOLD_ORDER_NO = "MIG-HOLD-FABRIC-20260811";
export const FABRIC_HOLD_ORDER_ID = 52594042;
export const CC_MANUFACTURING_LOCATION_ID = 98179;

export function ghlFactoryOrderNo(opportunityId: string): string {
  return `GHL-${opportunityId.trim()}`;
}
