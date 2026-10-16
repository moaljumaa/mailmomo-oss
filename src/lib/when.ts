/** Parse snooze/schedule expressions: ISO date, "+3h", "2d", "tomorrow", "next week", "weekend", "later today". Returns unix seconds. */
export function parseWhen(input: string, now = new Date()): number | null {
  const s = input.trim().toLowerCase();
  const at = (d: Date, h = 8) => {
    d.setHours(h, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  };
  const rel = s.match(/^\+?(\d+)\s*(m|min|h|hr|d|w)$/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const sec = unit.startsWith("m") ? 60 : unit.startsWith("h") ? 3600 : unit === "d" ? 86400 : 604800;
    return Math.floor(now.getTime() / 1000) + n * sec;
  }
  if (s === "later today" || s === "later") return Math.floor(now.getTime() / 1000) + 3 * 3600;
  if (s === "tomorrow") return at(new Date(now.getTime() + 86400_000));
  if (s === "this evening") return at(new Date(now), 18);
  if (s === "weekend" || s === "this weekend") {
    const d = new Date(now);
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    return at(d, 9);
  }
  if (s === "next week" || s === "monday") {
    const d = new Date(now);
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return at(d);
  }
  const t = Date.parse(input);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}
