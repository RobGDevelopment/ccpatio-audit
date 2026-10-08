const clientId = process.env.FEDEX_SANDBOX_CLIENT_ID;
const clientSecret = process.env.FEDEX_SANDBOX_CLIENT_SECRET;
const apiBase = process.env.FEDEX_API_BASE;

if (!clientId || !clientSecret || !apiBase) {
  console.error("Missing required environment variables:");
  if (!clientId) console.error("- FEDEX_SANDBOX_CLIENT_ID");
  if (!clientSecret) console.error("- FEDEX_SANDBOX_CLIENT_SECRET");
  if (!apiBase) console.error("- FEDEX_API_BASE");
  process.exit(1);
}

async function verify() {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);

    const response = await fetch(`${apiBase}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await response.json();

    if (response.ok) {
      if (data.access_token) {
        data.access_token = "***MASKED***";
      }
      console.log("Sandbox Auth Successful. FedEx portal requirement met.");
      console.log("Response data:", data);
    } else {
      console.error("Failed to authenticate with FedEx sandbox:", data);
    }
  } catch (error) {
    console.error("Error verifying FedEx sandbox:", error);
  }
}

verify();
