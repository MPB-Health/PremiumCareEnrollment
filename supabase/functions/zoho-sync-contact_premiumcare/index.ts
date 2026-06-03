import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EncryptedBlock {
  encryptedData: string;
  encryptedKey: string;
  iv: string;
}

interface DecryptedClientData {
  ssn: string;
  phone: string;
  email: string;
  dob: string;
  city: string;
  benefitId: string | null;
  agent: string;
  dependentSsns: string[];
  dependentPhones: string[];
  dependentEmails: string[];
  dependentDobs: string[];
  [key: string]: unknown;
}

interface DependentPayload {
  firstName: string;
  lastName: string;
  dob: string;
  relationship: "Spouse" | "Child";
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  phone?: string;
  ssn?: string;
  gender?: string;
  email?: string;
  useSameAddress?: boolean;
}

interface ZohoSyncPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: string;
  address1: string;
  city: string;
  state: string;
  zipcode: string;
  ssn: string;
  gender: string;
  effectiveDate: string;
  benefitId: string;
  selectedPrice: number;
  dependents: DependentPayload[];
  agentId: string;
  encrypted?: EncryptedBlock;
}

interface LogEntry {
  customer_email: string;
  zoho_contact_id: string | null;
  sync_type: string;
  sync_status: string;
  error_message: string | null;
  agent_id: string | null;
  monthly_premium: number | null;
}

const COVERAGE_MAP: Record<string, string> = {
  "3277": "Member Only",
  "3281": "Member Only",
  "3280": "Member Only",
  "3279": "Member Only",
  "3278": "Member Only",
  "3282": "Member + Spouse",
  "3283": "Member + Spouse",
  "3284": "Member + Spouse",
  "3285": "Member + Spouse",
  "3286": "Member + Spouse",
  "3287": "Member + Children",
  "3288": "Member + Children",
  "3289": "Member + Children",
  "3290": "Member + Children",
  "3291": "Member + Children",
  "3292": "Member + Family",
  "3293": "Member + Family",
  "3294": "Member + Family",
  "3295": "Member + Family",
  "3296": "Member + Family",
};

/** Zoho CRM `Product_Type` — fixed for Premium Care (PDID 43957); do not vary by benefit/IUA. */
const ZOHO_PRODUCT_TYPE = "PremiumCare(43957)";

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
    throw new Error("RSA_PRIVATE_KEY not configured");
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

async function decryptPayload(
  encrypted: EncryptedBlock
): Promise<DecryptedClientData> {
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

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits.slice(0, 10);
}

function normalizeSsn(ssn: string): string {
  return ssn.replace(/\D/g, "").slice(0, 9);
}

function convertDateToZoho(dateStr: string): string {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const [mm, dd, yyyy] = parts;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return dateStr;
}

function buildFullAddress(dep: DependentPayload): string {
  const parts = [dep.address, dep.city, dep.state, dep.zipcode].filter(
    Boolean
  );
  return parts.join(", ");
}

async function getZohoAccessToken(): Promise<string> {
  const clientId = Deno.env.get("ZOHO_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
  const refreshToken = Deno.env.get("ZOHO_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("ZOHO_CREDENTIALS_MISSING");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(
    `https://accounts.zoho.com/oauth/v2/token?${params.toString()}`,
    { method: "POST" }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ZOHO_AUTH_FAILED: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(
      `ZOHO_AUTH_NO_TOKEN: ${JSON.stringify(data)}`
    );
  }

  return data.access_token;
}

async function searchZohoContact(
  accessToken: string,
  email: string
): Promise<{ id: string } | null> {
  const response = await fetch(
    `https://www.zohoapis.com/crm/v2/Contacts/search?email=${encodeURIComponent(email)}`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    }
  );

  if (response.status === 204 || response.status === 404) return null;

  if (!response.ok) {
    const text = await response.text();
    if (text.includes("429") || text.toLowerCase().includes("rate limit")) {
      throw new Error("RATE_LIMITED");
    }
    return null;
  }

  const data = await response.json();
  if (data.data && data.data.length > 0) {
    return { id: data.data[0].id };
  }
  return null;
}

