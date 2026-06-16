# List Bill Payment Option — Replication Runbook

This document describes how to replicate the **List Bill** payment option in another
enrollment project that shares the same layout and steps (e.g.
`https://securehsa.enrollmpb.com/?id=970362&employeegroup=LB`) but has a **different
URL, different pricing, and a differently-named edge function**.

The feature does two things:

1. **Adds a third payment type — "List Bill"** — alongside Credit Card and ACH.
   When selected, the submission edge function sends `"PAYMENTTYPE": "LB"` with empty
   card fields instead of card/ACH details.
2. **Gates the payment UI by a URL parameter** — `employeegroup=LB`. When present,
   Step 3 shows **only** the List Bill button and no card/bank fields. When absent (or
   any other value), Step 3 shows the normal **Credit Card + ACH** options.

---

## ⚠️ FIRST: Information the AI must collect before implementing

**AI: Before writing any code, STOP and ask the user the following. Do not assume.**

1. **Edge function name.** This project uses `enrollment-api-mec`. The target project
   uses a **different** edge function name for enrollment submission. Ask:
   > "What is the exact name of the enrollment-submission edge function in this project
   > (the one under `supabase/functions/<name>/index.ts` that builds the `PAYMENT`
   > object and calls the downstream enrollment API)?"
2. **Confirm the downstream payload shape.** Ask the user to confirm the List Bill
   payload the downstream API expects. The MEC default is:
   ```json
   "PAYMENT": {
     "PAYMENTTYPE": "LB",
     "CCEXPYEAR": "",
     "CCTYPE": "",
     "CCNUMBER": "",
     "CCEXPMONTH": ""
   }
   ```
   > "Should List Bill send exactly these fields, or does this project's downstream API
   > expect a different shape for `PAYMENTTYPE: LB`?"
3. **Confirm the URL parameter name and trigger value.** MEC uses `employeegroup=LB`
   (case-insensitive). Ask:
   > "Is the gating parameter still `employeegroup` with value `LB`, or different?"

Only after these answers should the AI proceed. Replace every reference to
`enrollment-api-mec` below with the confirmed edge function name.

---

## Architecture / data flow

```
URL (?employeegroup=LB)
  └─ App.tsx              reads `employeegroup` into `employeeGroup` state
       └─ EnrollmentWizard  passes `employeeGroup` down + maps paymentMethod→paymentType
            └─ Step2AddressInfo (Step 3 screen)  passes `employeeGroup` down
                 └─ PaymentInformationSection   listBillOnly gating + auto-select effect

On submit:
  formData.payment.paymentMethod = 'list-bill'
  formData.payment.paymentType   = 'LB'
       └─ <edge function>  branches on paymentType === 'LB' → sends PAYMENTTYPE: 'LB'
```

The wizard form state is **in-memory React state** (see `useEnrollmentStorage`), so the
`employeegroup` value is read from the URL on load and on every history change.

---

## Frontend changes

### 1. `src/hooks/useEnrollmentStorage.ts` — widen the payment type

Add `'list-bill'` to the `paymentMethod` union. Default stays `'credit-card'`.

```ts
export interface PaymentInfo {
  paymentMethod: 'credit-card' | 'ach' | 'list-bill';
  // ...
  paymentType: string; // 'CC' | 'ACH' | 'LB'
  // ...
}
```

### 2. `src/App.tsx` — read the `employeegroup` URL parameter

Add `employeeGroup` state initialized from the URL, refresh it inside the existing
`checkUrlParams()` (so it updates on navigation), and pass it to `EnrollmentWizard`.

```tsx
const [employeeGroup, setEmployeeGroup] = useState<string | null>(() => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('employeegroup');
});

// inside checkUrlParams():
setEmployeeGroup(urlParams.get('employeegroup'));

// in JSX:
<EnrollmentWizard
  /* ...existing props... */
  employeeGroup={employeeGroup}
/>
```

> Note: do **not** try to read this from the `advisor` DB table. Anonymous frontend
> reads are blocked by Supabase RLS in these projects — that is exactly why the URL
> parameter approach is used.

### 3. `src/components/EnrollmentWizard.tsx` — thread prop + map type + validation

Add `employeeGroup: string | null` to the props interface and destructure it.

Map `paymentMethod` → `paymentType` in `handlePaymentChange`:

```tsx
if (field === 'paymentMethod') {
  updatedPayment.paymentType = value === 'ach' ? 'ACH' : value === 'list-bill' ? 'LB' : 'CC';
}
```

