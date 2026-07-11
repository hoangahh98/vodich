export const TRAVEL_SECTIONS = ['overview', 'members', 'expenses', 'places', 'settings'] as const;
export type TravelSection = (typeof TRAVEL_SECTIONS)[number];

export function safeTravelSection(value: unknown): TravelSection {
  const section = String(value || 'overview');
  return (TRAVEL_SECTIONS as readonly string[]).includes(section) ? (section as TravelSection) : 'overview';
}
