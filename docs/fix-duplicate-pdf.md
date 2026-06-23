# Prevent Duplicate Enrollments When PDF Attach Fails — Replication Runbook

This document describes how to replicate the **submission idempotency** fix from CareEnrollment in another enrollment project that was copied from the same base (same wizard steps, PDF generation, enrollment123 gateway attach) but may use **different edge function names** and a **different Supabase project**.

**CareEnrollment (this repo) reference commit:** `af02987` — *Prevent duplicate enrollments when PDF attach fails using submission idempotency.*

---

## Problem this solves

The enrollment flow has three phases:

1. **Create member** — POST to the external enrollment API (`member/0.json` or equivalent).
2. **Store PDF** — upload generated agreement PDF to Supabase Storage.
3. **Attach PDF** — POST PDF URL to enrollment123 gateway (`member.cfm`).

If phase 1 succeeds but phase 2 or 3 fails, the user often clicks **Submit** again. Without idempotency, phase 1 runs again and creates a **second member and charge**. The PDF may already exist in the bucket from the first attempt.

**Fix:** Track each attempt with a client-generated `submissionId` (UUID). The member API is called **at most once per submissionId**. Retries only redo PDF upload and gateway attach.

---

## ✅ Current shared deployment (MPB Health — project `simckkqvsfgyswxccwjh`)

**All MPB Health enrollment apps (CareEnrollment, Secure HSA, MEC, Essentials, Care+, Premium Care, Premium HSA, Direct) live in the SAME Supabase project: `simckkqvsfgyswxccwjh`.** This means the **infrastructure already exists** and must **NOT** be recreated when adding the fix to another sibling app.

**Already live on the shared project — do NOT recreate:**

| Resource | Status | Note |
|----------|--------|------|
| `enrollment_submissions` table | ✅ exists | One row per client `submissionId`, shared by all apps |
| `retry-enrollment-pdf-attach` function | ✅ exists (`verify_jwt = false`) | Processes **all** apps' stuck `pdf_stored` rows |
| Cron job **"Enrollment PDF Re-submission"** | ✅ exists | One schedule for the whole project; new apps benefit automatically |
| `CRON_SECRET` secret | ✅ set | Already configured for the retry function |
| `save-enrollment-pdf` function | ✅ already updated + live | **Shared by every app**; already handles the `submissionId` form field. Do NOT redeploy it per app |

**What each NEW sibling app still needs (this is the entire remaining job):**

1. The two `_shared/` modules present in its repo so they get **bundled** with the app's functions at deploy time (each function bundles its own copy — see note below). Copy them verbatim from this repo (`supabase/functions/_shared/enrollmentSubmissions.ts` and `gatewayAttach.ts`).
2. Modify the app's **own** enrollment API function (idempotency gate + GET status).
3. Modify the app's **own** gateway attach function (delegate to `attachPdfToGateway`).
4. Wire the app's **frontend** to generate and pass `submissionId`.

> **Deploy note (shared `_shared` modules):** Supabase bundles each function independently, so the `_shared/*.ts` files must be included in *every* function deploy that imports them. With the Supabase **CLI** (`supabase functions deploy <name>`) this is automatic from the repo. With the **MCP `deploy_edge_function`** tool you must pass the `_shared` files explicitly in the `files` array using paths relative to `functions/` (e.g. `functions/_shared/enrollmentSubmissions.ts`) and set `entrypoint_path` to `functions/<name>/index.ts`.

### Sibling app edge-function names

Confirmed names (verified while implementing HSA):

| App | Enrollment API | Gateway attach | Frontend submit handler |
|-----|----------------|----------------|-------------------------|
| CareEnrollment / Care+ | `enrollment-api-careplus` | `gateway-member-api-careplus` | reference implementation |
| Secure HSA | `enrollment-api-hsa` | `gateway-member-api-securehsa` | `src/components/EnrollmentWizard.tsx` (this repo) |
| **MEC (next to do)** | **`enrollment-api-mec`** | **`gateway-member-api_mec`** *(underscore, not hyphen)* | MEC repo wizard |

