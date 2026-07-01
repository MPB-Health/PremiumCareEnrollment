import { ShoppingCart, X, AlertCircle, Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Product, Dependent, AppliedPromo } from '../hooks/useEnrollmentStorage';
import { calculateEssentialPricing, getCarePlusPricingOptions } from '../utils/pricingLogic';
import { extractProductIdFromDropdown, extractPriceFromDropdown } from '../utils/formatters';
import { validatePromoCode, applyPromoDiscount } from '../utils/promoCodeService';
import { TOBACCO_MONTHLY_FEE_USD } from '../constants/pricing';

interface EnrollmentSummaryProps {
  products: Product[];
  dependents: Dependent[];
  onChangePlan: (productId: string, plan: string, extractedBenefitId?: string, extractedPrice?: number) => void;
  onRemoveProduct: (productId: string) => void;
  benefitId: string | null;
  memberDOB: string;
  smoker: string;
  errors?: Record<string, string>;
  onBenefitIdChange: (benefitId: string) => void;
  promoCode: string;
  appliedPromo: AppliedPromo | null;
  onPromoCodeChange: (code: string) => void;
  onAppliedPromoChange: (promo: AppliedPromo | null) => void;
  /** Enrollment PDID for promocode product scope (see docs/promocode.md). */
  pdid: number;
  /** Employee group from URL params; "LB" forces List Bill (no enrollment fee). */
  employeeGroup?: string | null;
}

const planOptions: Record<string, { value: string; label: string; memberOnlyPrice?: number; plusOnePrice?: number; childrenPrice?: number }[]> = {
  'essentials': [
    { value: 'member-only', label: '$49.95 per Month for Member Only', memberOnlyPrice: 49.95 },
    { value: 'member-plus-one', label: '$59.95 per Month for Member plus One (Spouse or Child)', plusOnePrice: 59.95 },
  ],
};

