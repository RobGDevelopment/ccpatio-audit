/**
 * Direct REST API client for Inngest Cloud.
 * Used for Mission Control backend operations like retrying failed jobs
 * and fetching DLQ statuses, independent of the Next.js SDK handlers.
 */

const INNGEST_API_URL = "https://api.inngest.com/v1";

function getInngestApiHeaders() {
  const token = process.env.INNGEST_REST_API_TOKEN;
  if (!token) {
    throw new Error("INNGEST_REST_API_TOKEN is not configured.");
  }

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function fetchFailedPublishJobs() {
  const url = new URL(`${INNGEST_API_URL}/runs`);
  url.searchParams.set("status", "Failed");
  // Adjust this function_id to match your actual deployed Inngest function ID
  url.searchParams.set("function_id", "ccpatio-middleware-publish-approved-product");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: getInngestApiHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Inngest jobs: ${response.statusText}`);
  }

  return response.json();
}

export async function replayInngestRun(run_id: string) {
  const response = await fetch(`${INNGEST_API_URL}/runs/${run_id}/replay`, {
    method: "POST",
    headers: getInngestApiHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to replay Inngest run ${run_id}: ${response.statusText}`);
  }

  return response.json();
}
