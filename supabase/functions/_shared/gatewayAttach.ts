import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  isValidSubmissionId,
  loadSubmission,
  markSubmissionGatewayFailure,
  markSubmissionGatewaySuccess,
} from "./enrollmentSubmissions.ts";

function parseGatewaySuccess(responseData: unknown, httpOk: boolean): boolean {
  let bodySuccess = httpOk;
  if (httpOk && responseData && typeof responseData === "object") {
    const root = responseData as Record<string, unknown>;
    const tx = root.TRANSACTION as Record<string, unknown> | undefined;
    const txVal = (tx?.SUCCESS ?? root.SUCCESS) as unknown;
    if (typeof txVal !== "undefined") {
      const isTrue =
        txVal === true ||
        txVal === "true" ||
        (typeof txVal === "string" && txVal.toLowerCase() === "true");
      const isFalse =
        txVal === false ||
        txVal === "false" ||
        (typeof txVal === "string" && txVal.toLowerCase() === "false");
      if (isFalse) bodySuccess = false;
      else if (isTrue) bodySuccess = true;
    }
  }
  return bodySuccess;
}

export async function attachPdfToGateway(params: {
  supabase: SupabaseClient;
  agentNumber: number;
  username: string;
  password: string;
  memberId: string;
  pdfUrl: string;
  submissionId?: string | null;
}): Promise<{ success: boolean; status: number; data: unknown; error?: string }> {
  const formData = new URLSearchParams();
  formData.append("CORP_ID", "1402");
  formData.append("API_USERNAME", params.username);
  formData.append("API_PASSWORD", params.password);
  formData.append("AGENT_ID", params.agentNumber.toString());
  formData.append("DOC_TYPE", "Signature");
  formData.append("DOC_DESCRIPTION", "Signature");
  formData.append("DOC_PROCESSOR", "Internal");
  formData.append("DOC_FILEURL", params.pdfUrl);
  formData.append("UNIQUE_ID", params.memberId);

  const gatewayApiUrl = "https://enrollment123.com/gateway/member.cfm";

  const response = await fetch(gatewayApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  const responseText = await response.text();

  let responseData: unknown;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = responseText;
  }

  const bodySuccess = parseGatewaySuccess(responseData, response.ok);

  if (params.submissionId && isValidSubmissionId(params.submissionId)) {
    if (bodySuccess) {
      await markSubmissionGatewaySuccess(params.supabase, params.submissionId);
    } else {
      const row = await loadSubmission(params.supabase, params.submissionId);
      await markSubmissionGatewayFailure(
        params.supabase,
        params.submissionId,
        typeof responseData === "string" ? responseData : JSON.stringify(responseData),
        row?.gateway_attempts ?? 0,
      );
    }
  }

  return {
    success: bodySuccess,
    status: response.status,
    data: responseData,
    error: bodySuccess ? undefined : "Gateway attach failed",
  };
}
