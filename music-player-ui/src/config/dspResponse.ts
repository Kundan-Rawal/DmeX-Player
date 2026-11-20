export function effectAmount(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return x * (1.6 - .6 * x);
}
export const vocalPresenceDb = (value: number) => 9 * Math.pow(Math.max(0, Math.min(1, value)), 3);
export const harmonicAirDb = (value: number) => 6 * Math.pow(Math.max(0, Math.min(1, value)), 2);
