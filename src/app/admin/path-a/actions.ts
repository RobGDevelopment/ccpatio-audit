"use server";

export async function finalizeDesignAction(input: {
  globalSku: string;
  quantity?: number;
}): Promise<{ ok: boolean; error?: string; committed?: boolean; retryable?: boolean }> {
  return { ok: false, error: "STUB_FOR_TASK_5" };
}
