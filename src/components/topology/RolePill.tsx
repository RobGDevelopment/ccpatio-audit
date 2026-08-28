"use client";

import { memo } from "react";
import {
  ROLE_CATEGORY_STYLES,
  resolveRole,
  type RoleAssignment,
} from "./roleConfig";

export function RolePill({
  nodeId,
  stageId,
  zone,
  role: roleOverride,
  compact = false,
  accent,
}: {
  nodeId: string;
  stageId?: string | null;
  zone?: string;
  role?: RoleAssignment | null;
  compact?: boolean;
  /** Parent zone district accent — overrides category palette */
  accent?: string;
}) {
  const role = roleOverride ?? resolveRole(nodeId, stageId, zone);
  if (!role) return null;

  const style = ROLE_CATEGORY_STYLES[role.category];

  if (accent) {
    return (
      <span
        className={`inline-flex max-w-full items-center truncate rounded-full border font-medium uppercase tracking-[0.1em] ${
          compact
            ? "px-1 py-px text-[7px] leading-tight"
            : "px-1.5 py-0.5 text-[8px] leading-tight"
        }`}
        style={{
          color: accent,
          borderColor: `${accent}88`,
          backgroundColor: `${accent}22`,
        }}
        title={`Role: ${role.label}`}
      >
        {role.label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-full border font-medium uppercase tracking-[0.1em] ${style.pill} ${style.text} ${style.border} ${
        compact
          ? "px-1 py-px text-[7px] leading-tight"
          : "px-1.5 py-0.5 text-[8px] leading-tight"
      }`}
      title={`Role: ${role.label}`}
    >
      {role.label}
    </span>
  );
}

export const RolePillMemo = memo(RolePill);
