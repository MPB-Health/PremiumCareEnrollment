import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { useEnrollmentStorage, Dependent, PaymentInfo, QuestionnaireAnswers, AppliedPromo } from '../hooks/useEnrollmentStorage';
import { getCarePlusPricingOptions, calculateAgeFromDOB } from '../utils/pricingLogic';
import { generateEnrollmentPDF } from '../utils/generateEnrollmentPDF';
import { getDependentEmailDuplicateError } from '../utils/dependentEmailValidation';
import {
  getDependentPhoneDuplicateError,
  getDependentSsnDuplicateError,
  getPrimarySubscriberPhoneDuplicateError,
  getPrimarySubscriberSsnDuplicateError,
} from '../utils/dependentPhoneSsnDuplicateValidation';
import { isChildDependentUnder18ForContactOptional } from '../utils/dependentAgeValidation';
import { encryptSensitiveFields } from '../utils/payloadEncryption';
import {
  getOrCreateSubmissionId,
  clearSubmissionId,
  fetchSubmissionStatus,
} from '../utils/enrollmentSubmission';
import ProgressIndicator from './ProgressIndicator';
import Step1PersonalInfo from './Step1PersonalInfo';
import Step2Questionnaire from './Step2Questionnaire';
import Step2AddressInfo from './Step2AddressInfo';
import ThankYouPage from './ThankYouPage';
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
  debug?: {
    apiUrl?: string;
    formData?: string;
    memberJsonString?: string;
    maskedPayload?: any;
    payloadPreview?: any;
  };
}

/** MEC success-only PDF retention: matches docs/PDF retained.md */
type EnrollmentJsonEval =
  | { kind: 'success'; memberId: string | null }
  | { kind: 'failure'; response: ApiResponse };

function evaluateEnrollmentFromJson(data: any, res: Response): EnrollmentJsonEval {
  const txVal = data.data?.TRANSACTION?.SUCCESS;
  const topVal = data.data?.SUCCESS;

  const transactionFailed =
    txVal === false ||
    txVal === 'false' ||
    (typeof txVal === 'string' && txVal.toLowerCase() === 'false');

  const topLevelFailed =
    topVal === false ||
    topVal === 'false' ||
    (typeof topVal === 'string' && topVal.toLowerCase() === 'false');

  if (transactionFailed || topLevelFailed) {
    return { kind: 'failure', response: data };
  }

  const transactionSuccess =
    !transactionFailed &&
    (txVal === true ||
      txVal === 'true' ||
      (typeof txVal === 'string' && txVal.toLowerCase() === 'true'));

  const hasSuccessFlag =
    !transactionFailed &&
    data.success === true &&
    (topVal === 'true' ||
      (typeof topVal === 'string' && topVal.toLowerCase() === 'true'));

  const enrollmentSuccess =
    (transactionSuccess || hasSuccessFlag) && !transactionFailed;

  if (!enrollmentSuccess) {
    return {
      kind: 'failure',
      response: {
        success: false,
        status: data.status || res.status,
        data: data.data,
        error: 'Enrollment could not be confirmed',
        message: 'The enrollment response was ambiguous. Please contact support.',
      },
    };
  }

  const memberId = data.data?.MEMBER?.ID?.toString() || null;
  return { kind: 'success', memberId };
}

interface EnrollmentWizardProps {
  benefitId: string | null;
  onBenefitIdChange: (benefitId: string) => void;
  agentId: string;
  employeeGroup?: string | null;
}

