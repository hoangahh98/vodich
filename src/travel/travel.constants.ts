export const TRAVEL_EXPENSE_CATEGORIES = ['Khách sạn', 'Ẩm thực', 'Vui chơi', 'Thể thao', 'Khám phá', 'Khác'] as const;
export const TRAVEL_SUGGESTION_CATEGORIES = ['Quán ăn ngon', 'Cà phê đẹp', 'Khách sạn tốt', 'Vui chơi', 'Khám phá', 'Thể thao', 'Khác'] as const;

export type TravelExpenseCategory = (typeof TRAVEL_EXPENSE_CATEGORIES)[number];
export type TravelSuggestionCategory = (typeof TRAVEL_SUGGESTION_CATEGORIES)[number];

export function validExpenseCategory(value: string): value is TravelExpenseCategory {
  return TRAVEL_EXPENSE_CATEGORIES.includes(value as TravelExpenseCategory);
}

export function validSuggestionCategory(value: string): value is TravelSuggestionCategory {
  return TRAVEL_SUGGESTION_CATEGORIES.includes(value as TravelSuggestionCategory);
}