export default function EnrollmentSummary({
  products,
  dependents,
  onChangePlan,
  onRemoveProduct,
  benefitId,
  memberDOB,
  smoker,
  errors = {},
  onBenefitIdChange,
  promoCode,
  appliedPromo,
  onPromoCodeChange,
  onAppliedPromoChange,
  pdid,
  employeeGroup = null,
}: EnrollmentSummaryProps) {
  const listBillOnly = (employeeGroup || '').trim().toUpperCase() === 'LB';
  const oneTimeEnrollmentFee = listBillOnly ? 0 : 100;
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);
  const [promoError, setPromoError] = useState<string>('');

  const essentialPricing = calculateEssentialPricing(dependents);
  const carePlusPricing = getCarePlusPricingOptions(memberDOB, dependents);

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) {
      setPromoError('Please enter an enrollment code');
      return;
    }

    setIsValidatingPromo(true);
    setPromoError('');

    const result = await validatePromoCode(promoCode, { pdid });

    setIsValidatingPromo(false);

    if (result.success && result.promo) {
      onAppliedPromoChange(result.promo);
      setPromoError('');
    } else {
      setPromoError(result.error || 'Invalid enrollment code');
      onAppliedPromoChange(null);
    }
  };

  const handleRemovePromo = () => {
    onPromoCodeChange('');
    onAppliedPromoChange(null);
    setPromoError('');
  };

  const getMobileDisplayText = (fullText: string): string => {
    const match = fullText.match(/^(.*?)(Member Only|Member \+ Spouse|Member \+ Children|Member \+ Family)/);
    if (match) {
      return match[0];
    }
    return fullText;
  };

  const calculateRecurringFee = (product: Product): number => {
    if (product.id === 'care-plus') {
      if (product.selectedPlan && carePlusPricing.isAvailable) {
        const selectedOption = carePlusPricing.options.find(
          opt => opt.displayText === product.selectedPlan
        );
        return selectedOption ? selectedOption.price : 0;
      }
      return 0;
    }

    const options = planOptions[product.id];
    if (!options) return product.recurringFee;

    const selectedOption = options.find(opt => opt.value === product.selectedPlan);
    if (!selectedOption) return product.recurringFee;

    if (product.selectedPlan === 'member-only') {
      return selectedOption.memberOnlyPrice || 0;
    } else if (product.selectedPlan === 'member-plus-one') {
      return selectedOption.plusOnePrice || 0;
    } else if (product.selectedPlan === 'member-children') {
      return selectedOption.childrenPrice || 0;
    }

    return product.recurringFee;
  };

  const totalEnrollmentFee = products.reduce((sum, product) => sum + product.enrollmentFee, 0);
  const totalRecurringFee = products.reduce((sum, product) => sum + calculateRecurringFee(product), 0);
  const totalAnnualFee = products.reduce((sum, product) => sum + (product.annualFee || 0), 0);

  const isSubscriberSmoker = smoker === 'Yes';
  const hasDependentSmoker = dependents.some(dep => dep.smoker === 'Yes');
  const tobaccoFee = (isSubscriberSmoker || hasDependentSmoker) ? TOBACCO_MONTHLY_FEE_USD : 0;

  const baseInitialPayment = totalEnrollmentFee + totalAnnualFee + oneTimeEnrollmentFee;
  const finalInitialPayment = applyPromoDiscount(baseInitialPayment, appliedPromo);
  const promoDiscount = baseInitialPayment - finalInitialPayment;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <ShoppingCart className="w-5 h-5 text-blue-600" />
        <h2 className="text-xl font-semibold text-gray-800">Enrollment Summary</h2>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-100 px-6 py-3 border-b border-gray-200">
          <div className="grid grid-cols-12 gap-4 font-semibold text-gray-700 text-sm">
            <div className="col-span-2"></div>
            <div className="col-span-7">Product</div>
            <div className="col-span-3 text-center">Cost</div>
          </div>
        </div>

        <div className="divide-y divide-gray-200">
          {products.map((product, index) => (
            <div
              key={product.id}
              className={`px-6 py-4 ${index % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
            >
              <div className="grid grid-cols-12 gap-4 items-start">
                <div className="hidden min-[426px]:block col-span-2">
                  <img
                    src={product.image}
                    alt={product.name}
                    className="w-full h-auto max-h-20 object-contain rounded"
                  />
                </div>

                <div className="col-span-12 min-[426px]:col-span-7">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">{product.name}</h3>

                  <div className="space-y-2">
                    <div>
                      {product.id === 'care-plus' ? (
                        <div className="space-y-2">
                          {carePlusPricing.isAvailable ? (
                            <>
                              <select
                                value={product.selectedPlan}
                                onChange={(e) => {
                                  const selectedText = e.target.value;
                                  const extractedId = extractProductIdFromDropdown(selectedText);
                                  const extractedPrice = extractPriceFromDropdown(selectedText);
                                  onChangePlan(product.id, selectedText, extractedId || undefined, extractedPrice || undefined);
                                  if (extractedId) {
                                    onBenefitIdChange(extractedId);
                                  }
                                }}
                                className={`hidden min-[426px]:block w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm ${
                                  errors.essentialPlan ? 'border-red-500 bg-red-50' : 'border-gray-300'
                                }`}
                              >
                                <option value="">Select IUA Level...</option>
                                {carePlusPricing.options.map((option, idx) => (
                                  <option key={idx} value={option.displayText}>
                                    {option.displayText}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={product.selectedPlan}
                                onChange={(e) => {
                                  const selectedText = e.target.value;
                                  const extractedId = extractProductIdFromDropdown(selectedText);
                                  const extractedPrice = extractPriceFromDropdown(selectedText);
                                  onChangePlan(product.id, selectedText, extractedId || undefined, extractedPrice || undefined);
                                  if (extractedId) {
                                    onBenefitIdChange(extractedId);
                                  }
                                }}
                                className={`block min-[426px]:hidden w-full px-2 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs ${
                                  errors.essentialPlan ? 'border-red-500 bg-red-50' : 'border-gray-300'
                                }`}
                              >
                                <option value="">Select IUA...</option>
                                {carePlusPricing.options.map((option, idx) => (
                                  <option key={idx} value={option.displayText}>
                                    {getMobileDisplayText(option.displayText)}
                                  </option>
                                ))}
                              </select>
                              {errors.essentialPlan && (
                                <p className="text-xs text-red-600">{errors.essentialPlan}</p>
                              )}
                            </>
                          ) : (
                            <div className="w-full px-3 py-2 border border-red-300 rounded-lg bg-red-50 text-sm text-red-700">
                              {carePlusPricing.errorMessage || 'Please enter your date of birth to see pricing options'}
                            </div>
                          )}
                        </div>
                      ) : (
                        <select
                          value={product.selectedPlan}
                          onChange={(e) => onChangePlan(product.id, e.target.value)}
                          className="w-full px-2 sm:px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs sm:text-sm"
                        >
                          {planOptions[product.id]?.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {product.id === 'care-plus' && product.annualFee && product.annualFee > 0 && (
                      <div className="space-y-1">
                        <p className="text-sm text-gray-700">${product.annualFee.toFixed(2)} per Year Annual Membership Fee</p>
                        <p className="text-sm text-gray-700">${oneTimeEnrollmentFee.toFixed(2)} one-time enrollment</p>
                      </div>
                    )}

                    {product.id === 'care-plus' && (
                      <div className="w-full px-3 py-2 border border-blue-200 rounded-lg bg-blue-50 text-sm text-gray-700">
                        Telehealth access to: Primary Care, Urgent Care, Mental Health, and Pet Care included.
                      </div>
                    )}

                    {product.enrollmentFee > 0 && (
                      <div>
                        <p className="text-sm text-gray-700">${product.enrollmentFee.toFixed(2)} one-time Enrollment Fee</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="col-span-12 min-[426px]:col-span-3 text-center">
                  <div className="space-y-1">
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
          <div className="max-w-md ml-auto space-y-2">
            {totalEnrollmentFee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">One-Time Enrollment Fee:</span>
                <span className="font-medium text-gray-800">${totalEnrollmentFee.toFixed(2)}</span>
              </div>
            )}

            {tobaccoFee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">Tobacco Use:</span>
                <span className="font-medium text-gray-800">${tobaccoFee.toFixed(2)}/month</span>
              </div>
            )}

            <div className="border-t border-gray-300 pt-3 pb-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enrollment code
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => onPromoCodeChange(e.target.value.toUpperCase())}
                  placeholder="Enter enrollment code"
                  disabled={appliedPromo !== null}
                  className={`flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm ${
                    promoError ? 'border-red-500' : 'border-gray-300'
                  } ${appliedPromo ? 'bg-gray-100' : ''}`}
                />
                {appliedPromo ? (
                  <button
                    type="button"
                    onClick={handleRemovePromo}
                    className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleApplyPromo}
                    disabled={isValidatingPromo}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 flex items-center gap-2"
                  >
                    {isValidatingPromo ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Validating
                      </>
                    ) : (
                      'Apply'
                    )}
                  </button>
                )}
              </div>
              {promoError && (
                <div className="flex items-center gap-1 mt-2 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  <span>{promoError}</span>
                </div>
              )}
              {appliedPromo && (
                <div className="flex items-center gap-1 mt-2 text-sm text-green-600">
                  <Check className="w-4 h-4" />
                  <span>Enrollment code applied successfully!</span>
                </div>
              )}
            </div>

            {totalAnnualFee > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700">Annual Membership Fee:</span>
                  <span className="font-medium text-gray-800">${totalAnnualFee.toFixed(2)}/year</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700">One-Time Enrollment:</span>
                  <span className="font-medium text-gray-800">${oneTimeEnrollmentFee.toFixed(2)}</span>
                </div>
              </>
            )}

            <div className="flex justify-between text-base font-semibold border-t border-gray-300 pt-2 text-gray-900">
              <span>Initial Payment:</span>
              <div className="text-right">
                {appliedPromo && promoDiscount > 0 && (
                  <>
                    <div className="text-sm text-gray-500 line-through font-normal">
                      ${baseInitialPayment.toFixed(2)}
                    </div>
                    <div className="text-xs text-green-600 font-normal">
                      -${promoDiscount.toFixed(2)} discount
                    </div>
                  </>
                )}
                <div>
                  ${finalInitialPayment.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="flex justify-between text-base font-semibold">
              <span className="text-gray-900">Recurring Monthly:</span>
              <span className="text-blue-600">${(totalRecurringFee + tobaccoFee).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