export default function EnrollmentWizard({ benefitId, onBenefitIdChange, agentId, employeeGroup = null }: EnrollmentWizardProps) {
  const { formData, currentStep, saveFormData, saveStep, clearStorage, clearFormDataOnly } = useEnrollmentStorage(benefitId, agentId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [finishingEnrollment, setFinishingEnrollment] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [processingNotice, setProcessingNotice] = useState<string | null>(null);
  const [showThankYou, setShowThankYou] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [invalidDependentIndices, setInvalidDependentIndices] = useState<number[]>([]);

  const [instanceId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const stored = sessionStorage.getItem('enrollment_instance');
    const isSubmitting = sessionStorage.getItem('form_submitting');
    if (stored && stored !== instanceId && !isSubmitting) {
      clearStorage();
    }
    sessionStorage.setItem('enrollment_instance', instanceId);
    return () => {
      sessionStorage.removeItem('enrollment_instance');
    };
  }, [instanceId, clearStorage]);

  useEffect(() => {
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  }, [currentStep]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const blankedDependents = formData.dependents.map(dep => ({
        ...dep,
        ssn: '',
      }));
      saveFormData({
        ...formData,
        ssn: '',
        payment: {
          ...formData.payment,
          ccNumber: '',
          achrouting: '',
          achaccount: '',
        },
        dependents: blankedDependents,
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [formData, saveFormData]);


  const formatDateInput = (value: string): string => {
    const digitsOnly = value.replace(/\D/g, '');

    if (digitsOnly.length <= 2) {
      return digitsOnly;
    } else if (digitsOnly.length <= 4) {
      return `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2)}`;
    } else {
      return `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2, 4)}/${digitsOnly.slice(4, 8)}`;
    }
  };

  const validateDateInput = (value: string): boolean => {
    if (value.length !== 10) return false;

    const [month, day, year] = value.split('/').map(num => parseInt(num, 10));

    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    if (year < 1925 || year > 2025) return false;

    const daysInMonth = new Date(year, month, 0).getDate();
    if (day > daysInMonth) return false;

    return true;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    let updatedData = { ...formData, [name]: value };

    if (name === 'dob') {
      const updatedProducts = formData.products.map(product =>
        product.id === 'care-plus'
          ? { ...product, selectedPlan: '', extractedBenefitId: undefined, extractedPrice: undefined }
          : product
      );
      updatedData = { ...updatedData, products: updatedProducts };
    }

    saveFormData(updatedData);

    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    if (name === 'dob' && errors.essentialPlan) {
      setErrors(prev => ({ ...prev, essentialPlan: '' }));
    }
  };

  const handleClearError = (field: string) => {
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });
  };

  const validateStep1 = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (!formData.dob.trim()) {
      newErrors.dob = 'Date of birth is required';
    } else if (!validateDateInput(formData.dob)) {
      newErrors.dob = 'Invalid date. Please enter a valid date in MM/DD/YYYY format';
    } else {
      const age = calculateAgeFromDOB(formData.dob);
      if (age !== null && age < 18) {
        newErrors.dob = 'Must be 18 years or older to enroll';
      }
    }
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }
    if (!formData.smoker.trim()) newErrors.smoker = 'Smoker status is required';

    formData.dependents.forEach((dependent, index) => {
      const prefix = `dependent_${index}_`;
      if (!dependent.firstName.trim()) newErrors[`${prefix}firstName`] = 'First name is required';
      if (!dependent.lastName.trim()) newErrors[`${prefix}lastName`] = 'Last name is required';
      if (!dependent.dob.trim()) {
        newErrors[`${prefix}dob`] = 'Date of birth is required';
      } else if (!validateDateInput(dependent.dob)) {
        newErrors[`${prefix}dob`] = 'Invalid date. Please enter a valid date in MM/DD/YYYY format';
      } else if (dependent.relationship === 'Spouse') {
        const age = calculateAgeFromDOB(dependent.dob);
        if (age !== null && age < 18) {
          newErrors[`${prefix}dob`] = 'Must be 18 years or older to enroll';
        }
      } else if (dependent.relationship === 'Child') {
        const age = calculateAgeFromDOB(dependent.dob);
        if (age !== null && age >= 26) {
          newErrors[`${prefix}dob`] = 'Child dependents must be under 26 years old';
        }
      }
      if (!dependent.smoker.trim()) newErrors[`${prefix}smoker`] = 'Smoker status is required';
    });

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      const firstErrorKey = Object.keys(newErrors)[0];
      setTimeout(() => {
        const errorElement = document.querySelector(`[name="${firstErrorKey}"]`) as HTMLElement;
        if (errorElement) {
          errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          errorElement.focus();
        }
      }, 100);
    }

    return Object.keys(newErrors).length === 0;
  };

  const validateStep3 = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.address1.trim()) newErrors.address1 = 'Address is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.state.trim()) {
      newErrors.state = 'State is required';
    } else if (isPremiumCareProhibitedState(formData.state)) {
      newErrors.state = PREMIUM_CARE_STATE_UNAVAILABLE_MESSAGE;
    }
    if (!formData.zipcode.trim()) {
      newErrors.zipcode = 'Zipcode is required';
    } else if (formData.zipcode.length !== 5 || !/^\d{5}$/.test(formData.zipcode)) {
      newErrors.zipcode = 'Zipcode must be exactly 5 digits';
    }
    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone number is required';
    } else {
      const phoneDigits = formData.phone.replace(/\D/g, '');
      if (phoneDigits.length !== 10) {
        newErrors.phone = 'Phone number must be exactly 10 digits';
      } else if (formData.dependents.length > 0) {
        const subPhoneDup = getPrimarySubscriberPhoneDuplicateError(
          formData.phone,
          formData.dependents
        );
        if (subPhoneDup) newErrors.phone = subPhoneDup;
      }
    }
    if (!formData.ssn.trim()) {
      newErrors.ssn = 'Social Security number is required';
    } else {
      const ssnDigits = formData.ssn.replace(/\D/g, '');
      if (ssnDigits.length !== 9) {
        newErrors.ssn = 'Social Security number must be exactly 9 digits';
      } else if (formData.dependents.length > 0) {
        const subSsnDup = getPrimarySubscriberSsnDuplicateError(
          formData.ssn,
          formData.dependents
        );
        if (subSsnDup) newErrors.ssn = subSsnDup;
      }
    }
    if (!formData.gender.trim()) newErrors.gender = 'Gender is required';
    if (!formData.effectiveDate.trim()) newErrors.effectiveDate = 'Effective date is required';
    if (!formData.preExistingConditionsAcknowledged.trim()) {
      newErrors.preExistingConditionsAcknowledged = 'You must acknowledge the pre-existing conditions terms';
    }

    if (formData.payment.paymentMethod === 'credit-card') {
      if (!formData.payment.ccType.trim()) newErrors.ccType = 'Card type is required';
      if (!formData.payment.ccNumber.trim()) {
        newErrors.ccNumber = 'Card number is required';
      } else if (formData.payment.ccNumber.length < 15 || formData.payment.ccNumber.length > 16) {
        newErrors.ccNumber = 'Invalid card number length';
      }
      if (!formData.payment.ccExpMonth.trim()) newErrors.ccExpMonth = 'Expiration month is required';
      if (!formData.payment.ccExpYear.trim()) {
        newErrors.ccExpYear = 'Expiration year is required';
      } else {
        const currentYear = new Date().getFullYear() % 100;
        const currentMonth = new Date().getMonth() + 1;
        const expYear = parseInt(formData.payment.ccExpYear);
        const expMonth = parseInt(formData.payment.ccExpMonth);
        if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
          newErrors.ccExpYear = 'Card has expired';
        }
      }
    } else if (formData.payment.paymentMethod === 'ach') {
      if (!formData.payment.achrouting.trim()) {
        newErrors.achrouting = 'Routing number is required';
      } else if (formData.payment.achrouting.length !== 9) {
        newErrors.achrouting = 'Routing number must be exactly 9 digits';
      }
      if (!formData.payment.achaccount.trim()) {
        newErrors.achaccount = 'Account number is required';
      }
      if (!formData.payment.achbank.trim()) {
        newErrors.achbank = 'Bank name is required';
      }
    } else if (formData.payment.paymentMethod === 'list-bill') {
      // List Bill requires no card or bank details.
    }

    const invalidIndices: number[] = [];
    formData.dependents.forEach((dependent, index) => {
      const prefix = `dependent_${index}_`;
      let hasError = false;

      // Only validate address fields if NOT using same address as subscriber
      if (!dependent.useSameAddress) {
        if (!dependent.address?.trim()) {
          newErrors[`${prefix}address`] = 'Address is required';
          hasError = true;
        }
        if (!dependent.city?.trim()) {
          newErrors[`${prefix}city`] = 'City is required';
          hasError = true;
        }
        if (!dependent.state?.trim()) {
          newErrors[`${prefix}state`] = 'State is required';
          hasError = true;
        }
        if (!dependent.zipcode?.trim()) {
          newErrors[`${prefix}zipcode`] = 'Zipcode is required';
          hasError = true;
        } else if (dependent.zipcode.length !== 5 || !/^\d{5}$/.test(dependent.zipcode)) {
          newErrors[`${prefix}zipcode`] = 'Zipcode must be exactly 5 digits';
          hasError = true;
        }
      }

      const skipContactRequired = isChildDependentUnder18ForContactOptional(
        dependent.dob,
        dependent.relationship
      );

      if (!dependent.email?.trim()) {
        if (!skipContactRequired) {
          newErrors[`${prefix}email`] = 'Email address is required';
          hasError = true;
        }
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dependent.email)) {
        newErrors[`${prefix}email`] = 'Email address must be valid';
        hasError = true;
      } else {
        const dup = getDependentEmailDuplicateError(
          dependent.email,
          index,
          formData.dependents,
          formData.email
        );
        if (dup) {
          newErrors[`${prefix}email`] = dup;
          hasError = true;
        }
      }
      if (!dependent.phone?.trim()) {
        if (!skipContactRequired) {
          newErrors[`${prefix}phone`] = 'Phone number is required';
          hasError = true;
        }
      } else {
        const phoneDigits = dependent.phone.replace(/\D/g, '');
        if (phoneDigits.length !== 10) {
          newErrors[`${prefix}phone`] = 'Phone must be exactly 10 digits';
          hasError = true;
        } else {
          const phDup = getDependentPhoneDuplicateError(
            dependent.phone,
            index,
            formData.dependents,
            formData.phone
          );
          if (phDup) {
            newErrors[`${prefix}phone`] = phDup;
            hasError = true;
          }
        }
      }
      if (!dependent.ssn?.trim()) {
        if (!skipContactRequired) {
          newErrors[`${prefix}ssn`] = 'Social Security is required';
          hasError = true;
        }
      } else {
        const ssnDigits = dependent.ssn.replace(/\D/g, '');
        if (ssnDigits.length !== 9) {
          newErrors[`${prefix}ssn`] = 'Social Security must be exactly 9 digits';
          hasError = true;
        } else {
          const ssnDup = getDependentSsnDuplicateError(
            dependent.ssn,
            index,
            formData.dependents,
            formData.ssn
          );
          if (ssnDup) {
            newErrors[`${prefix}ssn`] = ssnDup;
            hasError = true;
          }
        }
      }
      if (!dependent.gender?.trim()) {
        newErrors[`${prefix}gender`] = 'Gender is required';
        hasError = true;
      }

      if (hasError) {
        invalidIndices.push(index);
      }
    });

    setErrors(newErrors);
    setInvalidDependentIndices(invalidIndices);

    if (Object.keys(newErrors).length > 0) {
      const firstErrorKey = Object.keys(newErrors)[0];
      setTimeout(() => {
        let errorElement: HTMLElement | null = null;

        if (invalidIndices.length > 0 && firstErrorKey.startsWith('dependent_')) {
          const dependentsSection = document.querySelector('[data-dependents-section]') as HTMLElement;
          if (dependentsSection) {
            dependentsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }

        if (firstErrorKey === 'preExistingConditionsAcknowledged') {
          errorElement = document.querySelector(`[name="preExistingConditions"]`) as HTMLElement;
        } else {
          errorElement = document.querySelector(`[name="${firstErrorKey}"]`) as HTMLElement;
        }

        if (errorElement) {
          errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          errorElement.focus();
        }
      }, 100);
    }

    const isValid = Object.keys(newErrors).length === 0;
    if (isValid) {
      setInvalidDependentIndices([]);
    }
    return isValid;
  };

  const handleNext = () => {
    if (!validateStep1()) {
      return;
    }

    const carePlusProduct = formData.products.find(p => p.id === 'care-plus');
    if (carePlusProduct) {
      const carePlusPricing = getCarePlusPricingOptions(formData.dob, formData.dependents);
      if (!carePlusPricing.isAvailable) {
        setErrors({
          essentialPlan: carePlusPricing.errorMessage || 'Invalid Premium Care plan configuration',
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (!carePlusProduct.selectedPlan) {
        setErrors({
          essentialPlan: 'Please select an IUA level for your Premium Care membership',
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (!carePlusProduct.extractedBenefitId) {
        setErrors({
          essentialPlan: 'Invalid IUA selection. Please select a valid IUA level.',
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }

    saveStep(2);
    setErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const validateStep2 = (): boolean => {
    const newErrors: Record<string, string> = {};
    const answers = formData.questionnaireAnswers;

    if (!answers.zionPrinciplesAccept) newErrors.zionPrinciplesAccept = 'Please respond regarding Premium Care Principles of Membership';
    if (!answers.zionm1a) newErrors.zionm1a = 'This field is required';
    if (!answers.zionm1b) newErrors.zionm1b = 'This field is required';
    if (!answers.zionm1d) newErrors.zionm1d = 'Please acknowledge or decline the terms above';
    if (!answers.zionmh2P) newErrors.zionmh2P = 'This field is required';
    if (!answers.maternityDeliveryAck) newErrors.maternityDeliveryAck = 'This field is required';
    if (!answers.primaryMemberConditionsPast36Mo?.trim())
      newErrors.primaryMemberConditionsPast36Mo = 'This field is required';
    if (!answers.medicalCostSharingAuth) newErrors.medicalCostSharingAuth = 'You must acknowledge and agree to the authorization';
    if (!answers.termsAndConditionsAccept) {
      newErrors.termsAndConditionsAccept = 'You must read and accept the Terms and Conditions';
    }

    if (!answers.signatureData?.trim()) {
      newErrors.signatureData = 'Please draw your signature';
    }
    if (!answers.typedSignature.trim()) {
      newErrors.typedSignature = 'Please type your full name';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      const firstErrorKey = Object.keys(newErrors)[0];
      setTimeout(() => {
        const errorElement = document.querySelector(`[name="${firstErrorKey}"]`) as HTMLElement;
        if (errorElement) {
          errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          errorElement.focus();
        }
      }, 100);
    }

    return Object.keys(newErrors).length === 0;
  };

  const handleNextFromQuestionnaire = () => {
    if (!validateStep2()) {
      return;
    }
    saveStep(3);
    setErrors({});
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 0);
  };

  const handleBack = () => {
    if (response && (response.success === false || response.data?.SUCCESS === "false" || response.data?.TRANSACTION?.SUCCESS === "false")) {
      clearStorage();
    }
    if (currentStep === 3) {
      saveStep(2);
    } else if (currentStep === 2) {
      saveStep(1);
    }
    setErrors({});
    setResponse(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddSpouse = () => {
    const newDependent: Dependent = {
      firstName: '',
      lastName: '',
      dob: '',
      smoker: '',
      relationship: 'Spouse',
      address: '',
      city: '',
      state: '',
      zipcode: '',
      phone: '',
      ssn: '',
      gender: '',
      email: '',
    };

    // Reset Care+ selection when dependents change
    const updatedProducts = formData.products.map(product =>
      product.id === 'care-plus'
        ? { ...product, selectedPlan: '', extractedBenefitId: undefined, extractedPrice: undefined }
        : product
    );

    saveFormData({
      ...formData,
      dependents: [...formData.dependents, newDependent],
      products: updatedProducts
    });
  };

  const handleAddChild = () => {
    const newDependent: Dependent = {
      firstName: '',
      lastName: '',
      dob: '',
      smoker: '',
      relationship: 'Child',
      address: '',
      city: '',
      state: '',
      zipcode: '',
      phone: '',
      ssn: '',
      gender: '',
      email: '',
    };

    // Reset Care+ selection when dependents change
    const updatedProducts = formData.products.map(product =>
      product.id === 'care-plus'
        ? { ...product, selectedPlan: '', extractedBenefitId: undefined, extractedPrice: undefined }
        : product
    );

    saveFormData({
      ...formData,
      dependents: [...formData.dependents, newDependent],
      products: updatedProducts
    });
  };

  const handleChangeDependent = (index: number, field: keyof Dependent, value: string) => {
    const updatedDependents = [...formData.dependents];
    updatedDependents[index] = { ...updatedDependents[index], [field]: value };

    let updatedData = { ...formData, dependents: updatedDependents };

    if (field === 'dob') {
      const updatedProducts = formData.products.map(product =>
        product.id === 'care-plus'
          ? { ...product, selectedPlan: '', extractedBenefitId: undefined, extractedPrice: undefined }
          : product
      );
      updatedData = { ...updatedData, products: updatedProducts };
    }

    saveFormData(updatedData);

    const errorKey = `dependent_${index}_${field}`;
    if (errors[errorKey]) {
      setErrors(prev => ({ ...prev, [errorKey]: '' }));
    }
    if (field === 'dob' && errors.essentialPlan) {
      setErrors(prev => ({ ...prev, essentialPlan: '' }));
    }
  };

  const handleUpdateDependent = (index: number, dependent: Dependent) => {
    const updatedDependents = [...formData.dependents];
    updatedDependents[index] = dependent;
    saveFormData({ ...formData, dependents: updatedDependents });
  };

  const handleRemoveDependent = (index: number) => {
    const updatedDependents = formData.dependents.filter((_, i) => i !== index);

    // Reset Care+ selection when dependents change
    const updatedProducts = formData.products.map(product =>
      product.id === 'care-plus'
        ? { ...product, selectedPlan: '', extractedBenefitId: undefined, extractedPrice: undefined }
        : product
    );

    saveFormData({
      ...formData,
      dependents: updatedDependents,
      products: updatedProducts
    });

    const newErrors = { ...errors };
    Object.keys(newErrors).forEach(key => {
      if (key.startsWith(`dependent_${index}_`)) {
        delete newErrors[key];
      }
    });
    setErrors(newErrors);
  };

  const handleChangePlan = (productId: string, plan: string, extractedBenefitId?: string, extractedPrice?: number) => {
    const updatedProducts = formData.products.map(product =>
      product.id === productId ? { ...product, selectedPlan: plan, extractedBenefitId, extractedPrice } : product
    );
    saveFormData({ ...formData, products: updatedProducts });
  };

  const handleRemoveProduct = (productId: string) => {
    const updatedProducts = formData.products.filter(product => product.id !== productId);
    saveFormData({ ...formData, products: updatedProducts });
  };

  const handlePaymentChange = (field: keyof PaymentInfo, value: string) => {
    let updatedPayment = { ...formData.payment, [field]: value };

    if (field === 'paymentMethod') {
      updatedPayment.paymentType = value === 'ach' ? 'ACH' : value === 'list-bill' ? 'LB' : 'CC';
    }

    saveFormData({ ...formData, payment: updatedPayment });

    const errorKey = field;
    if (errors[errorKey]) {
      setErrors(prev => ({ ...prev, [errorKey]: '' }));
    }
  };

  const handleQuestionnaireChange = (field: keyof QuestionnaireAnswers, value: string | boolean) => {
    const updatedAnswers = { ...formData.questionnaireAnswers, [field]: value };
    saveFormData({ ...formData, questionnaireAnswers: updatedAnswers });

    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handlePromoCodeChange = (code: string) => {
    saveFormData((prev) => ({ ...prev, promoCode: code }));
  };

  const handleAppliedPromoChange = (promo: AppliedPromo | null) => {
    saveFormData((prev) => ({ ...prev, appliedPromo: promo }));
  };


  const syncZohoContact = async (requestBody: Record<string, unknown>, agentParam: string): Promise<string | null> => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const zohoUrl = `${supabaseUrl}/functions/v1/zoho-sync-contact_premiumcare`;
      const zohoPayload: Record<string, unknown> = {
        firstName: requestBody.firstName,
        lastName: requestBody.lastName,
        email: requestBody.email,
        phone: requestBody.phone,
        dob: requestBody.dob,
        address1: requestBody.address1,
        city: requestBody.city,
        state: requestBody.state,
        zipcode: requestBody.zipcode,
        ssn: requestBody.ssn,
        gender: requestBody.gender,
        effectiveDate: requestBody.effectiveDate,
        benefitId: requestBody.benefitId,
        selectedPrice: requestBody.selectedPrice,
        agentId: agentParam,
        dependents: (requestBody.dependents as Array<Record<string, unknown>>).map(dep => ({
          firstName: dep.firstName,
          lastName: dep.lastName,
          dob: dep.dob,
          relationship: dep.relationship,
          address: dep.address,
          city: dep.city,
          state: dep.state,
          zipcode: dep.zipcode,
          phone: dep.phone,
          ssn: dep.ssn,
          gender: dep.gender,
          email: dep.email,
        })),
      };
      const encryptedZoho = await encryptSensitiveFields(zohoPayload);
      if (encryptedZoho._encrypted) {
        encryptedZoho.encrypted = encryptedZoho._encrypted;
        delete encryptedZoho._encrypted;
      }
      const res = await fetch(zohoUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
        },
        body: JSON.stringify(encryptedZoho),
      });
      if (res.ok) {
        const data = await res.json();
        return data.zohoContactId || null;
      }
      return null;
    } catch {
      return null;
    }
  };

  const handleSubmit = async () => {
    if (!validateStep3()) {
      return;
    }

    setLoading(true);
    setResponse(null);
    sessionStorage.setItem('form_submitting', 'true');

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const agentParam = formData.agent || agentId || '768413';
      const apiUrl = `${supabaseUrl}/functions/v1/enrollment-api-premiumcare?id=${agentParam}`;
      const submissionId = getOrCreateSubmissionId();

      const carePlusProduct = formData.products.find(p => p.id === 'care-plus');
      const benefitIdToSend = carePlusProduct?.extractedBenefitId || formData.benefitId;
      const priceToSend = carePlusProduct?.extractedPrice || 0;

      const requestBody = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        dob: formData.dob,
        email: formData.email,
        smoker: formData.smoker,
        address1: formData.address1,
        city: formData.city,
        state: formData.state,
        zipcode: formData.zipcode,
        phone: formData.phone,
        ssn: formData.ssn,
        gender: formData.gender,
        agent: formData.agent,
        uniqueId: formData.uniqueId,
        effectiveDate: formData.effectiveDate,
        benefitId: benefitIdToSend,
        selectedPrice: priceToSend,
        dependents: formData.dependents.map(dep => ({
          firstName: dep.firstName,
          lastName: dep.lastName,
          dob: dep.dob,
          smoker: dep.smoker,
          relationship: dep.relationship,
          address: dep.address,
          city: dep.city,
          state: dep.state,
          zipcode: dep.zipcode,
          phone: dep.phone,
          ssn: dep.ssn,
          gender: dep.gender,
          email: dep.email,
        })),
        payment: formData.payment,
        pdid: formData.pdid,
        promoCode: formData.appliedPromo ? formData.promoCode.trim() : '',
        referral: (formData.questionnaireAnswers?.referral || '').trim().slice(0, 24),
      };

      const zohoContactId = await syncZohoContact(requestBody as Record<string, unknown>, agentParam);

      let bodyString: string;
      try {
        const encryptedPayload = await encryptSensitiveFields(requestBody as Record<string, unknown>);
        if (zohoContactId) {
          (encryptedPayload as Record<string, unknown>).zohoContactId = zohoContactId;
        }
        bodyString = JSON.stringify(encryptedPayload);
      } catch {
        if (zohoContactId) {
          (requestBody as Record<string, unknown>).zohoContactId = zohoContactId;
        }
        bodyString = JSON.stringify(requestBody);
      }

      // Store the agreement PDF BEFORE enrolling. The PDF is built entirely from
      // the form data (it does not need a member id), so uploading it up front
      // guarantees it is always saved in Supabase storage even if the enrollment
      // POST later times out (a 504 from the slow 1Administration API). We pass
      // memberId = null and intentionally do NOT pass a submissionId, so the row
      // never reaches 'pdf_stored' and the shared retry cron can't auto-attach it.
      // Best-effort: never block enrollment on a storage failure.
      setFinishingEnrollment(true);
      try {
        await generateAndUploadPDF(null);
      } catch {
        // PDF storage is best-effort; continue with enrollment regardless.
      }
      setFinishingEnrollment(false);

      let enrollmentSuccess = false;
      let extractedMemberId: string | null = null;
      let enrollmentResponseData: ApiResponse | null = null;

      // Fire the member-creation call EXACTLY ONCE, with a client-side timeout that
      // matches the edge function wall-clock limit. We never auto-retry the POST:
      // a retry on a slow/lost response is what creates duplicate members/charges.
      const ENROLL_TIMEOUT_MS = 150000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ENROLL_TIMEOUT_MS);

      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'X-Submission-Id': submissionId,
          },
          cache: 'no-store',
          body: bodyString,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await res.text();
          throw new Error(`Invalid response from server: ${text.substring(0, 100)}`);
        }

        const data = await res.json();

        if (res.ok || res.status === 400) {
          const evalResult = evaluateEnrollmentFromJson(data, res);
          if (evalResult.kind === 'failure') {
            enrollmentResponseData = evalResult.response;
          } else {
            enrollmentSuccess = true;
            extractedMemberId = evalResult.memberId;
            setMemberId(extractedMemberId);
          }
        } else if (res.status === 409) {
          // A request for this submissionId already created (or is creating) the
          // member. Recover the member id from the submission status instead of
          // re-POSTing, so we never create a duplicate.
          const statusResult = await fetchSubmissionStatus(submissionId, agentParam);
          if (statusResult?.memberId) {
            enrollmentSuccess = true;
            extractedMemberId = statusResult.memberId;
            setMemberId(extractedMemberId);
          } else {
            enrollmentResponseData = data;
          }
        } else {
          enrollmentResponseData = data;
        }
      } catch (error) {
        clearTimeout(timeoutId);
        // Timeout / network error: 1Administration may well have created the member,
        // but we never received the response. The PDF is already stored above, and
        // we do NOT retry (that is exactly what creates duplicates). Show a clear
        // "still processing, do not resubmit" notice instead of an error.
        const isTimeout = error instanceof DOMException && error.name === 'AbortError';
        setProcessingNotice(
          isTimeout
            ? 'Your enrollment is taking longer than usual and is still being processed. Please do NOT resubmit — our team will confirm your enrollment shortly.'
            : 'Your enrollment is being processed. Please do NOT resubmit — if you do not receive a confirmation, our team will follow up shortly.',
        );
        clearFormDataOnly();
        setLoading(false);
        return;
      }

      if (!enrollmentSuccess) {
        setResponse(
          enrollmentResponseData ?? {
            success: false,
            status: 500,
            error: 'Enrollment failed',
            message: 'An unexpected error occurred. Please try again.',
          },
        );
        clearFormDataOnly();
        setLoading(false);
        return;
      }

      // Member created. The PDF was already uploaded to storage before the POST.
      clearSubmissionId();
      setShowThankYou(true);
      clearStorage();
      sendAdvisorNotification(agentParam).catch(() => {});
      setLoading(false);
    } finally {
      sessionStorage.removeItem('form_submitting');
    }
  };

  const sendAdvisorNotification = async (salesId: string) => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const notificationUrl = `${supabaseUrl}/functions/v1/send-advisor-notification`;

      const response = await fetch(notificationUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Cache-Control': 'no-cache, no-store',
        },
        cache: 'no-store',
        body: JSON.stringify({
          salesId,
          customerFirstName: formData.firstName,
          customerLastName: formData.lastName,
          customerEmail: formData.email,
          planName: 'Premium Care',
        }),
      });

      await response.json();
    } catch (error) {
    }
  };

  const generateAndUploadPDF = async (enrollmentMemberId: string | null) => {
    try {
      const pdfBlob = await generateEnrollmentPDF(formData);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const pdfApiUrl = `${supabaseUrl}/functions/v1/save-enrollment-pdf`;


      const formDataUpload = new FormData();
      formDataUpload.append('pdf', pdfBlob, 'enrollment.pdf');
      formDataUpload.append('email', formData.email);
      formDataUpload.append('metadata', JSON.stringify({
        firstName: formData.firstName,
        lastName: formData.lastName,
        benefitId: formData.benefitId,
        enrollmentDate: new Date().toISOString(),
        enrollmentMemberId,
      }));

      const pdfResponse = await fetch(pdfApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey,
          'Cache-Control': 'no-cache, no-store',
        },
        cache: 'no-store',
        body: formDataUpload,
      });


      const contentType = pdfResponse.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await pdfResponse.text();
        throw new Error('PDF upload returned invalid response');
      }

      const pdfResult = await pdfResponse.json();
      if (pdfResult.success && pdfResult.pdfUrl) {
        // PDF is retained in Supabase storage for manual upload to 1Administration.
        // The automatic gateway attach has been intentionally removed to guarantee
        // no duplicate enrollments are ever created by an automated retry.
        setPdfUrl(pdfResult.pdfUrl);
      } else {
        throw new Error(pdfResult.error || 'PDF upload failed');
      }
    } catch (error) {
      throw error;
    }
  };

  if (processingNotice) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-white flex items-center justify-center p-4">
        <div className="max-w-2xl w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8 md:p-12 text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-6">
              <Clock className="w-12 h-12 text-blue-600" />
            </div>

            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Enrollment processing
            </h1>

            <p className="text-lg text-gray-700 mb-8">
              {processingNotice}
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
              <p className="font-semibold text-gray-900 mb-2">Need help?</p>
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
          </div>
        </div>
      </div>
    );
  }

  if (showThankYou) {
    return <ThankYouPage enrollmentData={{ firstName: formData.firstName, email: formData.email }} pdfUrl={pdfUrl} />;
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-2 py-4 xs:p-6">
      <div className="bg-white rounded-lg shadow-lg px-3 py-6 xs:p-8">
        <div className="mb-8 text-center">
          <img src="/assets/MPB-Health-No-background.png" alt="MPB Health Logo" className="h-16 xs:h-20 w-auto mx-auto mb-4" />
          <h1 className="text-xl xs:text-2xl md:text-3xl font-bold text-gray-900">Premium Care Enrollment</h1>
        </div>

        <ProgressIndicator currentStep={currentStep} totalSteps={3} />

        <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
          {currentStep === 1 && (
            <Step1PersonalInfo
              formData={formData}
              errors={errors}
              onChange={handleChange}
              onNext={handleNext}
              onAddSpouse={handleAddSpouse}
              onAddChild={handleAddChild}
              onChangeDependent={handleChangeDependent}
              onRemoveDependent={handleRemoveDependent}
              onChangePlan={handleChangePlan}
              onRemoveProduct={handleRemoveProduct}
              onBenefitIdChange={onBenefitIdChange}
              onPromoCodeChange={handlePromoCodeChange}
              onAppliedPromoChange={handleAppliedPromoChange}
            />
          )}

          {currentStep === 2 && (
            <Step2Questionnaire
              formData={formData}
              errors={errors}
              onNext={handleNextFromQuestionnaire}
              onBack={handleBack}
              onQuestionnaireChange={handleQuestionnaireChange}
            />
          )}

          {currentStep === 3 && (
            <Step2AddressInfo
              formData={formData}
              errors={errors}
              onChange={handleChange}
              onBack={handleBack}
              onSubmit={handleSubmit}
              loading={loading}
              finishingEnrollment={finishingEnrollment}
              response={response}
              onUpdateDependent={handleUpdateDependent}
              onPaymentChange={handlePaymentChange}
              onClearError={handleClearError}
              invalidDependentIndices={invalidDependentIndices}
              employeeGroup={employeeGroup}
            />
          )}
        </form>
      </div>
    </div>
  );
}
