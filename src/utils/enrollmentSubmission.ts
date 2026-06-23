/**
 * Client-side submission idempotency helpers.
 *
 * A single `submissionId` (UUID) is generated per enrollment attempt and reused
 * across retries until the attempt fully completes. The enrollment edge function
 * uses it to create the member at most once, so re-submits / lost responses never
 * produce a duplicate member or charge.
 *
 * See docs/fix-duplicate-pdf.md.
 */

const SUBMISSION_ID_KEY = 'enrollment_submission_id';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidSubmissionId(id: string | null | undefined): boolean {
  return !!id && UUID_RE.test(id.trim());
}

/** UUID persisted in sessionStorage; reused across retries until cleared. */
export function getOrCreateSubmissionId(): string {
  try {
    const existing = sessionStorage.getItem(SUBMISSION_ID_KEY);
    if (existing && isValidSubmissionId(existing)) {
      return existing;
    }
  } catch {
    // sessionStorage unavailable (private mode / SSR) — fall through.
  }

  const id = crypto.randomUUID();

  try {
    sessionStorage.setItem(SUBMISSION_ID_KEY, id);
  } catch {
    // Ignore persistence failure; the generated id is still usable for this run.
  }

  return id;
}

/** Remove the stored id once an attempt fully completes (call on thank-you). */
export function clearSubmissionId(): void {
  try {
    sessionStorage.removeItem(SUBMISSION_ID_KEY);
  } catch {
    // Ignore.
  }
}

export interface SubmissionStatusResult {
  success: boolean;
  status: string;
  memberId: string | null;
  pdfUrl: string | null;
  gatewayAttempts: number;
  lastError: string | null;
}

/**
 * GET the enrollment API with the submissionId query param. Used to recover the
 * memberId when a parallel submit returns 409 (in-progress) or after a refresh.
 */
export async function fetchSubmissionStatus(
  submissionId: string,
  agentParam: string,
): Promise<SubmissionStatusResult | null> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const statusUrl =
      `${supabaseUrl}/functions/v1/enrollment-api-premiumcare?id=${agentParam}` +
      `&submissionId=${encodeURIComponent(submissionId)}`;

    const res = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
        'Cache-Control': 'no-cache, no-store',
      },
      cache: 'no-store',
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data || data.success !== true) return null;

    return {
      success: true,
      status: data.status,
      memberId: data.memberId ?? null,
      pdfUrl: data.pdfUrl ?? null,
      gatewayAttempts: data.gatewayAttempts ?? 0,
      lastError: data.lastError ?? null,
    };
  } catch {
    return null;
  }
}

/** Generic exponential-backoff helper. */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseDelayMs?: number; maxDelayMs?: number },
): Promise<T> {
  const retries = opts?.retries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const maxDelayMs = opts?.maxDelayMs ?? 5000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
