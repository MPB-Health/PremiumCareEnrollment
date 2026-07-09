import { MapPin, ArrowLeft, Loader2, XCircle, ChevronDown, ChevronUp, FileText, Receipt, Eye, EyeOff } from 'lucide-react';
import { FormData, Dependent, PaymentInfo } from '../hooks/useEnrollmentStorage';
import { calculateEffectiveDates, formatEffectiveDateDisplay } from '../utils/dateCalculations';
import { formatPhoneNumber, formatSSN } from '../utils/formatters';
import { useState, useMemo, useEffect, useRef } from 'react';
import DependentsAddressSection from './DependentsAddressSection';
import PreExistingConditionsSection from './PreExistingConditionsSection';
import PaymentInformationSection from './PaymentInformationSection';
import { applyPromoDiscount } from '../utils/promoCodeService';
import { TOBACCO_MONTHLY_FEE_USD } from '../constants/pricing';
import {
  getPrimarySubscriberPhoneDuplicateError,
  getPrimarySubscriberSsnDuplicateError,
} from '../utils/dependentPhoneSsnDuplicateValidation';
import {
  isPremiumCareProhibitedState,
  PREMIUM_CARE_STATE_UNAVAILABLE_MESSAGE,
} from '../constants/premiumCareProhibitedStates';

interface ApiResponse {
  success: boolean;
  status: number;
  data?: any;
  error?: string;
  message?: string;
}

interface Step2AddressInfoProps {
  formData: FormData;
  errors: Record<string, string>;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onBack: () => void;
  onSubmit: () => void;
  loading: boolean;
  finishingEnrollment?: boolean;
  response: ApiResponse | null;
  onUpdateDependent: (index: number, dependent: Dependent) => void;
  onPaymentChange: (field: keyof PaymentInfo, value: string) => void;
  onClearError?: (field: string) => void;
  invalidDependentIndices?: number[];
  employeeGroup?: string | null;
}

