export function effectAmount(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return x * (1.6 - .6 * x);
}
export const vocalPresenceDb = (value: number) => 9 * effectAmount(value);
export const harmonicAirDb = (value: number) => 6 * effectAmount(value);
