import { supabase } from '../lib/supabaseClient';
import { AppliedPromo } from '../hooks/useEnrollmentStorage';
import { getEffectivePromoPdid } from '../constants/promo';

export interface PromoCodeValidationResult {
  success: boolean;
  promo?: AppliedPromo;
  error?: string;
}

/** Escape \\, %, _ for PostgREST ilike (pattern chars). */
export function escapePromoCodeForILike(trimmed: string): string {
  return trimmed
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/** Wildcards: empty, *, ALL, ANY (case-insensitive); else product must match String(effectivePdid). */
export function promoProductAppliesToPdid(
  rowProduct: string | null | undefined,
  effectivePdid: number
): boolean {
  const raw = rowProduct == null ? '' : String(rowProduct).trim();
  if (raw.length === 0) return true;
  const u = raw.toUpperCase();
  if (u === '*' || u === 'ALL' || u === 'ANY') return true;
  const expected = String(effectivePdid);
  return raw === expected || raw.toUpperCase() === expected.toUpperCase();
}

export interface ValidatePromoCodeContext {
  /** Enrollment PDID; if missing or ≤ 0, DEFAULT_PROMO_PDID is used for product match. */
  pdid?: number;
}

export async function validatePromoCode(
  code: string,
  ctx?: ValidatePromoCodeContext
): Promise<PromoCodeValidationResult> {
  const trimmed = code?.trim() ?? '';
  if (trimmed === '') {
    return {
      success: false,
      error: 'Please enter an enrollment code',
    };
  }

  const effectivePdid = getEffectivePromoPdid(ctx?.pdid ?? 0);

  try {
    const pattern = escapePromoCodeForILike(trimmed);
    const { data: rows, error } = await supabase
      .from('promocodes')
      .select('code, product, discount_amount')
      .ilike('code', pattern)
      .eq('active', true)
      .limit(50);

    if (error) {
      console.error('Error validating promo code:', error);
      return {
        success: false,
        error: 'Error validating enrollment code. Please try again.',
      };
    }

    const row = rows?.find((r) => promoProductAppliesToPdid(r.product, effectivePdid));

    if (!rows?.length) {
      return {
      success: false,
      error: 'Invalid enrollment code',
    };
    }

    if (!row) {
      return {
        success: false,
        error: 'This enrollment code is not valid for this enrollment product',
      };
    }

    return {
      success: true,
      promo: {
        code: row.code,
        product: row.product,
        discountAmount: parseFloat(String(row.discount_amount)),
      },
    };
  } catch (err) {
    console.error('Error validating promo code:', err);
    return {
      success: false,
      error: 'Network error. Please check your connection and try again.',
    };
  }
}

export function applyPromoDiscount(
  initialPayment: number,
  appliedPromo: AppliedPromo | null
): number {
  if (!appliedPromo) {
    return initialPayment;
  }

  const discountedAmount = initialPayment - appliedPromo.discountAmount;
  return Math.max(0, discountedAmount);
}
