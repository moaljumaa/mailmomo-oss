import { format, isToday, isYesterday, isThisYear, differenceInCalendarDays } from "date-fns";

export function shortTime(unix: number): string {
  const d = new Date(unix * 1000);
  if (isToday(d)) return format(d, "p");
  if (isYesterday(d)) return "Yesterday";
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, "EEE");
  if (isThisYear(d)) return format(d, "MMM d");
  return format(d, "MMM d, yyyy");
}
export function longTime(unix: number): string {
  return format(new Date(unix * 1000), "EEE, MMM d, yyyy 'at' p");
}
export function untilLabel(unix: number): string {
  const d = new Date(unix * 1000);
  if (isToday(d)) return `today ${format(d, "p")}`;
  return format(d, "EEE, MMM d · p");
}
export function initials(name: string, addr: string): string {
  const n = (name || addr).replace(/[<>"]/g, "").trim();
  const parts = n.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[1][0] : "")).toUpperCase();
}
export function hue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export function displayName(name: string, addr: string): string {
  return name?.trim() || addr.split("@")[0] || addr;
}
