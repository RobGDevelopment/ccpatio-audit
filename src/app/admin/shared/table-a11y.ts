import type { KeyboardEvent } from "react";

/** Keyboard activation for table rows acting as buttons. */
export function handleInteractiveRowKeyDown(
  event: KeyboardEvent,
  onActivate: () => void,
): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate();
  }
}

export function interactiveRowProps(
  ariaLabel: string,
  onActivate: () => void,
): {
  tabIndex: 0;
  role: "button";
  "aria-label": string;
  onKeyDown: (event: KeyboardEvent) => void;
} {
  return {
    tabIndex: 0,
    role: "button",
    "aria-label": ariaLabel,
    onKeyDown: (event) => handleInteractiveRowKeyDown(event, onActivate),
  };
}
