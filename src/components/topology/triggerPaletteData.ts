/**
 * Trigger legend items for the Plan-mode palette.
 */

import type { TriggerType } from "../../schema/nodeIntegrationConfig";

export type PaletteTriggerId =
  | TriggerType
  | "human_approval"
  | "gate_1"
  | "gate_2";

export type PaletteTrigger = {
  id: PaletteTriggerId;
  label: string;
  hint: string;
  icon: string;
  /** Maps onto NodeIntegrationConfig.triggerType when applicable */
  triggerType: TriggerType;
  targetApiRoute?: string;
};

export const TRIGGER_PALETTE: PaletteTrigger[] = [
  {
    id: "webhook",
    label: "Webhook",
    hint: "Ingress HMAC / stage-enter",
    icon: "⚡",
    triggerType: "webhook",
    targetApiRoute: "/api/webhooks/ghl",
  },
  {
    id: "manual_drag",
    label: "Manual Drag",
    hint: "Sales advances CRM card",
    icon: "✋",
    triggerType: "manual_drag",
  },
  {
    id: "clover_payment",
    label: "Clover Payment",
    hint: "Showroom terminal deposit",
    icon: "💳",
    triggerType: "clover_payment",
    targetApiRoute: "/api/webhooks/qbo",
  },
  {
    id: "polling",
    label: "Polling",
    hint: "Scheduled sync / reconcile",
    icon: "🔄",
    triggerType: "polling",
  },
  {
    id: "human_approval",
    label: "Human Approval",
    hint: "Requires human sign-off",
    icon: "✓",
    triggerType: "manual_drag",
  },
  {
    id: "gate_1",
    label: "Gate 1",
    hint: "07.S Client Approval → MO",
    icon: "①",
    triggerType: "webhook",
    targetApiRoute: "/api/webhooks/ghl",
  },
  {
    id: "gate_2",
    label: "Gate 2",
    hint: "Delivered → QBO invoice",
    icon: "②",
    triggerType: "webhook",
    targetApiRoute: "/api/webhooks/katana",
  },
];
