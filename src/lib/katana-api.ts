import { ValidatedGhlPayload, KatanaManufacturingOrderResponse } from '@/types';

export async function createManufacturingOrder(payload: ValidatedGhlPayload): Promise<KatanaManufacturingOrderResponse> {
  // TODO: Implement actual Katana API integration
  // This is a mock function simulating the network delay and response
  
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        mo_id: `MO-${Math.floor(Math.random() * 10000)}`,
        status: "NOT_STARTED"
      });
    }, 1000);
  });
}
