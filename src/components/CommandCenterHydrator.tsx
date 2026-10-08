import type { WorkflowStep } from "../schema/schemaTypes";

interface Props {
  initialBlueprint: WorkflowStep[];
  children: React.ReactNode;
}

export function CommandCenterHydrator({ children }: Props) {
  return <>{children}</>;
}
