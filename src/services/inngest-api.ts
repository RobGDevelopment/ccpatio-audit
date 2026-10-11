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

const HOLD_FUNCTION_IDS = [
  "send-hold-expiration-warnings",
  "auto-release-expired-holds",
  "sweep-expired-inventory-holds",
] as const;

function runsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: unknown[] }).data;
  }
  return [];
}

/** Failed hold cron runs. Does not change the catalog publish query. */
export async function fetchFailedHoldJobs(): Promise<unknown[]> {
  const lists = await Promise.all(
    HOLD_FUNCTION_IDS.map(async (functionId) => {
      const url = new URL(`${INNGEST_API_URL}/runs`);
      url.searchParams.set("status", "Failed");
      url.searchParams.set("function_id", functionId);
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: getInngestApiHeaders(),
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch Inngest jobs: ${response.statusText}`);
      }
      return runsFromPayload(await response.json());
    }),
  );
  return lists.flat();
}