> For any other sibling, **look up the exact function names in the Supabase dashboard / `list_edge_functions`** before editing — do not assume a naming pattern (note HSA uses a hyphen `gateway-member-api-securehsa` while MEC uses an underscore `gateway-member-api_mec`).

PDF upload is **always** the single shared `save-enrollment-pdf` (already done).

---

## ⚠️ FIRST: Information to confirm before implementing (per sibling app)

For an MPB Health app on `simckkqvsfgyswxccwjh`, the project strategy is already answered (**shared project** — see above). Confirm only the app-specific details:

1. **Edge function names** — the app's own enrollment API and gateway attach names (table above). For MEC: `enrollment-api-mec` and `gateway-member-api_mec`.

2. **Advisor credentials table.** The retry + gateway functions load advisor username/password from the shared `advisor` table keyed by `sales_id`. Already correct on the shared project.

3. **Member ID extraction.** Confirm the enrollment API response still exposes member ID in `MEMBER.ID`, `MEMBERID`, etc. (`extractMemberIdFromExternalResponse`). Adjust candidates only if the sibling API differs.

4. **Payload hash inputs.** Dedup uses `email|effectiveDate|benefitId|agentNumber`. Confirm those fields exist in the sibling payload.

> If a future app uses a **separate** Supabase project, then the "already live" items above do **not** apply — you must copy the migration, shared modules, and retry function into that project and create its own cron job + `CRON_SECRET`. See the per-project instructions further below.

---

## Architecture / status flow

```
Client (sessionStorage)
  submissionId = crypto.randomUUID()   // reused until enrollment completes

Phase 1 — enrollment API (POST + X-Submission-Id)
  started → enrolled (+ member_id stored)

Phase 2 — save-enrollment-pdf (form field submissionId)
  enrolled → pdf_stored (+ pdf_url, storage_path)

Phase 3 — gateway attach (JSON body submissionId)
  pdf_stored → completed

Background — retry-enrollment-pdf-attach (cron every 5 min)
  Retries rows stuck at pdf_stored (updated > 1 min ago, gateway_attempts < 10)
```

**Status values:** `started` | `enrolled` | `pdf_stored` | `pdf_attached` | `completed` | `failed`

**Idempotent replay:** If `enrollment_submissions.member_id` already exists for a `submissionId`, the enrollment API returns the cached response with `idempotentReplay: true` and **does not** call the external member API again.

---

## Shared Supabase resources (recommended)

If multiple enrollment frontends point at **one Supabase project**, you can share:

| Resource | Shared? | Notes |
|----------|---------|-------|
| `enrollment_submissions` table | Yes | One row per client `submissionId`; apps do not collide |
| `retry-enrollment-pdf-attach` | Yes | Processes **all** projects' stuck rows in that database |
| Cron job | Yes | One schedule hitting one function URL on that project |
| `CRON_SECRET` | Yes | Same secret for the shared retry function |

Each app still needs its **own** enrollment / save-pdf / gateway edge functions updated to read and write `enrollment_submissions`.

If apps use **different Supabase projects**, each project needs its own table, retry function, secrets, and cron entry.

---

## Database migration

> **MPB Health (`simckkqvsfgyswxccwjh`): SKIP — the `enrollment_submissions` table already exists.** Do not create it again. This section applies only to a brand-new, separate Supabase project.

For a separate project, create the table (`id uuid PK`, `status text default 'started'`, `member_id`, `pdf_url`, `storage_path`, `gateway_attempts int default 0`, `last_error`, `customer_email`, `agent_number int`, `payload_hash`, `enrollment_response`, `created_at`, `updated_at`) and apply with `supabase db push` or the SQL editor.

---

## Shared edge function modules

Copy these files into the target project's `supabase/functions/_shared/`:

| File | Purpose |
|------|---------|
| `enrollmentSubmissions.ts` | Load/upsert rows, status transitions, payload hash, idempotent response builder |
| `gatewayAttach.ts` | POST to enrollment123 `member.cfm`; updates submission status on success/failure |