async function upsertZohoContact(
  accessToken: string,
  contactData: Record<string, unknown>,
  existingId: string | null
): Promise<{ id: string; action: string }> {
  const url = existingId
    ? `https://www.zohoapis.com/crm/v2/Contacts/${existingId}`
    : "https://www.zohoapis.com/crm/v2/Contacts";

  const method = existingId ? "PUT" : "POST";

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: [contactData] }),
  });

  const responseText = await response.text();

  if (
    responseText.includes("429") ||
    responseText.toLowerCase().includes("rate limit")
  ) {
    throw new Error("RATE_LIMITED");
  }

  let result: Record<string, unknown>;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(`ZOHO_INVALID_RESPONSE: ${responseText.substring(0, 300)}`);
  }

  const dataArr = result.data as Array<Record<string, unknown>> | undefined;
  if (dataArr && dataArr.length > 0) {
    const entry = dataArr[0];
    const details = entry.details as Record<string, unknown> | undefined;
    const code = entry.code as string;

    if (code === "DUPLICATE_DATA" && !existingId) {
      const dupId = details?.id as string;
      if (dupId) {
        return upsertZohoContact(accessToken, contactData, dupId);
      }
    }

    if (code === "SUCCESS" || code === "DUPLICATE_DATA") {
      return {
        id: (details?.id as string) || existingId || "",
        action: existingId ? "update" : "create",
      };
    }

    throw new Error(
      `ZOHO_API_ERROR: ${code} - ${entry.message || JSON.stringify(entry)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `ZOHO_HTTP_ERROR: ${response.status} - ${responseText.substring(0, 300)}`
    );
  }

  return { id: existingId || "", action: existingId ? "update" : "create" };
}

function buildZohoContactData(
  payload: ZohoSyncPayload,
  ownerName: string | null
): Record<string, unknown> {
  const contact: Record<string, unknown> = {
    First_Name: payload.firstName,
    Last_Name: payload.lastName,
    Email: payload.email,
    Phone: normalizePhone(payload.phone),
    Date_of_Birth: convertDateToZoho(payload.dob),
    Mailing_Street: payload.address1,
    Mailing_City: payload.city,
    Mailing_State: payload.state,
    Mailing_Zip: payload.zipcode,
    Social_Security_Number: normalizeSsn(payload.ssn),
    Primary_Member: payload.gender,
    Start_Date: convertDateToZoho(payload.effectiveDate),
    Monthly_Premium: payload.selectedPrice,
    Lead_Source: "Enrollment Platform",
    Account_Name: "Enrollment Website",
    Contact_Status: "New Enrollment",
    Carrier: "Sedera HealthShare",
    Company_Association: "MPB Health",
    Product_Type: ZOHO_PRODUCT_TYPE,
    Coverage_Option: COVERAGE_MAP[payload.benefitId] || "Unknown",
  };

  if (ownerName) {
    contact.Owner_Name = ownerName;
  }

  let spouseIndex = 0;
  let childIndex = 0;

  for (const dep of payload.dependents) {
    if (dep.relationship === "Spouse" && spouseIndex === 0) {
      spouseIndex++;
      contact.Spouse = `${dep.firstName} ${dep.lastName}`;
      contact.Spouse_DOB = convertDateToZoho(dep.dob);
      if (dep.email) contact.Spouse_Email = dep.email;
      if (dep.phone) contact.Spouse_Phone_Number = normalizePhone(dep.phone);
      if (dep.ssn) contact.Spouse_Social_Security = normalizeSsn(dep.ssn);
      const addr = buildFullAddress(dep);
      if (addr) contact.Spouse_Address = addr;
    } else if (dep.relationship === "Child") {
      childIndex++;
      const n = childIndex;
      contact[`Child_${n}`] = `${dep.firstName} ${dep.lastName}`;
      contact[`Child_${n}_DOB`] = convertDateToZoho(dep.dob);
      if (dep.email) contact[`Child_${n}_Email`] = dep.email;
      if (dep.phone)
        contact[`Child_${n}_Phone_Number`] = normalizePhone(dep.phone);
      if (dep.ssn)
        contact[`Child_${n}_S_S_Number`] = normalizeSsn(dep.ssn);
      const addr = buildFullAddress(dep);
      if (addr) contact[`Child_${n}_Address`] = addr;
    }
  }

  return contact;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let customerEmail = "unknown";
  let agentId: string | null = null;

  try {
    if (req.method !== "POST") {
      return jsonResponse({ success: false, error: "Method not allowed" }, 405);
    }

    let rawData: Record<string, unknown>;
    try {
      rawData = await req.json();
    } catch {
      return jsonResponse(
        { success: false, error: "Invalid JSON body" },
        400
      );
    }

    const encrypted = rawData.encrypted as EncryptedBlock | undefined;
    if (encrypted?.encryptedData && encrypted?.encryptedKey && encrypted?.iv) {
      try {
        const decrypted = await decryptPayload(encrypted);
        rawData.ssn = decrypted.ssn;
        rawData.phone = decrypted.phone;
        rawData.email = decrypted.email;
        rawData.dob = decrypted.dob;
        if (decrypted.city) rawData.city = decrypted.city;
        if (decrypted.benefitId) rawData.benefitId = decrypted.benefitId;

        const dependents = rawData.dependents as DependentPayload[] | undefined;
        if (dependents && Array.isArray(dependents)) {
          decrypted.dependentSsns?.forEach((val, i) => {
            if (i < dependents.length && val) dependents[i].ssn = val;
          });
          decrypted.dependentPhones?.forEach((val, i) => {
            if (i < dependents.length && val) dependents[i].phone = val;
          });
          decrypted.dependentEmails?.forEach((val, i) => {
            if (i < dependents.length && val) dependents[i].email = val;
          });
          decrypted.dependentDobs?.forEach((val, i) => {
            if (i < dependents.length && val) dependents[i].dob = val;
          });
        }

        delete rawData.encrypted;
      } catch {
        return jsonResponse(
          { success: false, error: "Decryption failed" },
          500
        );
      }
    }

    const payload: ZohoSyncPayload = {
      firstName: ((rawData.firstName as string) || "").trim(),
      lastName: ((rawData.lastName as string) || "").trim(),
      email: ((rawData.email as string) || "").trim().toLowerCase(),
      phone: ((rawData.phone as string) || "").trim(),
      dob: ((rawData.dob as string) || "").trim(),
      address1: ((rawData.address1 as string) || "").trim(),
      city: ((rawData.city as string) || "").trim(),
      state: ((rawData.state as string) || "").trim(),
      zipcode: ((rawData.zipcode as string) || "").trim(),
      ssn: ((rawData.ssn as string) || "").trim(),
      gender: ((rawData.gender as string) || "").trim(),
      effectiveDate: ((rawData.effectiveDate as string) || "").trim(),
      benefitId: ((rawData.benefitId as string) || "").toString().trim(),
      selectedPrice: Number(rawData.selectedPrice) || 0,
      dependents: Array.isArray(rawData.dependents)
        ? (rawData.dependents as DependentPayload[])
        : [],
      agentId: ((rawData.agentId as string) || "").trim(),
    };

    customerEmail = payload.email;
    agentId = payload.agentId || null;

    if (!payload.firstName || !payload.lastName || !payload.email) {
      return jsonResponse(
        {
          success: false,
          error: "Missing required fields: firstName, lastName, email",
        },
        400
      );
    }

    let ownerName: string | null = null;
    if (payload.agentId) {
      const { data: advisorData } = await supabase
        .from("advisor")
        .select("advisor_name")
        .eq("sales_id", parseInt(payload.agentId))
        .maybeSingle();

      if (advisorData?.advisor_name) {
        ownerName = advisorData.advisor_name;
      }
    }

    let accessToken: string;
    try {
      accessToken = await getZohoAccessToken();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      await supabase.from("zoho_sync_log").insert({
        customer_email: customerEmail,
        zoho_contact_id: null,
        sync_type: "auth_failure",
        sync_status: "failed",
        error_message: msg.substring(0, 500),
        agent_id: agentId,
        monthly_premium: payload.selectedPrice || null,
      });

      if (msg.includes("ZOHO_CREDENTIALS_MISSING")) {
        return jsonResponse(
          { success: false, error: "Zoho configuration missing" },
          500
        );
      }
      return jsonResponse(
        { success: false, error: "Zoho authentication failed" },
        502
      );
    }

    const existing = await searchZohoContact(accessToken, payload.email);
    const contactData = buildZohoContactData(payload, ownerName);

    let result: { id: string; action: string };
    try {
      result = await upsertZohoContact(
        accessToken,
        contactData,
        existing?.id || null
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      await supabase.from("zoho_sync_log").insert({
        customer_email: customerEmail,
        zoho_contact_id: existing?.id || null,
        sync_type: existing ? "update" : "create",
        sync_status: "failed",
        error_message: msg.substring(0, 500),
        agent_id: agentId,
        monthly_premium: payload.selectedPrice || null,
      });

      if (msg.includes("RATE_LIMITED")) {
        return jsonResponse(
          { success: false, error: "Zoho rate limit exceeded, retry later" },
          429
        );
      }

      return jsonResponse(
        { success: false, error: "Zoho sync failed", details: msg },
        500
      );
    }

    await supabase.from("zoho_sync_log").insert({
      customer_email: customerEmail,
      zoho_contact_id: result.id,
      sync_type: result.action,
      sync_status: "success",
      error_message: null,
      agent_id: agentId,
      monthly_premium: payload.selectedPrice || null,
    });

    return jsonResponse(
      {
        success: true,
        zohoContactId: result.id,
        action: result.action,
      },
      200
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";

    await supabase
      .from("zoho_sync_log")
      .insert({
        customer_email: customerEmail,
        zoho_contact_id: null,
        sync_type: "unknown",
        sync_status: "failed",
        error_message: msg.substring(0, 500),
        agent_id: agentId,
        monthly_premium: null,
      })
      .then(() => {});

    return jsonResponse(
      { success: false, error: "Internal server error" },
      500
    );
  }
});
