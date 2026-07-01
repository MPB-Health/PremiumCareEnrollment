import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import CryptoJS from "npm:crypto-js@4.2.0";
import {
  buildIdempotentEnrollmentResponse,
  computePayloadHash,
  extractMemberIdFromExternalResponse,
  isValidSubmissionId,
  loadSubmission,
  markSubmissionEnrolled,
  upsertSubmissionStarted,
} from "../_shared/enrollmentSubmissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, Cache-Control, X-Submission-Id",
};

/** Keep in sync with src/constants/promo.ts DEFAULT_PROMO_PDID */
const DEFAULT_ENROLLMENT_PDID = 43957;

function escapePromoCodeForILike(trimmed: string): string {
  return trimmed
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function getEffectivePromoPdid(pdid: number | undefined): number {
  return typeof pdid === "number" && pdid > 0 ? pdid : DEFAULT_ENROLLMENT_PDID;
}

function promoProductAppliesToPdid(
  rowProduct: string | null | undefined,
  effectivePdid: number,
): boolean {
  const raw = rowProduct == null ? "" : String(rowProduct).trim();
  if (raw.length === 0) return true;
  const u = raw.toUpperCase();
  if (u === "*" || u === "ALL" || u === "ANY") return true;
  const expected = String(effectivePdid);
  return raw === expected || raw.toUpperCase() === expected.toUpperCase();
}

/** Mirrors src/utils/pricingLogic.ts calculateAgeFromDOB (MM/DD/YYYY). Used for dependent age rules only. */
function calculateAgeFromDobMmDdYyyy(dob: string): number | null {
  if (!dob || dob.length !== 10) return null;
  const [month, day, year] = dob.split("/").map((n) => parseInt(n, 10));
  if (!month || !day || !year) return null;
  const birthDate = new Date(year, month - 1, day);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/** Keep messages in sync with EnrollmentWizard validateStep1 dependent DOB checks. */
function dependentDobAgeValidationError(relationship: "Spouse" | "Child", dob: string): string | null {
  const age = calculateAgeFromDobMmDdYyyy(dob);
  if (age === null) return null;
  if (relationship === "Spouse" && age < 18) return "Must be 18 years or older to enroll";
  if (relationship === "Child" && age >= 26) return "Child dependents must be under 26 years old";
  return null;
}

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

interface Dependent {
  firstName: string;
  lastName: string;
  dob: string;
  smoker: string;
  relationship: 'Spouse' | 'Child';
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  phone?: string;
  ssn?: string;
  gender?: string;
  email?: string;
}

interface PaymentInfo {
  ccType: string;
  ccNumber: string;
  ccExpMonth: string;
  ccExpYear: string;
  paymentType: string;
  achrouting?: string;
  achaccount?: string;
  achbank?: string;
}

interface AppliedPromo {
  code: string;
  product: string;
  discountAmount: number;
}

interface EnrollmentRequest {
  firstName: string;
  lastName: string;
  dob: string;
  email: string;
  smoker: string;
  address1: string;
  city: string;
  state: string;
  zipcode: string;
  phone: string;
  ssn: string;
  gender: string;
  agent: string;
  uniqueId: string;
  effectiveDate: string;
  benefitId: string;
  selectedPrice: number;
  dependents: Dependent[];
  payment: PaymentInfo;
  pdid?: number;
  promoCode?: string;
  appliedPromo?: AppliedPromo;
}

interface EncryptedBlock {
  encryptedData: string;
  encryptedKey: string;
  iv: string;
}

interface DecryptedSensitiveFields {
  ssn: string;
  benefitId: string | null;
  pdid: number;
  phone: string;
  email: string;
  agent: string;
  dob: string;
  city: string;
  appliedPromo: Record<string, unknown> | null;
  payment: {
    ccType: string;
    ccNumber: string;
    ccExpMonth: string;
    ccExpYear: string;
    achrouting: string;
    achaccount: string;
    achbank: string;
    paymentType: string;
    paymentMethod: string;
  };
  questionnaireAnswers: Record<string, unknown>;
  dependentSsns: string[];
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function importRsaPrivateKey(): Promise<CryptoKey> {
  const privateKeyBase64 = Deno.env.get("RSA_PRIVATE_KEY");
  if (!privateKeyBase64) {
    throw new Error("RSA_PRIVATE_KEY secret not configured");
  }
  const keyBuffer = base64ToArrayBuffer(privateKeyBase64);
  return crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["unwrapKey"]
  );
}

async function decryptSensitivePayload(encrypted: EncryptedBlock): Promise<DecryptedSensitiveFields> {
  const rsaPrivateKey = await importRsaPrivateKey();
  const encryptedKeyBuffer = base64ToArrayBuffer(encrypted.encryptedKey);
  const iv = new Uint8Array(base64ToArrayBuffer(encrypted.iv));
  const ciphertext = base64ToArrayBuffer(encrypted.encryptedData);

  const aesKey = await crypto.subtle.unwrapKey(
    "raw",
    encryptedKeyBuffer,
    rsaPrivateKey,
    { name: "RSA-OAEP" },
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext
  );

  const jsonString = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(jsonString);
}

function mergeDecryptedFields(requestData: Record<string, unknown>, decrypted: DecryptedSensitiveFields): void {
  requestData.ssn = decrypted.ssn;
  requestData.benefitId = decrypted.benefitId;
  requestData.pdid = decrypted.pdid;
  requestData.phone = decrypted.phone;
  requestData.email = decrypted.email;
  requestData.agent = decrypted.agent;
  requestData.dob = decrypted.dob;
  requestData.city = decrypted.city;
  requestData.appliedPromo = decrypted.appliedPromo;

  if (decrypted.payment) {
    const existingPayment = (requestData.payment as Record<string, unknown>) || {};
    requestData.payment = { ...existingPayment, ...decrypted.payment };
  }

  if (decrypted.questionnaireAnswers) {
    requestData.questionnaireAnswers = decrypted.questionnaireAnswers;
  }

  if (decrypted.dependentSsns && Array.isArray(requestData.dependents)) {
    const dependents = requestData.dependents as Array<Record<string, unknown>>;
    decrypted.dependentSsns.forEach((ssn, index) => {
      if (index < dependents.length) {
        dependents[index].ssn = ssn;
      }
    });
  }

  delete requestData._encrypted;
}

function buildClearPayloadForLog(data: Record<string, unknown>): Record<string, unknown> {
  try {
    const clone = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    delete clone._encrypted;
    return clone;
  } catch {
    const { _encrypted: _enc, ...rest } = data;
    return { ...rest };
  }
}

async function insertPremiumCareLogSafe(
  supabase: ReturnType<typeof createClient>,
  params: {
    agentNumber: number;
    rawData: Record<string, unknown> | undefined;
    externalResponse: unknown;
    externalHttpStatus: number | null;
    fetchErrorMessage: string | null;
  },
): Promise<void> {
  try {
    let requestPayload: string | null = null;
    let payloadSizeBytes: number | null = null;
    if (params.rawData) {
      const clear = buildClearPayloadForLog(params.rawData);
      requestPayload = JSON.stringify(clear);
      payloadSizeBytes = new TextEncoder().encode(requestPayload).length;
    }

    let transactionSuccess: unknown = null;
    const ext = params.externalResponse;
    if (ext && typeof ext === "object") {
      const root = ext as Record<string, unknown>;
      const data = root.data;
      if (data && typeof data === "object") {
        const tx = (data as Record<string, unknown>).TRANSACTION;
        if (tx && typeof tx === "object" && "SUCCESS" in tx) {
          transactionSuccess = (tx as Record<string, unknown>).SUCCESS;
        }
      }
    }

    const logObj: Record<string, unknown> = {
      agentNumber: params.agentNumber,
      externalHttpStatus: params.externalHttpStatus,
      fetchError: params.fetchErrorMessage,
      transactionSuccess,
    };

    const responseText =
      params.externalResponse !== undefined && params.externalResponse !== null
        ? JSON.stringify(params.externalResponse)
        : null;

    const { error } = await supabase.from("premiumCare_log").insert({
      log: JSON.stringify(logObj),
      request_payload: requestPayload,
      payload_size_bytes: payloadSizeBytes,
      response: responseText,
    });
    if (error) {
      console.error("[premiumCare_log] insert failed:", error.message);
    }
  } catch (e) {
    console.error("[premiumCare_log] insert exception:", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
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

    // GET: poll the status of an existing submission (used by the frontend to
    // resume PDF/gateway phases after a duplicate-submit guard kicks in).
    if (req.method === "GET") {
      const statusSubmissionId = url.searchParams.get("submissionId");
      if (!isValidSubmissionId(statusSubmissionId)) {
        return new Response(
          JSON.stringify({ success: false, status: 400, error: "Valid submissionId query param is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const row = await loadSubmission(supabase, statusSubmissionId!);
      if (!row) {
        return new Response(
          JSON.stringify({ success: false, status: 404, error: "Submission not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          status: row.status,
          memberId: row.member_id,
          pdfUrl: row.pdf_url,
          gatewayAttempts: row.gateway_attempts,
          lastError: row.last_error,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, status: 405, error: "Method not allowed" }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Idempotency key from the client. When present we de-duplicate member
    // creation; when absent we fall back to the legacy direct-submit path so a
    // not-yet-updated frontend keeps working (tolerant rollout).
    const submissionIdHeader = req.headers.get("X-Submission-Id")?.trim() ?? "";
    const submissionId = isValidSubmissionId(submissionIdHeader) ? submissionIdHeader : null;

    let rawData: Record<string, unknown> | undefined;
    let externalResponseData: unknown = undefined;
    let externalHttpStatus: number | null = null;
    let fetchErrorMessage: string | null = null;

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

    rawData = await req.json() as Record<string, unknown>;

    try {
    if (rawData._encrypted) {
      try {
        const decrypted = await decryptSensitivePayload(rawData._encrypted as EncryptedBlock);
        mergeDecryptedFields(rawData, decrypted);
      } catch (decryptError) {
        return new Response(
          JSON.stringify({ success: false, status: 400, error: "Failed to decrypt enrollment payload" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const requestData: EnrollmentRequest = {
      firstName: (rawData.firstName || "").trim(),
      lastName: (rawData.lastName || "").trim(),
      dob: (rawData.dob || "").trim(),
      email: (rawData.email || "").trim().toLowerCase(),
      smoker: (rawData.smoker || "").trim(),
      address1: (rawData.address1 || "").trim(),
      city: (rawData.city || "").trim(),
      state: (rawData.state || "").trim().toUpperCase(),
      zipcode: (rawData.zipcode || "").trim(),
      phone: (rawData.phone || "").trim(),
      ssn: (rawData.ssn || "").trim(),
      gender: (rawData.gender || "").trim(),
      agent: (rawData.agent || "").trim(),
      uniqueId: (rawData.uniqueId || "").trim(),
      effectiveDate: (rawData.effectiveDate || "").trim(),
      benefitId: (rawData.benefitId || "").toString().trim(),
      selectedPrice: Number(rawData.selectedPrice) || 0,
      dependents: Array.isArray(rawData.dependents) ? rawData.dependents.map((dep: any) => ({
        firstName: (dep.firstName || "").trim(),
        lastName: (dep.lastName || "").trim(),
        dob: (dep.dob || "").trim(),
        smoker: (dep.smoker || "").trim(),
        relationship: dep.relationship === "Spouse" ? "Spouse" : "Child",
        address: (dep.address || "").trim(),
        city: (dep.city || "").trim(),
        state: (dep.state || "").trim().toUpperCase(),
        zipcode: (dep.zipcode || "").trim(),
        phone: (dep.phone || "").trim(),
        ssn: (dep.ssn || "").trim(),
        gender: (dep.gender || "").trim(),
        email: (dep.email || "").trim().toLowerCase(),
      })) : [],
      payment: rawData.payment || {},
      pdid: rawData.pdid ? Number(rawData.pdid) : undefined,
      promoCode: (rawData.promoCode || "").trim(),
      appliedPromo: rawData.appliedPromo,
    };

    const requiredFields: { field: string; value: string }[] = [
      { field: "firstName", value: requestData.firstName },
      { field: "lastName", value: requestData.lastName },
      { field: "dob", value: requestData.dob },
      { field: "email", value: requestData.email },
      { field: "address1", value: requestData.address1 },
      { field: "city", value: requestData.city },
      { field: "state", value: requestData.state },
      { field: "zipcode", value: requestData.zipcode },
      { field: "phone", value: requestData.phone },
      { field: "ssn", value: requestData.ssn },
      { field: "gender", value: requestData.gender },
      { field: "effectiveDate", value: requestData.effectiveDate },
    ];

    const missingFields = requiredFields.filter(f => !f.value).map(f => f.field);
    if (missingFields.length > 0) {
      return new Response(
        JSON.stringify({ success: false, status: 400, error: `Missing required fields: ${missingFields.join(", ")}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const ssnDigits = requestData.ssn.replace(/\D/g, '');
    if (ssnDigits.length !== 9) {
      return new Response(
        JSON.stringify({ success: false, status: 400, error: "SSN must be exactly 9 digits" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const phoneDigits = requestData.phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      return new Response(
        JSON.stringify({ success: false, status: 400, error: "Phone must be exactly 10 digits" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    for (const dep of requestData.dependents) {
      const depAgeError = dependentDobAgeValidationError(dep.relationship, dep.dob);
      if (depAgeError) {
        return new Response(
          JSON.stringify({ success: false, status: 400, error: depAgeError }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    if (!requestData.benefitId) {
      return new Response(
        JSON.stringify({ success: false, status: 400, error: "Benefit ID is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const validBenefitIds = [
      '3277', '3281', '3280', '3279', '3278',
      '3282', '3283', '3284', '3285', '3286',
      '3287', '3288', '3289', '3290', '3291',
      '3292', '3293', '3294', '3295', '3296',
    ];
    if (!validBenefitIds.includes(requestData.benefitId)) {
      return new Response(
        JSON.stringify({ success: false, status: 400, error: `Invalid benefit ID: ${requestData.benefitId}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!requestData.selectedPrice || requestData.selectedPrice <= 0) {
      return new Response(
        JSON.stringify({ success: false, status: 400, error: "Valid selected price is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!requestData.payment) {
      return new Response(
        JSON.stringify({ success: false, status: 400, error: "Payment information is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const isACH = requestData.payment.paymentType === 'ACH';
    const isListBill = requestData.payment.paymentType === 'LB';
    let sanitizedCardNumber = '';

    if (isACH) {
      if (!requestData.payment.achrouting || !requestData.payment.achaccount || !requestData.payment.achbank) {
        return new Response(
          JSON.stringify({ success: false, status: 400, error: "Incomplete ACH payment information" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const sanitizedRouting = requestData.payment.achrouting.replace(/\D/g, '');
      if (sanitizedRouting.length !== 9) {
        return new Response(
          JSON.stringify({ success: false, status: 400, error: "Routing number must be exactly 9 digits" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const sanitizedAccount = requestData.payment.achaccount.replace(/\D/g, '');
      if (sanitizedAccount.length === 0) {
        return new Response(
          JSON.stringify({ success: false, status: 400, error: "Invalid account number" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (!requestData.payment.achbank.trim()) {
        return new Response(
          JSON.stringify({ success: false, status: 400, error: "Bank name is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else if (isListBill) {
      // List Bill requires no card or bank details.
    } else {
      if (!requestData.payment.ccType || !requestData.payment.ccNumber ||
          !requestData.payment.ccExpMonth || !requestData.payment.ccExpYear) {
        return new Response(
          JSON.stringify({ success: false, status: 400, error: "Incomplete credit card information" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      sanitizedCardNumber = requestData.payment.ccNumber.replace(/\s/g, '');
      if (sanitizedCardNumber.length < 15 || sanitizedCardNumber.length > 16) {
        return new Response(
          JSON.stringify({ success: false, status: 400, error: "Invalid card number length" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const currentYear = new Date().getFullYear() % 100;
      const currentMonth = new Date().getMonth() + 1;
      const expYear = parseInt(requestData.payment.ccExpYear);
      const expMonth = parseInt(requestData.payment.ccExpMonth);
      if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
        return new Response(
          JSON.stringify({ success: false, status: 400, error: "Card has expired" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    const convertGender = (gender: string): string => {
      const normalized = gender.toLowerCase();
      if (normalized === 'male') return 'M';
      if (normalized === 'female') return 'F';
      return gender.toUpperCase();
    };

    const convertSmoker = (smoker: string): string => {
      const normalized = smoker.toLowerCase();
      if (normalized === 'yes') return 'Y';
      if (normalized === 'no') return 'N';
      return smoker.toUpperCase();
    };

    const extractPhoneDigits = (phone: string): string => {
      return phone.replace(/\D/g, '').slice(0, 10);
    };

    const extractSSNDigits = (ssn: string): string => {
      return ssn.replace(/\D/g, '').slice(0, 9);
    };

    const formatDateToMMDDYYYY = (dateString: string): string => {
      const date = new Date(dateString);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const year = date.getFullYear();
      return `${month}/${day}/${year}`;
    };

    const productFeeAmount = requestData.selectedPrice.toFixed(2);

    // List Bill enrollments never carry an enrollment fee.
    let enrollmentFeeAmount = isListBill ? "0.00" : "100.00";

    const effectivePromoPdid = getEffectivePromoPdid(requestData.pdid);

    if (!isListBill && requestData.promoCode && requestData.promoCode.trim() !== "") {
      const trimmedPromo = requestData.promoCode.trim();

      try {
        const pattern = escapePromoCodeForILike(trimmedPromo);
        const { data: promoRows, error: promoError } = await supabase
          .from("promocodes")
          .select("discount_amount, product")
          .ilike("code", pattern)
          .eq("active", true)
          .limit(50);

        const promoData = promoRows?.find((r) =>
          promoProductAppliesToPdid(r.product, effectivePromoPdid)
        );
        if (!promoError && promoData) {
          const discountAmount = parseFloat(String(promoData.discount_amount));

          if (!isNaN(discountAmount) && discountAmount >= 0) {
            const calculatedFee = Math.max(0, 100.0 - discountAmount);
            enrollmentFeeAmount = calculatedFee.toFixed(2);
          }
        }
      } catch (_error) {
      }
    }

    const isPrimarySmoker = requestData.smoker.toLowerCase() === 'yes';
    const hasSmokerDependent = requestData.dependents.some(dep => dep.smoker.toLowerCase() === 'yes');
    const tobaccoFeeAmount = (isPrimarySmoker || hasSmokerDependent) ? "75.00" : "0.00";

    const zohoContactId = (rawData.zohoContactId || "").trim();
    const referral = (rawData.referral || "").trim().slice(0, 24);
    const sourcedetail = referral
      ? `${referral} | Zoho: ${zohoContactId}`
      : "Zoho: " + zohoContactId;

    const memberData = {
      CORPID: 1402,
      AGENT: agentNumber,
      SOURCEDETAIL: sourcedetail,
      USEINTERNALIDASMEMBERID: "N",
      FIRSTNAME: requestData.firstName,
      LASTNAME: requestData.lastName,
      DOB: requestData.dob,
      EMAIL: requestData.email,
      ADDRESS1: requestData.address1,
      CITY: requestData.city,
      STATE: requestData.state,
      ZIPCODE: requestData.zipcode,
      PHONE1: extractPhoneDigits(requestData.phone),
      GENDER: convertGender(requestData.gender),
      TOBACCO: convertSmoker(requestData.smoker),
      SSN: extractSSNDigits(requestData.ssn || ''),
      PAYMENTPROCESS: "Y",
      DEPENDENTS: requestData.dependents.map(dep => ({
        FIRSTNAME: dep.firstName,
        LASTNAME: dep.lastName,
        ADDRESS: dep.address || requestData.address1,
        CITY: dep.city || requestData.city,
        STATE: dep.state || requestData.state,
        ZIPCODE: (dep.zipcode || requestData.zipcode).replace(/\D/g, ''),
        PHONE1: extractPhoneDigits(dep.phone || ''),
        DOB: dep.dob,
        GENDER: convertGender(dep.gender || 'M'),
        SSN: extractSSNDigits(dep.ssn || ''),
        EMAIL: dep.email || '',
        RELATIONSHIP: dep.relationship,
        TOBACCO: convertSmoker(dep.smoker),
      })),
      PRODUCTS: [
        {
          PDID: (requestData.pdid && requestData.pdid > 0) ? requestData.pdid : DEFAULT_ENROLLMENT_PDID,
          BENEFITID: parseInt(requestData.benefitId),
          periodid: 1,
          dtEffective: formatDateToMMDDYYYY(requestData.effectiveDate),
          bPaid: "N",
          FEES: [
            { TYPE: "Annual Membership", AMOUNT: "25.00", BENEFITID: 9493, PERIODID: 5 },
            { TYPE: "Enrollment", AMOUNT: enrollmentFeeAmount, BENEFITID: 6335, PERIODID: 7 },
            { TYPE: "Product", AMOUNT: productFeeAmount, BENEFITID: parseInt(requestData.benefitId), PERIODID: 1 },
            { TYPE: "Tobacco Use", AMOUNT: tobaccoFeeAmount, BENEFITID: 8037, PERIODID: 1 },
          ],
        },
      ],
      PAYMENT: isACH ? {
        PAYMENTTYPE: "ACH",
        ACHROUTING: requestData.payment.achrouting,
        ACHACCOUNT: requestData.payment.achaccount,
        ACHBANK: requestData.payment.achbank,
        FIRSTNAME: requestData.firstName,
        LASTNAME: requestData.lastName,
      } : isListBill ? {
        PAYMENTTYPE: "LB",
        CCEXPYEAR: "",
        CCTYPE: "",
        CCNUMBER: "",
        CCEXPMONTH: "",
      } : {
        CCEXPYEAR: requestData.payment.ccExpYear,
        PAYMENTTYPE: "CC",
        CCTYPE: requestData.payment.ccType,
        CCNUMBER: sanitizedCardNumber,
        CCEXPMONTH: requestData.payment.ccExpMonth,
        FIRSTNAME: requestData.firstName,
        LASTNAME: requestData.lastName,
      },
    };

    const memberJsonString = JSON.stringify(memberData);

    // Idempotency gate: ensure the member is created at most once per submission.
    if (submissionId) {
      const payloadHash = computePayloadHash(
        requestData.email,
        requestData.effectiveDate,
        requestData.benefitId,
        agentNumber,
      );

      const { row: submissionRow, error: submissionError } = await upsertSubmissionStarted(
        supabase,
        {
          submissionId,
          customerEmail: requestData.email,
          agentNumber,
          payloadHash,
        },
      );

      if (submissionError === "in_progress") {
        return new Response(
          JSON.stringify({
            success: false,
            status: 409,
            error: "Enrollment already in progress for this submission",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (submissionRow?.member_id) {
        return new Response(
          JSON.stringify(
            buildIdempotentEnrollmentResponse(
              submissionRow.enrollment_response,
              submissionRow.member_id,
            ),
          ),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const formData = new URLSearchParams();
    formData.append("member", memberJsonString);

    const authString = btoa(`${username}:${password}`);

    const externalApiUrl = `https://api.1administration.com/v1/${agentNumber}/member/0.json`;

    let response: Response;
    try {
      response = await fetch(externalApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${authString}`,
        },
        body: formData.toString(),
      });
    } catch (fetchError) {
      fetchErrorMessage = fetchError instanceof Error ? fetchError.message : "Unknown fetch error";
      return new Response(
        JSON.stringify({
          success: false,
          status: 504,
          error: "Failed to reach external enrollment API",
          message: fetchError instanceof Error ? fetchError.message : "Unknown fetch error",
        }),
        {
          status: 504,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let responseData: unknown;
    try {
      responseData = await response.json();
    } catch {
      const text = await response.text().catch(() => "Unable to read response body");
      externalHttpStatus = response.status;
      externalResponseData = {
        nonJsonResponse: true,
        preview: String(text).substring(0, 500),
      };
      return new Response(
        JSON.stringify({
          success: false,
          status: 502,
          error: "External API returned non-JSON response",
          message: `Status ${response.status}: ${String(text).substring(0, 200)}`,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    externalResponseData = responseData;
    externalHttpStatus = response.status;

    // Record the member id so retries replay instead of re-enrolling.
    if (submissionId && response.ok && responseData && typeof responseData === "object") {
      const root = responseData as Record<string, unknown>;
      const tx = root.TRANSACTION as Record<string, unknown> | undefined;
      const txVal = (tx?.SUCCESS ?? root.SUCCESS) as unknown;
      const isSuccess =
        txVal === true ||
        txVal === "true" ||
        (typeof txVal === "string" && txVal.toLowerCase() === "true");

      if (isSuccess) {
        const enrolledMemberId = extractMemberIdFromExternalResponse(responseData);
        if (enrolledMemberId) {
          await markSubmissionEnrolled(supabase, submissionId, enrolledMemberId, responseData);
        }
      }
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

    } finally {
      await insertPremiumCareLogSafe(supabase, {
        agentNumber,
        rawData,
        externalResponse: externalResponseData,
        externalHttpStatus,
        fetchErrorMessage,
      });
    }

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
