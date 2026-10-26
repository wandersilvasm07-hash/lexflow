const dateFmt = new Intl.DateTimeFormat("pt-PT", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Lisbon",
});

const dateTimeFmt = new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Lisbon",
});

export function formatDate(iso: string | Date): string {
  return dateFmt.format(new Date(iso));
}

export function formatDateTime(iso: string | Date): string {
  return dateTimeFmt.format(new Date(iso));
}

export function isPast(iso: string | Date): boolean {
  return new Date(iso).getTime() < Date.now();
}