No project-specific renames required inside these files — they only talk to `enrollment_submissions` and the fixed gateway URL.

---

## Edge function: enrollment API (member creation)

**CareEnrollment:** `supabase/functions/enrollment-api-careplus/index.ts`

### CORS

Add `X-Submission-Id` to `Access-Control-Allow-Headers`.

### GET — submission status (for refresh / resume)

```
GET /functions/v1/<enrollment-api>?id=<agent>&submissionId=<uuid>
```

Returns JSON:

```json
{
  "success": true,
  "status": "pdf_stored",
  "memberId": "12345",
  "pdfUrl": "https://...",
  "gatewayAttempts": 0,
  "lastError": null
}
```

Implement using `loadSubmission()` from `_shared/enrollmentSubmissions.ts`. Return 404 if row missing; 400 if `submissionId` invalid.

### POST — gate member API

1. Read `X-Submission-Id` header → `submissionId = isValidSubmissionId(header) ? header : null`.
2. Before calling the external member API, **only when `submissionId` is present**:
   - `computePayloadHash(email, effectiveDate, benefitId, agentNumber)`
   - `upsertSubmissionStarted({ submissionId, customerEmail, agentNumber, payloadHash })`
3. If `upsertSubmissionStarted` returns `error: "in_progress"` → **409** (parallel duplicate submit).
4. If row already has `member_id` → return `buildIdempotentEnrollmentResponse(...)` with **200** (no external call).
5. On successful external enrollment (and `submissionId` present) → `markSubmissionEnrolled(submissionId, memberId, responseData)`.

> **Header strictness — choose one (Secure HSA uses TOLERANT):**
> - **Tolerant (recommended for live apps):** if the header is missing/invalid, `submissionId = null` and the function falls back to the **legacy direct-submit path** (no dedup). This makes the edge-function and frontend deploys **order-independent with zero downtime** — an old frontend that doesn't yet send the header keeps working, and dedup activates automatically once the new frontend ships. This is what `enrollment-api-hsa` does in this repo.
> - **Strict (CareEnrollment):** reject with **400** if the header is not a valid UUID. Guarantees dedup but requires deploying the new frontend **before** the edge function or you will 400 live enrollments.

Import from `_shared/enrollmentSubmissions.ts`:

- `isValidSubmissionId`, `loadSubmission`, `upsertSubmissionStarted`, `markSubmissionEnrolled`, `buildIdempotentEnrollmentResponse`, `extractMemberIdFromExternalResponse`, `computePayloadHash`

---

## Edge function: save enrollment PDF

**Shared function:** `supabase/functions/save-enrollment-pdf/index.ts`

> **MPB Health (`simckkqvsfgyswxccwjh`): ALREADY DONE — do NOT modify or redeploy.** This is a **single shared function** used by every app. It already reads the `submissionId` form field, replays if the PDF is already stored, and calls `markSubmissionPdfStored`. It is **backward-compatible**: when `submissionId` is absent (an app not yet migrated), it behaves exactly like the old version, so it never blocks enrollments. Keep the repo copy in sync but there is nothing to deploy per app.

For a separate project only, the changes are:

1. Read `submissionId` from multipart form field `submissionId` (`null` if absent).
2. **Before upload:** if row exists with `pdf_url` and status in `pdf_stored`, `pdf_attached`, or `completed` → return existing URL (skip re-upload).
3. **After successful storage upload (when `submissionId` present):** `markSubmissionPdfStored(submissionId, pdfUrl, storagePath)`.

---

## Edge function: gateway PDF attach

**CareEnrollment:** `gateway-member-api-careplus` · **Secure HSA:** `gateway-member-api-securehsa` · **MEC (next):** `gateway-member-api_mec`

### Changes (per app — this is one of the two functions you deploy for a sibling)

