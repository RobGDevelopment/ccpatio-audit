/** Calendar date in America/Phoenix, `YYYY-MM-DD`. */
export function phoenixToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
