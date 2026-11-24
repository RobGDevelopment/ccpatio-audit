import {
  resolveCloverApiBase,
  resolveCloverBearerToken,
} from "@/server/integrations/clover/credentials";

export async function fetchCloverOrder(merchantId: string, paymentId: string) {
  const baseUrl = resolveCloverApiBase();
  const token = resolveCloverBearerToken();
  if (!token) {
    throw new Error("Missing CLOVER_MERCHANT_TOKEN / CLOVER_API_TOKEN");
  }

  // 1. Fetch the payment to find the linked orderId
  const paymentRes = await fetch(
    `${baseUrl}/v3/merchants/${merchantId}/payments/${paymentId}?expand=order`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!paymentRes.ok) {
    throw new Error(`Clover Payment Fetch failed: ${paymentRes.statusText}`);
  }

  const paymentData = await paymentRes.json();
  const orderId = paymentData.order?.id;

  if (!orderId) {
    throw new Error(`Clover Payment ${paymentId} has no linked order`);
  }

  // 2. Fetch the order with line items expanded
  const orderRes = await fetch(
    `${baseUrl}/v3/merchants/${merchantId}/orders/${orderId}?expand=lineItems`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!orderRes.ok) {
    throw new Error(`Clover Order Fetch failed: ${orderRes.statusText}`);
  }

  return await orderRes.json();
}
