export const PRODUCE_FACTORY_ORDER_STAGE = "Produce Factory Order";

export function factoryStageIdsFromEnv(
  raw: string | undefined = process.env.GHL_FACTORY_STAGE_IDS,
): string[] {
  return (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function isProduceFactoryOrderStage(
  input: { stageName?: string | null; pipelineStageId?: string | null },
  stageIds: string[] = factoryStageIdsFromEnv(),
): boolean {
  const name = input.stageName?.trim() ?? "";
  if (name === PRODUCE_FACTORY_ORDER_STAGE) return true;
  const id = input.pipelineStageId?.trim() ?? "";
  return id.length > 0 && stageIds.includes(id);
}
