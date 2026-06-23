import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import CryptoJS from "npm:crypto-js@4.2.0";
import { attachPdfToGateway } from "../_shared/gatewayAttach.ts";
import { isValidSubmissionId, loadSubmission } from "../_shared/enrollmentSubmissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, Cache-Control, X-Submission-Id",
};

function decryptPassword(encryptedPassword: string): string {
  try {
    const secretKey = Deno.env.get("VITE_ENCRYPTION_SECRET_KEY");
    if (!secretKey) {
      throw new Error("Encryption secret key not configured");
    }
    const decrypted = CryptoJS.AES.decrypt(encryptedPassword, secretKey);
    const originalPassword = decrypted.toString(CryptoJS.enc.Utf8);
    if (!originalPassword) {
      throw new Error("Decryption resulted in empty string");
    }
    return originalPassword;
  } catch (error) {
    throw new Error("Failed to decrypt password");
  }
}

interface GatewayRequest {
  memberId?: string;
  pdfUrl?: string;
  customerEmail?: string;
  submissionId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, status: 405, error: "Method not allowed" }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const url = new URL(req.url);
    const agentIdParam = url.searchParams.get('id');
    const agentNumber = agentIdParam ? parseInt(agentIdParam) : 768413;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, status: 500, error: "Database configuration error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: advisorData, error: advisorError } = await supabase
      .from('advisor')
      .select('username, password')
      .eq('sales_id', agentNumber)
      .maybeSingle();

    if (advisorError) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 500,
          error: "Failed to retrieve advisor credentials",
          details: advisorError.message
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!advisorData) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 404,
          error: `Advisor not found for agent number: ${agentNumber}`
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!advisorData.username || !advisorData.password) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 500,
          error: "API credentials not configured for this advisor"
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const username = advisorData.username;
    let password: string;

    try {
      password = decryptPassword(advisorData.password);
    } catch (decryptError) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 500,
          error: "Failed to decrypt advisor credentials"
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const requestData: GatewayRequest = await req.json();

    const hasMemberData = !!(requestData.memberId && requestData.pdfUrl);

    if (!hasMemberData) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 400,
          error: "memberId and pdfUrl are required to attach the enrollment PDF",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const submissionId = isValidSubmissionId(requestData.submissionId)
      ? requestData.submissionId!.trim()
      : null;

    // If this submission's PDF was already attached/completed, replay success
    // instead of attaching the document a second time.
    if (submissionId) {
      const existing = await loadSubmission(supabase, submissionId);
      if (existing && ['pdf_attached', 'completed'].includes(existing.status)) {
        return new Response(
          JSON.stringify({ success: true, status: 200, data: { idempotentReplay: true } }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const attachResult = await attachPdfToGateway({
      supabase,
      agentNumber,
      username,
      password,
      memberId: requestData.memberId!,
      pdfUrl: requestData.pdfUrl!,
      submissionId,
    });

    // Note: Premium Care intentionally retains the generated PDF in storage
    // after a successful attach (no deletion), unlike some sibling apps.

    return new Response(
      JSON.stringify({
        success: attachResult.success,
        status: attachResult.status,
        data: attachResult.data,
      }),
      {
        status: attachResult.success ? 200 : attachResult.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        status: 500,
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error occurred",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
