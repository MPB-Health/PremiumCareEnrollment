import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type SubmissionStatus =
  | "started"
  | "enrolled"
  | "pdf_stored"
  | "pdf_attached"
  | "completed"
  | "failed";

export interface EnrollmentSubmissionRow {
  id: string;
  status: SubmissionStatus;
  member_id: string | null;
  pdf_url: string | null;
  storage_path: string | null;
  gateway_attempts: number;
  last_error: string | null;
  customer_email: string;
  agent_number: number;
  payload_hash: string | null;
  enrollment_response: string | null;
  created_at: string;
  updated_at: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidSubmissionId(id: string | null | undefined): boolean {
  return !!id && UUID_RE.test(id.trim());
}

export function computePayloadHash(
  email: string,
  effectiveDate: string,
  benefitId: string,
  agentNumber: number,
): string {
  return `${email.toLowerCase().trim()}|${effectiveDate.trim()}|${benefitId.trim()}|${agentNumber}`;
}

export function extractMemberIdFromExternalResponse(
  responseBody: unknown,
): string | null {
  if (!responseBody || typeof responseBody !== "object") return null;

  const data = responseBody as Record<string, unknown>;
  const candidates: unknown[] = [
    (data.MEMBER as Record<string, unknown> | undefined)?.ID,
    (data.MEMBER as Record<string, unknown> | undefined)?.MEMBERID,
    (data.MEMBER as Record<string, unknown> | undefined)?.MEMBER_ID,
    data.MEMBERID,
    data.MEMBER_ID,
    (data.TRANSACTION as Record<string, unknown> | undefined)?.MEMBERID,
    (data.TRANSACTION as Record<string, unknown> | undefined)?.MEMBER_ID,
    (
      (data.TRANSACTION as Record<string, unknown> | undefined)?.MEMBER as
        | Record<string, unknown>
        | undefined
    )?.ID,
    (data.MEMBERS as Array<Record<string, unknown>> | undefined)?.[0]?.ID,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const asString = String(candidate).trim();
    if (asString && asString !== "undefined" && asString !== "null") {
      return asString;
    }
  }

  return null;
}

export function buildIdempotentEnrollmentResponse(
  enrollmentResponse: unknown,
  memberId: string | null,
): Record<string, unknown> {
  let data: Record<string, unknown>;
  if (typeof enrollmentResponse === "string") {
    try {
      data = JSON.parse(enrollmentResponse) as Record<string, unknown>;
    } catch {
      data = {
        TRANSACTION: { SUCCESS: true },
        MEMBER: memberId ? { ID: memberId } : undefined,
      };
    }
  } else if (enrollmentResponse && typeof enrollmentResponse === "object") {
    data = enrollmentResponse as Record<string, unknown>;
  } else {
    data = {
      TRANSACTION: { SUCCESS: true },
      MEMBER: memberId ? { ID: memberId } : undefined,
    };
  }

  return {
    success: true,
    status: 200,
    data,
    idempotentReplay: true,
  };
}

const IN_FLIGHT_MS = 90_000;

export function isSubmissionInFlight(row: EnrollmentSubmissionRow): boolean {
  if (row.member_id) return false;
  if (row.status !== "started") return false;
  const updated = new Date(row.updated_at).getTime();
  return Date.now() - updated < IN_FLIGHT_MS;
}

export async function loadSubmission(
  supabase: SupabaseClient,
  submissionId: string,
): Promise<EnrollmentSubmissionRow | null> {
  const { data, error } = await supabase
    .from("enrollment_submissions")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle();

  if (error) {
    console.error("[enrollment_submissions] load failed:", error.message);
    return null;
  }

  return data as EnrollmentSubmissionRow | null;
}

export async function upsertSubmissionStarted(
  supabase: SupabaseClient,
  params: {
    submissionId: string;
    customerEmail: string;
    agentNumber: number;
    payloadHash: string;
  },
): Promise<{ row: EnrollmentSubmissionRow | null; error: string | null }> {
  const existing = await loadSubmission(supabase, params.submissionId);

  if (existing?.member_id) {
    return { row: existing, error: null };
  }

  if (existing && isSubmissionInFlight(existing)) {
    return { row: existing, error: "in_progress" };
  }

  if (existing) {
    const { data, error } = await supabase
      .from("enrollment_submissions")
      .update({
        customer_email: params.customerEmail,
        agent_number: params.agentNumber,
        payload_hash: params.payloadHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.submissionId)
      .select("*")
      .single();

    if (error) {
      return { row: null, error: error.message };
    }
    return { row: data as EnrollmentSubmissionRow, error: null };
  }

  const { data, error } = await supabase
    .from("enrollment_submissions")
    .insert({
      id: params.submissionId,
      status: "started",
      customer_email: params.customerEmail,
      agent_number: params.agentNumber,
      payload_hash: params.payloadHash,
    })
    .select("*")
    .single();

  if (error) {
    return { row: null, error: error.message };
  }

  return { row: data as EnrollmentSubmissionRow, error: null };
}

export async function markSubmissionEnrolled(
  supabase: SupabaseClient,
  submissionId: string,
  memberId: string,
  enrollmentResponse: unknown,
): Promise<void> {
  const { error } = await supabase
    .from("enrollment_submissions")
    .update({
      status: "enrolled",
      member_id: memberId,
      enrollment_response: JSON.stringify(enrollmentResponse),
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  if (error) {
    console.error("[enrollment_submissions] mark enrolled failed:", error.message);
  }
}

export async function markSubmissionPdfStored(
  supabase: SupabaseClient,
  submissionId: string,
  pdfUrl: string,
  storagePath: string,
): Promise<void> {
  const { error } = await supabase
    .from("enrollment_submissions")
    .update({
      status: "pdf_stored",
      pdf_url: pdfUrl,
      storage_path: storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  if (error) {
    console.error("[enrollment_submissions] mark pdf_stored failed:", error.message);
  }
}

export async function markSubmissionGatewaySuccess(
  supabase: SupabaseClient,
  submissionId: string,
): Promise<void> {
  const { error } = await supabase
    .from("enrollment_submissions")
    .update({
      status: "completed",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  if (error) {
    console.error("[enrollment_submissions] mark completed failed:", error.message);
  }
}

export async function markSubmissionGatewayFailure(
  supabase: SupabaseClient,
  submissionId: string,
  errorMessage: string,
  currentAttempts: number,
): Promise<void> {
  const { error } = await supabase
    .from("enrollment_submissions")
    .update({
      gateway_attempts: currentAttempts + 1,
      last_error: errorMessage.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  if (error) {
    console.error("[enrollment_submissions] mark gateway failure failed:", error.message);
  }
}
