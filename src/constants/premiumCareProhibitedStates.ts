/** Primary subscriber address states where Premium Care cannot be enrolled (Step 3). */
export const PREMIUM_CARE_PROHIBITED_STATES = [
  'WA',
  'DC',
  'VT',
  'NJ',
  'PA',
  'NM',
  'CA',
  'MA',
  'RI',
  'MD',
  'MT',
  'FL',
] as const;

export const PREMIUM_CARE_STATE_UNAVAILABLE_MESSAGE =
  'Premium Care not available in your state';

export function isPremiumCareProhibitedState(state: string): boolean {
  return (PREMIUM_CARE_PROHIBITED_STATES as readonly string[]).includes(state);
}