1. Accept optional `submissionId` in JSON body → `isValidSubmissionId(...) ? trim : null`.
2. **Before attach:** if `submissionId` present and status is `pdf_attached` or `completed` → return success (`idempotentReplay`) without calling the gateway again.
3. Delegate attach to `attachPdfToGateway()` from `_shared/gatewayAttach.ts`, passing `submissionId` so status updates automatically.
4. **Preserve any app-specific post-success cleanup.** Secure HSA still deletes the stored PDF from the `enrollment-documents` bucket and flags `enrollment_pdfs.metadata` after a *confirmed* attach — keep that block, but gate it on `attachResult.success` (not raw `response.ok`).

---

## Edge function: background retry (copy or reuse)

**Function:** `supabase/functions/retry-enrollment-pdf-attach/index.ts`

> **MPB Health (`simckkqvsfgyswxccwjh`): ALREADY DEPLOYED — do NOT recreate.** The function exists (`verify_jwt = false`), `CRON_SECRET` is set, and the **"Enrollment PDF Re-submission"** cron already drives it for the whole project. A newly-migrated sibling app benefits automatically the moment its functions write `pdf_stored` rows. The rest of this section is for a **separate** project only.

### Behavior

- Auth: `Authorization: Bearer <CRON_SECRET>` **or** service role key.
- Query: `status = 'pdf_stored'`, `updated_at < now() - 1 minute`, `gateway_attempts < 10`, limit 20.
- For each row: load advisor creds, decrypt password, call `attachPdfToGateway()`.

### Deploy config

In `supabase/config.toml`:

```toml
[functions.retry-enrollment-pdf-attach]
verify_jwt = false
```

JWT verification must be **off** so cron can call with `CRON_SECRET` instead of a user JWT.

Set secret:

```bash
npx supabase secrets set CRON_SECRET=<long-random-string>
```

Deploy:

```bash
npx supabase functions deploy retry-enrollment-pdf-attach
```

### Manual test (PowerShell — use `curl.exe`, not `curl` alias)

```powershell
curl.exe -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/retry-enrollment-pdf-attach" `
  -H "Authorization: Bearer <CRON_SECRET_PLAINTEXT>" `
  -H "Content-Type: application/json" `
  -d "{}"
```

Expected when idle: `{"success":true,"processed":0,"results":[]}`

Use the **plaintext** secret you set, not the digest from `supabase secrets list`.

---

## Cron job setup

> **MPB Health (`simckkqvsfgyswxccwjh`): ALREADY EXISTS — do NOT add another.** The cron job **"Enrollment PDF Re-submission"** already runs on the shared project and covers every sibling app. Adding a second job would double-process rows. This section is for a **separate** project only.

**One cron per Supabase project** is enough for all enrollment apps sharing that project.

In Supabase Dashboard → **Integrations → Cron → Jobs** (not the Edge Functions Schedules tab):

| Field | Value |
|-------|-------|
| Name | `retry-enrollment-pdf-attach` |
| Schedule | `*/5 * * * *` |
| Method | POST |
| URL | `https://<PROJECT_REF>.supabase.co/functions/v1/retry-enrollment-pdf-attach` |
| Headers | `Authorization: Bearer <CRON_SECRET>` |
| Body | `{}` |

If CareEnrollment's cron already runs on the shared project, **do not add a second job** — sibling apps benefit automatically once their edge functions write to `enrollment_submissions`.

---

## Frontend changes

### 1. New utility — `src/utils/enrollmentSubmission.ts`

Copy from this repo (Secure HSA). Actual exports as implemented:

| Export | Purpose |
|--------|---------|
| `getOrCreateSubmissionId()` | UUID persisted in `sessionStorage`; reused across retries until cleared |
| `clearSubmissionId()` | Remove the stored id once an attempt fully completes (call on thank-you) |
| `isValidSubmissionId(id)` | UUID validation (mirrors the edge `_shared` regex) |
| `fetchSubmissionStatus(submissionId, agentParam)` | GET enrollment API with `submissionId` query param; used to recover `memberId` on 409 |
| `retryWithBackoff(fn, opts)` | Generic exponential-backoff helper |

