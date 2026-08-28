export interface ValidatedGhlPayload {
  projectId: string;
  customerName: string;
  sketchupCutList: string[];
}

export interface KatanaManufacturingOrderResponse {
  mo_id: string;
  status: string;
}