Add the no-op List Bill branch in `validateStep3` (so it doesn't require card/ACH):

```tsx
} else if (formData.payment.paymentMethod === 'list-bill') {
  // List Bill requires no card or bank details.
}
```

Pass the prop into the Step 3 screen component:

```tsx
<Step2AddressInfo
  /* ...existing props... */
  employeeGroup={employeeGroup}
/>
```

### 4. `src/components/Step2AddressInfo.tsx` — pass-through prop

Add `employeeGroup?: string | null` to the props (default `null`) and forward it:

```tsx
<PaymentInformationSection
  /* ...existing props... */
  employeeGroup={employeeGroup}
/>
```

### 5. `src/components/PaymentInformationSection.tsx` — the gating + button

Import the `FileText` icon, accept the prop, compute `listBillOnly`, and auto-select.

```tsx
import { CreditCard, Lock, Building2, Eye, EyeOff, FileText } from 'lucide-react';

interface PaymentInformationSectionProps {
  // ...existing...
  employeeGroup?: string | null;
}

// inside the component:
const listBillOnly = (employeeGroup || '').trim().toUpperCase() === 'LB';

useEffect(() => {
  if (listBillOnly) {
    if (payment.paymentMethod !== 'list-bill') {
      onChange('paymentMethod', 'list-bill');
    }
  } else if (payment.paymentMethod === 'list-bill') {
    onChange('paymentMethod', 'credit-card');
  }
}, [listBillOnly, payment.paymentMethod, onChange]);
```

Render only the List Bill button when `listBillOnly`, otherwise the existing
Credit Card + ACH buttons:

```tsx
<div className={`grid grid-cols-1 gap-4 items-start ${listBillOnly ? '' : 'sm:grid-cols-2'}`}>
  {listBillOnly ? (
    <button
      type="button"
      onClick={() => onChange('paymentMethod', 'list-bill')}
      className={`flex w-full items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
        payment.paymentMethod === 'list-bill'
          ? 'border-blue-600 bg-blue-50 text-blue-700'
          : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
      }`}
    >
      <FileText className="w-5 h-5" />
      <span className="font-semibold">List Bill</span>
    </button>
  ) : (
    <>
      {/* existing Credit Card button (+ 3% fee note) and ACH button */}
    </>
  )}
</div>
```

Add a List Bill info box and make sure the card/ACH **detail field blocks** only render
for their own method (so List Bill shows nothing extra):

```tsx
{payment.paymentMethod === 'list-bill' && (
  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
    {/* FileText icon + */}
    <p className="text-sm text-blue-800 font-medium mb-1">List Bill</p>
    <p className="text-xs text-blue-700">
      Your membership will be billed through your group or organization.
      No card or bank details are required.
    </p>
  </div>
)}

{payment.paymentMethod === 'credit-card' ? (
  /* card fields */
) : payment.paymentMethod === 'ach' ? (
  /* ACH fields */
) : null}
```

> **Timing note (expected, not a bug):** on the very first render of Step 3 the card
> fields can flash briefly, then the `useEffect` switches `paymentMethod` to
> `'list-bill'` and they disappear. The settled state is correct.

### 6. `src/utils/generateEnrollmentPDF.ts` — show List Bill in the PDF

Add an `else if` branch so the generated PDF records the method:

```ts
} else if (formData.payment.paymentMethod === 'list-bill') {
  paymentInfo.push(
    ['Payment Method:', 'List Bill']
  );
}
```

---

## Backend change — the enrollment submission edge function

> **AI: use the edge function name the user provided.** In this project it is
> `supabase/functions/enrollment-api-mec/index.ts`. In the target project it is
> different — substitute accordingly.

### 1. Add a List Bill discriminator and skip card/ACH validation

```ts
const isACH = requestData.payment.paymentType === 'ACH';
const isListBill = requestData.payment.paymentType === 'LB';

if (isACH) {
  // ...existing ACH validation...
} else if (isListBill) {
  // List Bill requires no card or bank details.
} else {
  // ...existing credit card validation...
}
```

### 2. Build the `PAYMENT` object three ways

```ts
PAYMENT: isACH ? {
  PAYMENTTYPE: 'ACH',
  ACHROUTING: requestData.payment.achrouting,
  ACHACCOUNT: requestData.payment.achaccount,
  ACHBANK: requestData.payment.achbank,
  FIRSTNAME: requestData.firstName,
  LASTNAME: requestData.lastName,
} : isListBill ? {
  PAYMENTTYPE: 'LB',
  CCEXPYEAR: '',
  CCTYPE: '',
  CCNUMBER: '',
  CCEXPMONTH: '',
} : {
  CCEXPYEAR: requestData.payment.ccExpYear,
  PAYMENTTYPE: requestData.payment.paymentType,
  CCTYPE: requestData.payment.ccType,
  CCNUMBER: sanitizedCardNumber,
  CCEXPMONTH: requestData.payment.ccExpMonth,
  FIRSTNAME: requestData.firstName,
  LASTNAME: requestData.lastName,
},
```

### 3. Deploy

The edge function must be **redeployed** to Supabase after editing — code in git is not
live until deployed. Confirm the function name with the user, then deploy that function.

---

## Verification checklist

1. **With** `?employeegroup=LB` in the URL: Step 3 shows only the **List Bill** button,
   no card/bank fields, and the "billed through your group" info box.
2. **Without** the parameter (or any other value): Step 3 shows **Credit Card + ACH**.
3. Submitting a List Bill enrollment sends `PAYMENTTYPE: "LB"` with empty card fields to
   the downstream API (check the edge function logs / payload).
4. The generated PDF shows `Payment Method: List Bill`.
5. `npm run build` is clean.

### Local test walkthrough
Run `npm run dev`, open `http://localhost:5173/?id=<id>&employeegroup=LB`, complete
Steps 1–2, and confirm Step 3 shows only List Bill.

---

## Why it might "still show Credit Card + ACH" on the live site

If the live URL still shows the old options after the change is committed, the **frontend
has not been redeployed** to the host serving that domain. Commit + push to git does not
update the hosted bundle — trigger the deploy on the hosting provider. Likewise, the
edge function must be redeployed separately to Supabase.
