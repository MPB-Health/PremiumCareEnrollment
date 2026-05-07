import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import CryptoJS from "npm:crypto-js@4.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, Cache-Control",
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

    const formData = new URLSearchParams();
    formData.append("CORP_ID", "1402");
    formData.append("API_USERNAME", username);
    formData.append("API_PASSWORD", password);
    formData.append("AGENT_ID", agentNumber.toString());

    if (hasMemberData) {
      formData.append("DOC_TYPE", "Signature");
      formData.append("DOC_DESCRIPTION", "Signature");
      formData.append("DOC_PROCESSOR", "Internal");
      formData.append("DOC_FILEURL", requestData.pdfUrl!);
    }

    const gatewayApiUrl = "https://enrollment123.com/gateway/member.cfm";

    const response = await fetch(gatewayApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const responseText = await response.text();
    let responseData;

    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    return new Response(
      JSON.stringify({
        success: response.ok,
        status: response.status,
        data: responseData,
      }),
      {
        status: response.ok ? 200 : response.status,
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
