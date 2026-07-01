import { User, Mail, AlertCircle } from 'lucide-react';
import { FormData, Dependent, AppliedPromo } from '../hooks/useEnrollmentStorage';
import DependentsSection from './DependentsSection';
import EnrollmentSummary from './EnrollmentSummary';
import { formatDOB } from '../utils/formatters';

interface Step1PersonalInfoProps {
  formData: FormData;
  errors: Record<string, string>;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onNext: () => void;
  onAddSpouse: () => void;
  onAddChild: () => void;
  onChangeDependent: (index: number, field: keyof Dependent, value: string) => void;
  onRemoveDependent: (index: number) => void;
  onChangePlan: (productId: string, plan: string) => void;
  onRemoveProduct: (productId: string) => void;
  onBenefitIdChange: (benefitId: string) => void;
  onPromoCodeChange: (code: string) => void;
  onAppliedPromoChange: (promo: AppliedPromo | null) => void;
  employeeGroup?: string | null;
}

export default function Step1PersonalInfo({
  formData,
  errors,
  onChange,
  onNext,
  onAddSpouse,
  onAddChild,
  onChangeDependent,
  onRemoveDependent,
  onChangePlan,
  onRemoveProduct,
  onBenefitIdChange,
  onPromoCodeChange,
  onAppliedPromoChange,
  employeeGroup = null,
}: Step1PersonalInfoProps) {
  const handleDOBChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatDOB(e.target.value, formData.dob);
    onChange({ ...e, target: { ...e.target, name: 'dob', value: formatted } });
  };

  const handleNameBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const trimmedValue = e.target.value.trim();
    if (trimmedValue !== e.target.value) {
      onChange({ ...e, target: { ...e.target, value: trimmedValue } });
    }
  };

  return (
    <div className="space-y-8">
      {errors.essentialPlan && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-300 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-900 mb-1">Cannot Continue to Next Step</h3>
            <p className="text-sm text-red-700">{errors.essentialPlan}</p>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <User className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl font-semibold text-gray-800">Personal Information</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="firstName"
              value={formData.firstName}
              onChange={onChange}
              onBlur={handleNameBlur}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                errors.firstName ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder=""
            />
            {errors.firstName && <p className="mt-1 text-sm text-red-500">{errors.firstName}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="lastName"
              value={formData.lastName}
              onChange={onChange}
              onBlur={handleNameBlur}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                errors.lastName ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder=""
            />
            {errors.lastName && <p className="mt-1 text-sm text-red-500">{errors.lastName}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Date of Birth (MM/DD/YYYY) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="dob"
              value={formData.dob}
              onChange={handleDOBChange}
              maxLength={10}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                errors.dob ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder=""
            />
            {errors.dob && <p className="mt-1 text-sm text-red-500">{errors.dob}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={onChange}
                className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                  errors.email ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder=""
              />
            </div>
            {errors.email && <p className="mt-1 text-sm text-red-500">{errors.email}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Smoker <span className="text-red-500">*</span>
            </label>
            <select
              name="smoker"
              value={formData.smoker}
              onChange={onChange}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition appearance-none bg-white ${
                errors.smoker ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <option value="">Select...</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
            {errors.smoker && <p className="mt-1 text-sm text-red-500">{errors.smoker}</p>}
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 my-8"></div>

      <DependentsSection
        dependents={formData.dependents}
        errors={errors}
        onAddSpouse={onAddSpouse}
        onAddChild={onAddChild}
        onChangeDependent={onChangeDependent}
        onRemoveDependent={onRemoveDependent}
        benefitId={formData.benefitId}
      />

      <div className="border-t border-gray-200 my-8"></div>

      <EnrollmentSummary
        products={formData.products}
        dependents={formData.dependents}
        onChangePlan={onChangePlan}
        onRemoveProduct={onRemoveProduct}
        benefitId={formData.benefitId}
        memberDOB={formData.dob}
        smoker={formData.smoker}
        errors={errors}
        onBenefitIdChange={onBenefitIdChange}
        promoCode={formData.promoCode}
        appliedPromo={formData.appliedPromo}
        onPromoCodeChange={onPromoCodeChange}
        onAppliedPromoChange={onAppliedPromoChange}
        pdid={formData.pdid}
        employeeGroup={employeeGroup}
      />

      <div className="pt-6">
        <button
          type="button"
          onClick={onNext}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition duration-200"
        >
          Continue to Enrollment Details
        </button>
      </div>
    </div>
  );
}
