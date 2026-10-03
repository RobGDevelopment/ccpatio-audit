export async function fetchCloverOrder(merchantId: string, paymentId: string) {
  const baseUrl = process.env.CLOVER_API_URL || "https://api.clover.com";
  const token = process.env.CLOVER_MERCHANT_TOKEN;

  // 1. Fetch the payment to find the linked orderId
  // Hardcoded Authorization header for Phase 1 as requested
  const paymentRes = await fetch(`${baseUrl}/v3/merchants/${merchantId}/payments/${paymentId}?expand=order`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!paymentRes.ok) {
    throw new Error(`Clover Payment Fetch failed: ${paymentRes.statusText}`);
  }

  const paymentData = await paymentRes.json();
  const orderId = paymentData.order?.id;

  if (!orderId) {
    throw new Error(`Clover Payment ${paymentId} has no linked order`);
  }

  // 2. Fetch the order with line items expanded
  const orderRes = await fetch(`${baseUrl}/v3/merchants/${merchantId}/orders/${orderId}?expand=lineItems`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!orderRes.ok) {
    throw new Error(`Clover Order Fetch failed: ${orderRes.statusText}`);
  }

  return await orderRes.json();
}