> The earlier CareEnrollment draft listed extra `persistSubmissionMemberId/PdfUrl` helpers and a `markSubmissionCompleted()`. Secure HSA uses the simpler set above (`clearSubmissionId()` replaces `markSubmissionCompleted()`); the server already records `member_id`/`pdf_url` in `enrollment_submissions`, so client-side persistence of those is unnecessary.

**Replace** the enrollment API function name in `fetchSubmissionStatus`:

```ts
const statusUrl = `${supabaseUrl}/functions/v1/<YOUR-ENROLLMENT-API>?id=${agentParam}&submissionId=${encodeURIComponent(submissionId)}`;
```

### 2. Enrollment wizard submit flow — `EnrollmentWizard.tsx` (or equivalent)

Pattern as implemented in Secure HSA `handleSubmit`:

1. `const submissionId = getOrCreateSubmissionId()` near the start of submit (after building the API URL).
2. **Enrollment POST:** add header `'X-Submission-Id': submissionId` to the existing fetch.
3. On enrollment success path: extract `memberId`, set `finishingEnrollment` UI state, then `await generateAndUploadPDF(memberId, submissionId)`.
4. On **409** (`res.status === 409`): call `fetchSubmissionStatus(submissionId, agentParam)`; if it returns a `memberId`, proceed to the PDF/gateway phase with that id (don't blindly retry the POST — it would 409 again).
5. Accept `data.idempotentReplay === true` / `data.data.TRANSACTION.SUCCESS` as success (the replay response already carries `MEMBER.ID`).
6. After the PDF/gateway phase resolves (or its error is swallowed) → `clearSubmissionId()`, show thank-you. The background cron finishes any failed gateway attach.

Pass `submissionId` in:

- Enrollment API: header `X-Submission-Id`
- Save PDF: form field `submissionId` (`formDataUpload.append('submissionId', submissionId)`)
- Gateway API: JSON body `submissionId`

> Because the gateway failure is intentionally swallowed (thank-you still shows), the duplicate risk comes from **re-submits / lost responses**, not from the swallowed gateway error — the reused `submissionId` + the enrollment idempotency gate are what prevent the duplicate member.

### 3. Submit button UX — step component (e.g. `Step2AddressInfo.tsx`)

- Prop: `finishingEnrollment?: boolean`
- Disable submit when `loading || finishingEnrollment`
- Label: `Finishing enrollment…` while PDF/gateway steps run after member created

---

## File checklist

### A) Shared-project sibling (MPB Health — MEC, etc.) — the short list

| Action | Path |
|--------|------|
| Copy verbatim | `supabase/functions/_shared/enrollmentSubmissions.ts` |
| Copy verbatim | `supabase/functions/_shared/gatewayAttach.ts` |
| Modify + deploy | `supabase/functions/<enrollment-api>/index.ts` (MEC: `enrollment-api-mec`) |
| Modify + deploy | `supabase/functions/<gateway-api>/index.ts` (MEC: `gateway-member-api_mec`) |
| Copy + fix API name | `src/utils/enrollmentSubmission.ts` |
| Modify | Enrollment wizard submit handler |
| Modify | Step submit button (finishing state) |
| **SKIP** | migration, `save-enrollment-pdf`, `retry-enrollment-pdf-attach`, cron, `CRON_SECRET`, `config.toml` retry entry — all already live |

### B) Separate Supabase project — the full list

| Action | Path |
|--------|------|
| Copy / apply | `enrollment_submissions` migration |
| Copy | `supabase/functions/_shared/enrollmentSubmissions.ts` |
| Copy | `supabase/functions/_shared/gatewayAttach.ts` |
| Copy + wire names | `supabase/functions/retry-enrollment-pdf-attach/index.ts` |
| Modify | `<your-enrollment-api>/index.ts` |
| Modify | `save-enrollment-pdf/index.ts` |
| Modify | `<your-gateway-api>/index.ts` |
| Modify | `supabase/config.toml` (`verify_jwt = false` for retry function) |
| Copy + fix API name | `src/utils/enrollmentSubmission.ts` |
| Modify | Enrollment wizard submit handler |
| Modify | Step submit button (finishing state) |

---

## Deployment order

### A) Shared-project sibling (MEC)

1. Add the two `_shared/*.ts` files to the repo.
2. Deploy the app's **enrollment API** and **gateway** functions (CLI: `supabase functions deploy enrollment-api-mec` / `gateway-member-api_mec`; or MCP with the `_shared` files included — see deploy note up top). Use the **tolerant header** path so order doesn't matter.
3. Deploy the frontend.
4. Smoke-test one enrollment; confirm a single `enrollment_submissions` row reaches `completed`.

> No table, retry function, cron, or secret steps — they're already live and shared.

### B) Separate Supabase project

1. Apply `enrollment_submissions` migration.
2. Deploy updated enrollment, save-pdf, and gateway functions.
3. Deploy `retry-enrollment-pdf-attach`; set `CRON_SECRET`.
4. Configure cron job (once per Supabase project).
5. Deploy frontend.
6. Manual test retry endpoint with `curl.exe`.

---

## Test scenarios

| Scenario | Expected |
|----------|----------|
| Happy path | One row in `enrollment_submissions`; status ends at `completed` |
| Gateway fails on first attach | Status `pdf_stored`; user sees thank-you; cron completes within ~5 min |
| User clicks Submit twice quickly | Second call gets 409 or idempotent replay; **one** `member_id` |
| Refresh after enroll, before PDF | `fetchSubmissionStatus` resumes; no second member API call |
| Same email, **new** browser session | New `submissionId` → new enrollment (dedup index is per submission + hash, not global email lock) |

Verify in SQL:

```sql
SELECT id, status, member_id, pdf_url, gateway_attempts, last_error, updated_at
FROM enrollment_submissions
ORDER BY created_at DESC
LIMIT 20;
```

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Retry returns 401 | Wrong `CRON_SECRET` (used digest not plaintext), or `verify_jwt` still true |
| Duplicate members still created | Enrollment API not checking `X-Submission-Id` / not calling `upsertSubmissionStarted` before external API |
| Cron never runs | Job in wrong UI tab; use Integrations → Cron |
| Rows stuck at `pdf_stored` | Missing advisor row for `agent_number`; check `last_error` and function logs |
| `fetchSubmissionStatus` always null | Wrong enrollment function name in client URL; or GET handler not implemented |

---

## Reference — file map

This repo (**Secure HSA**) is now a complete working reference on the shared project. Use it as the implementation template; the next target is **MEC**.

| Piece | Secure HSA (reference, this repo) | MEC (target) |
|-------|-----------------------------------|--------------|
| Shared DB helpers | `supabase/functions/_shared/enrollmentSubmissions.ts` | copy verbatim |
| Gateway attach helper | `supabase/functions/_shared/gatewayAttach.ts` | copy verbatim |
| Member API + GET status | `supabase/functions/enrollment-api-hsa/index.ts` | `supabase/functions/enrollment-api-mec/index.ts` |
| Client gateway | `supabase/functions/gateway-member-api-securehsa/index.ts` | `supabase/functions/gateway-member-api_mec/index.ts` |
| PDF storage (shared, done) | `supabase/functions/save-enrollment-pdf/index.ts` | same shared function — no change |
| Client helpers | `src/utils/enrollmentSubmission.ts` | copy + fix API name |
| Wizard orchestration | `src/components/EnrollmentWizard.tsx` | MEC wizard |
| Finishing UI | `src/components/Step2AddressInfo.tsx` | MEC step component |

**Already live on shared project `simckkqvsfgyswxccwjh` (do not recreate):** `enrollment_submissions` table · `retry-enrollment-pdf-attach` · "Enrollment PDF Re-submission" cron · `CRON_SECRET` · `save-enrollment-pdf`.

When porting MEC, treat this runbook as the spec and **Secure HSA in this repo** as the reference implementation, using the **tolerant header** rollout so the function and frontend deploys are order-independent.
