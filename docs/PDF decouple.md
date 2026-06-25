# Decouple PDF Storage From the Enrollment Response — Replication Runbook

How to make the agreement PDF **always get saved** in Supabase storage, even when the
member-creation call to 1Administration is slow and the edge function times out.

Reference implementation: **SecureHSAEnrollment** (`src/components/EnrollmentWizard.tsx`,
function `handleSubmit`). Use this when porting to a sibling enrollment app that shares
the same code/layout but has **different function names and pricing** (MEC, Essentials,
Premium Care, etc.).

---

## The problem this solves

The enrollment flow runs in the browser:

1. Build the enrollment payload from the form.
2. `POST` to the enrollment edge function (e.g. `enrollment-api-hsa`) → it calls the
   external 1Administration API to create the member.
3. **Only after a successful response** the client generates the agreement PDF and
   uploads it to Supabase storage via `save-enrollment-pdf`.

The 1Administration API is sometimes **very slow**. A Supabase edge function is killed at
its **~150-second wall-clock limit** and returns **504**. When that happens:

- 1Administration usually **still creates the member** (the request reached them).
- Our function is killed before it can log or update its tracking row.
- The browser receives the **504 as an error**, so step 3 never runs → **no PDF is ever
  generated or stored**, and it cannot be recovered (the PDF only ever existed in the
  user's browser).

Observed in logs:

```
POST | 504 | .../enrollment-api-hsa?id=621239   execution_time_ms: 150649
```

**Root cause:** PDF storage was *gated on the enrollment response*, but that response can
fail (504) even though the member was created.

> Related: `docs/fix-duplicate-pdf.md` covers the **duplicate-member** side (single-fire
> client, no auto gateway attach, record-only edge function). This runbook is the
> companion fix that guarantees the **PDF is always saved**.

---

## The fix: store the PDF BEFORE enrolling

The agreement PDF is generated from the **form data**, not from the member response — so
it does **not** need the member id. Therefore upload it to storage **before** firing the
enrollment POST. Then even a 504 leaves you with a stored PDF you can upload to
1Administration manually.

### Flow (client `handleSubmit`)

```
1. Validate + build payload (+ encrypt + Zoho sync as before).
2. Generate + upload the PDF to Supabase storage   ← MOVED UP, before the POST
     - best-effort: wrap in try/catch, never block enrollment on a PDF failure
     - pass memberId = null (not known yet); do NOT pass submissionId
3. Fire the enrollment POST exactly once (single-fire, no auto-retry)
     - AbortController with a ~150s client timeout
4. On success      → thank-you page (PDF already stored)
   On 504/timeout   → show a "processing, do not resubmit" message (member likely created)
   On clear failure → show the error response
```

### Key code (adapt names/pricing per project)

Move PDF generation above the POST and make it best-effort:

```ts
const bodyString = JSON.stringify(enrollmentPayload);

// Store the PDF BEFORE enrolling so it is always saved, even if the enrollment
// POST later times out (504 from the slow 1Administration API).
setFinishingEnrollment(true);
try {
  await generateAndUploadPDF(null); // no memberId yet; no submissionId
} catch {
  // PDF is best-effort; never block the enrollment on a storage failure.
}
setFinishingEnrollment(false);
```

Single-fire POST with a client-side timeout:

```ts
const ENROLL_TIMEOUT_MS = 150000;
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), ENROLL_TIMEOUT_MS);
try {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { /* ...auth..., 'X-Submission-Id': submissionId */ },
    cache: 'no-store',
    body: bodyString,
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  // ...parse JSON, compute enrollmentSuccess...
  if (!enrollmentSuccess) { setResponse(data); clearFormDataOnly(); setLoading(false); return; }

  setMemberId(data.data?.MEMBER?.ID?.toString() || null);
  clearSubmissionId();
  setShowThankYou(true);
  clearStorage();
  setLoading(false);
  return;
} catch (error) {
  clearTimeout(timeoutId);
  // Timeout / network error: member may have been created upstream. PDF is
  // already stored above. Do NOT retry (avoids duplicates); show a clear msg.
  const isTimeout = error instanceof DOMException && error.name === 'AbortError';
  setResponse({
    success: true,
    status: 202,
    data: { TRANSACTION: { SUCCESS: true } },
    message: isTimeout
      ? 'Your enrollment is taking longer than usual and is still being processed. Please do NOT resubmit — our team will confirm your enrollment shortly.'
      : 'Your enrollment is being processed. Please do NOT resubmit — if you do not receive a confirmation, our team will follow up shortly.',
  });
  clearFormDataOnly();
  setLoading(false);
  return;
}
```

`generateAndUploadPDF` uploads to `save-enrollment-pdf` and calls `setPdfUrl(...)`. It must
**not** call any gateway-attach function and must **not** pass `submissionId` (see below).

---

## What to change per sibling project

| Item | SecureHSA value | Change to your app's value |
|------|-----------------|----------------------------|
| Enrollment edge function | `enrollment-api-hsa` | e.g. `enrollment-api-mec` |
| PDF upload function | `save-enrollment-pdf` (shared) | same — do not change |
| Pricing / benefit ids / PDID | SecureHSA plan values | your plan's values |
| Default agent id | `768413` | your app's default |
| PDF builder | `generateEnrollmentPDF(formData)` | your app's generator/layout |

Everything else (the decouple pattern, single-fire, timeout, messages) is identical.

---

## Important constraints to preserve

- **Upload PDF before the POST** and make it best-effort (never block enrollment).
- **Single-fire** the enrollment POST — no automatic retry. Retrying a slow/timed-out
  enrollment is what creates duplicate members.
- **Do NOT pass `submissionId` to `save-enrollment-pdf`.** That keeps the row from being
  marked `pdf_stored`, so the shared `retry-enrollment-pdf-attach` cron never
  auto-attaches the PDF to the gateway (uploads to 1Administration stay manual).
- **No automatic gateway attach** — remove any `gateway-member-api-*` call from the
  client. The advisor uploads the stored PDF to 1Administration manually.
- The enrollment edge function should be **record-only / non-blocking** (no 409/503; see
  `docs/fix-duplicate-pdf.md`).

---

## Trade-off (accepted)

Because the PDF is uploaded up front, a PDF will be stored **even for the rare enrollment
that ultimately fails** (e.g. a declined card or a hard validation error from
1Administration). Since the attach to 1Administration is manual, an unused stored PDF is
harmless.

---

## Verifying

- Happy path: PDF appears in the `enrollment-documents` bucket (e.g.
  `enrollments/<email>.pdf`) and the thank-you page links to it.
- Slow upstream (504): the PDF is **still** in the bucket; the user sees the "processing"
  message; no duplicate member is created.

```sql
-- the row will sit at 'started' (no member_id) on a 504; the PDF is in storage regardless
SELECT id, status, member_id, pdf_url, created_at
FROM enrollment_submissions ORDER BY created_at DESC LIMIT 10;
```
