/** YYYY-MM-DD in UTC. */
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (iso: string, days: number): string =>
  isoDate(new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000));

/** Formation-date window, both ends inclusive (YYYY-MM-DD). */
export interface DateWindow {
  from: string;
  to: string;
}
