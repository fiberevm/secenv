const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

export function formatDateTime(ms: number): string {
  return dateTime.format(new Date(ms));
}

export function timeAgo(ms: number): string {
  const seconds = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 86_400 * 30) return relative.format(Math.round(seconds / 86_400), "day");
  return dateTime.format(new Date(ms));
}

export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function pluralize(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