export default function Step2AddressInfo({
  formData,
  errors,
  onChange,
  onBack,
  onSubmit,
  loading,
  finishingEnrollment = false,
  response,
  onUpdateDependent,
  onPaymentChange,
  onClearError,
  invalidDependentIndices = [],
  employeeGroup = null,
}: Step2AddressInfoProps) {
  const [showReview, setShowReview] = useState(true);
  const [showSSN, setShowSSN] = useState(false);
  const supportsTextSecurity = typeof CSS !== 'undefined' && CSS.supports?.('-webkit-text-security', 'disc');
  const errorMessageRef = useRef<HTMLDivElement>(null);
  const effectiveDateOptions = calculateEffectiveDates();

  const isProhibitedState = useMemo(
    () => isPremiumCareProhibitedState(formData.state),
    [formData.state]
  );

  const primaryStateAvailabilityError =
    formData.state && isProhibitedState ? PREMIUM_CARE_STATE_UNAVAILABLE_MESSAGE : '';
  const primaryStateFieldError = errors.state || primaryStateAvailabilityError;

  const pricingSummary = useMemo(() => {
    const isListBill =
      formData.payment.paymentMethod === 'list-bill' ||
      (employeeGroup || '').trim().toUpperCase() === 'LB';
    const ONE_TIME_ENROLLMENT_FEE = isListBill ? 0 : 100;
    const totalEnrollmentFee = formData.products.reduce((sum, p) => sum + (p.enrollmentFee || 0), 0);
    const totalAnnualFee = isListBill
      ? 0
      : formData.products.reduce((sum, p) => sum + (p.annualFee || 0), 0);

    const carePlusProduct = formData.products.find(p => p.id === 'care-plus');
    const baseRecurringMonthly = carePlusProduct?.extractedPrice || 0;

    const subscriberIsSmoker = formData.smoker === 'Yes';
    const dependentIsSmoker = formData.dependents.some(d => d.smoker === 'Yes');
    const hasSmokerFee = subscriberIsSmoker || dependentIsSmoker;
    const smokerFee = hasSmokerFee ? TOBACCO_MONTHLY_FEE_USD : 0;
    const recurringMonthly = baseRecurringMonthly + smokerFee;

    const initialPaymentBeforeDiscount = totalEnrollmentFee + totalAnnualFee + ONE_TIME_ENROLLMENT_FEE;
    const initialPayment = applyPromoDiscount(initialPaymentBeforeDiscount, formData.appliedPromo);
    const hasDiscount = formData.appliedPromo !== null;

    return {
      annualMembershipFee: totalAnnualFee,
      oneTimeEnrollment: ONE_TIME_ENROLLMENT_FEE,
      initialPayment,
      recurringMonthly,
      hasDiscount,
      discountAmount: hasDiscount ? formData.appliedPromo!.discountAmount : 0,
      hasSmokerFee,
      smokerFee,
    };
  }, [formData.products, formData.appliedPromo, formData.smoker, formData.dependents, formData.payment.paymentMethod, employeeGroup]);

  const subscriberPhoneDuplicate = useMemo(
    () =>
      formData.dependents.length > 0
        ? getPrimarySubscriberPhoneDuplicateError(formData.phone, formData.dependents)
        : null,
    [formData.phone, formData.dependents]
  );

  const subscriberSsnDuplicate = useMemo(
    () =>
      formData.dependents.length > 0
        ? getPrimarySubscriberSsnDuplicateError(formData.ssn, formData.dependents)
        : null,
    [formData.ssn, formData.dependents]
  );

  const phoneFieldError = errors.phone || subscriberPhoneDuplicate || '';
  const ssnFieldError = errors.ssn || subscriberSsnDuplicate || '';

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value, formData.phone);
    onChange({ ...e, target: { ...e.target, name: 'phone', value: formatted } });
  };

  const handleSSNChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatSSN(e.target.value, formData.ssn);
    onChange({ ...e, target: { ...e.target, name: 'ssn', value: formatted } });
  };

  useEffect(() => {
    if (response && (response.success === false || response.data?.SUCCESS === "false" || response.data?.TRANSACTION?.SUCCESS === "false")) {
      errorMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [response]);

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl font-semibold text-gray-800">Address Information</h2>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Street Address <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="address1"
              value={formData.address1}
              onChange={onChange}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                errors.address1 ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder=""
            />
            {errors.address1 && <p className="mt-1 text-sm text-red-500">{errors.address1}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                City <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="city"
                value={formData.city}
                onChange={onChange}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                  errors.city ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder=""
              />
              {errors.city && <p className="mt-1 text-sm text-red-500">{errors.city}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                State <span className="text-red-500">*</span>
              </label>
              <select
                name="state"
                value={formData.state}
                onChange={onChange}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition appearance-none bg-white ${
                  primaryStateFieldError ? 'border-red-500' : 'border-gray-300'
                }`}
              >
                <option value="">Select...</option>
                <option value="AL">AL</option>
                <option value="AK">AK</option>
                <option value="AZ">AZ</option>
                <option value="AR">AR</option>
                <option value="CA">CA</option>
                <option value="CO">CO</option>
                <option value="CT">CT</option>
                <option value="DE">DE</option>
                <option value="FL">FL</option>
                <option value="GA">GA</option>
                <option value="HI">HI</option>
                <option value="ID">ID</option>
                <option value="IL">IL</option>
                <option value="IN">IN</option>
                <option value="IA">IA</option>
                <option value="KS">KS</option>
                <option value="KY">KY</option>
                <option value="LA">LA</option>
                <option value="ME">ME</option>
                <option value="MD">MD</option>
                <option value="MA">MA</option>
                <option value="MI">MI</option>
                <option value="MN">MN</option>
                <option value="MS">MS</option>
                <option value="MO">MO</option>
                <option value="MT">MT</option>
                <option value="NE">NE</option>
                <option value="NV">NV</option>
                <option value="NH">NH</option>
                <option value="NJ">NJ</option>
                <option value="NM">NM</option>
                <option value="NY">NY</option>
                <option value="NC">NC</option>
                <option value="ND">ND</option>
                <option value="OH">OH</option>
                <option value="OK">OK</option>
                <option value="OR">OR</option>
                <option value="PA">PA</option>
                <option value="RI">RI</option>
                <option value="SC">SC</option>
                <option value="SD">SD</option>
                <option value="TN">TN</option>
                <option value="TX">TX</option>
                <option value="UT">UT</option>
                <option value="VT">VT</option>
                <option value="VA">VA</option>
                <option value="WA">WA</option>
                <option value="WV">WV</option>
                <option value="WI">WI</option>
                <option value="WY">WY</option>
                <option value="DC">DC</option>
              </select>
              {primaryStateFieldError && (
                <p className="mt-1 text-sm text-red-600">{primaryStateFieldError}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Zipcode <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="zipcode"
                value={formData.zipcode}
                onChange={onChange}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                  errors.zipcode ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder=""
                maxLength={5}
              />
              {errors.zipcode && <p className="mt-1 text-sm text-red-500">{errors.zipcode}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Phone Number <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handlePhoneChange}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                  phoneFieldError ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="555-123-4567"
                maxLength={12}
              />
              {phoneFieldError && <p className="mt-1 text-sm text-red-500">{phoneFieldError}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Social Security <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={!showSSN && !supportsTextSecurity ? 'password' : 'text'}
                  name="ssn"
                  value={formData.ssn}
                  onChange={handleSSNChange}
                  autoComplete="new-password"
                  style={!showSSN && supportsTextSecurity ? { WebkitTextSecurity: 'disc' } : undefined}
                  className={`w-full px-4 pr-10 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                    ssnFieldError ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="XXX-XX-XXXX"
                  maxLength={11}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowSSN(!showSSN)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showSSN ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {ssnFieldError && <p className="mt-1 text-sm text-red-500">{ssnFieldError}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Gender <span className="text-red-500">*</span>
              </label>
              <select
                name="gender"
                value={formData.gender}
                onChange={onChange}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition appearance-none bg-white ${
                  errors.gender ? 'border-red-500' : 'border-gray-300'
                }`}
              >
                <option value="">Select...</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
              {errors.gender && <p className="mt-1 text-sm text-red-500">{errors.gender}</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 my-8"></div>

      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl font-semibold text-gray-800">Membership Start Date</h2>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Effective Date <span className="text-red-500">*</span>
          </label>
          <select
            name="effectiveDate"
            value={formData.effectiveDate}
            onChange={onChange}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition appearance-none bg-white ${
              errors.effectiveDate ? 'border-red-500' : 'border-gray-300'
            }`}
          >
            <option value="">Select effective date...</option>
            {effectiveDateOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.display}
              </option>
            ))}
          </select>
          {errors.effectiveDate && <p className="mt-1 text-sm text-red-500">{errors.effectiveDate}</p>}
        </div>
      </div>

      {formData.dependents.length > 0 && (
        <DependentsAddressSection
          dependents={formData.dependents}
          onUpdateDependent={onUpdateDependent}
          subscriberAddress={{
            address1: formData.address1,
            city: formData.city,
            state: formData.state,
            zipcode: formData.zipcode,
            email: formData.email,
            phone: formData.phone,
            ssn: formData.ssn,
          }}
          errors={errors}
          onClearError={onClearError}
          invalidDependentIndices={invalidDependentIndices}
        />
      )}

      <div className="border-t border-gray-200 my-8"></div>

      <PreExistingConditionsSection
        value={formData.preExistingConditionsAcknowledged}
        error={errors.preExistingConditionsAcknowledged}
        onChange={(value) => onChange({ target: { name: 'preExistingConditionsAcknowledged', value } } as any)}
      />

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <button
          type="button"
          onClick={() => setShowReview(!showReview)}
          className="w-full flex items-center justify-between text-left"
        >
          <h3 className="text-lg font-semibold text-blue-900">Review Your Information</h3>
          {showReview ? (
            <ChevronUp className="w-5 h-5 text-blue-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-blue-600" />
          )}
        </button>

        {showReview && (
          <div className="mt-4 space-y-6 text-sm">
            <div>
              <p className="text-gray-700 font-semibold mb-3">Primary member</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-600 font-medium">Name</p>
                  <p className="text-gray-900">{formData.firstName} {formData.lastName}</p>
                </div>
                <div>
                  <p className="text-gray-600 font-medium">Email</p>
                  <p className="text-gray-900">{formData.email || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-600 font-medium">Date of Birth</p>
                  <p className="text-gray-900">{formData.dob || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-600 font-medium">Smoker Status</p>
                  <p className="text-gray-900">{formData.smoker || '-'}</p>
                </div>
              </div>
            </div>

            {formData.dependents.length > 0 && (
              <div className="border-t border-gray-200 pt-4 mt-4">
                <p className="text-gray-700 font-semibold mb-3">Dependents</p>
                <div className="divide-y divide-gray-200">
                  {formData.dependents.map((dep, index) => (
                    <div
                      key={`review-dep-${index}`}
                      className="grid grid-cols-1 md:grid-cols-2 gap-3 py-4 first:pt-0"
                    >
                      <div>
                        <p className="text-gray-600 font-medium">Name</p>
                        <p className="text-gray-900">{dep.firstName} {dep.lastName}</p>
                      </div>
                      <div>
                        <p className="text-gray-600 font-medium">Relationship</p>
                        <p className="text-gray-900">{dep.relationship}</p>
                      </div>
                      <div>
                        <p className="text-gray-600 font-medium">Date of Birth</p>
                        <p className="text-gray-900">{dep.dob || '-'}</p>
                      </div>
                      <div>
                        <p className="text-gray-600 font-medium">Smoker Status</p>
                        <p className="text-gray-900">{dep.smoker || '-'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 my-6">
        <div className="flex items-center gap-2 mb-3">
          <Receipt className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            Your Membership Summary
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">Annual Membership</p>
            <p className="text-base font-semibold text-slate-800">
              ${pricingSummary.annualMembershipFee.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">One-Time Enrollment</p>
            <p className="text-base font-semibold text-slate-800">
              ${pricingSummary.oneTimeEnrollment.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Initial Payment</p>
            <p className="text-base font-bold text-blue-700">
              ${pricingSummary.initialPayment.toFixed(2)}
            </p>
            {pricingSummary.hasDiscount && (
              <p className="text-xs text-green-600">
                (${pricingSummary.discountAmount.toFixed(2)} discount applied)
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Recurring Monthly</p>
            <p className="text-base font-semibold text-slate-800">
              ${pricingSummary.recurringMonthly.toFixed(2)}
            </p>
            {pricingSummary.hasSmokerFee && (
              <p className="text-xs text-amber-600">
                (includes ${pricingSummary.smokerFee.toFixed(2)}/mo smoker fee)
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Effective Date</p>
            <p className="text-base font-semibold text-slate-800">
              {formData.effectiveDate ? formatEffectiveDateDisplay(formData.effectiveDate) : 'Not set'}
            </p>
          </div>
        </div>
      </div>

      <PaymentInformationSection
        payment={formData.payment}
        errors={errors}
        onChange={onPaymentChange}
        employeeGroup={employeeGroup}
      />

      {response && (response.success === false || response.data?.SUCCESS === "false" || response.data?.TRANSACTION?.SUCCESS === "false") ? (
        <div className="pt-6 bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
          <p className="text-lg font-semibold text-blue-900">
            You need to call support. Thank you.
          </p>
        </div>
      ) : (
        <div className="pt-6 flex flex-col gap-4">
          <div className="flex gap-4">
            <button
              type="button"
              onClick={onBack}
              disabled={loading || finishingEnrollment}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Previous Page
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={loading || finishingEnrollment || isProhibitedState}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {finishingEnrollment ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Finishing enrollment…
                </>
              ) : loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : isProhibitedState ? (
                'Premium Care unavailable in this state'
              ) : (
                'Submit Enrollment'
              )}
            </button>
          </div>
        </div>
      )}

      {response && (response.success === false || response.data?.SUCCESS === "false" || response.data?.TRANSACTION?.SUCCESS === "false") && (
        <div ref={errorMessageRef} className="p-6 rounded-lg border-2 bg-red-50 border-red-500">
          <div className="flex items-start gap-3">
            <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-2 text-red-900">
                {response.data?.TRANSACTION?.SUCCESS === "false" ? "Payment Rejected" : "Something Went Wrong"}
              </h3>
              <p className="text-red-800 mb-4">
                {response.data?.TRANSACTION?.SUCCESS === "false"
                  ? "Your payment was rejected. Please contact our support team for assistance."
                  : "We're sorry, but we couldn't complete your enrollment at this time. Please contact our support team for assistance."
                }
              </p>
              <div className="bg-white rounded-lg p-4 border border-red-200">
                <p className="font-semibold text-gray-900 mb-2">Contact Our Support Team:</p>
                <div className="space-y-1 text-sm text-gray-700">
                  <p>
                    <span className="font-medium">Email:</span>{' '}
                    <a href="mailto:support@mpbhealth.com" className="text-blue-600 hover:text-blue-700 underline">
                      support@mpbhealth.com
                    </a>
                  </p>
                  <p>
                    <span className="font-medium">Phone:</span>{' '}
                    <a href="tel:1-800-MPB-HEALTH" className="text-blue-600 hover:text-blue-700 underline">
                      1-800-MPB-HEALTH
                    </a>
                  </p>
                </div>
              </div>
              {(response.error || response.message) && (
                <details className="mt-3">
                  <summary className="cursor-pointer font-medium text-red-900">
                    View Error Details
                  </summary>
                  <div className="mt-2 text-sm space-y-1">
                    {response.error && (
                      <p className="text-red-800">
                        <span className="font-medium">Error:</span> {response.error}
                      </p>
                    )}
                    {response.message && (
                      <p className="text-red-800">
                        <span className="font-medium">Message:</span> {response.message}
                      </p>
                    )}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
