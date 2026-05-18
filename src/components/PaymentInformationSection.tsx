import { useState } from 'react';
import { CreditCard, Lock, Building2, Eye, EyeOff } from 'lucide-react';
import { PaymentInfo } from '../hooks/useEnrollmentStorage';

interface PaymentInformationSectionProps {
  payment: PaymentInfo;
  errors: Record<string, string>;
  onChange: (field: keyof PaymentInfo, value: string) => void;
}

export default function PaymentInformationSection({
  payment,
  errors,
  onChange,
}: PaymentInformationSectionProps) {
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [showRouting, setShowRouting] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const supportsTextSecurity = typeof CSS !== 'undefined' && CSS.supports?.('-webkit-text-security', 'disc');

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 15 }, (_, i) => currentYear + i);
  const months = [
    { value: '01', label: '01 - January' },
    { value: '02', label: '02 - February' },
    { value: '03', label: '03 - March' },
    { value: '04', label: '04 - April' },
    { value: '05', label: '05 - May' },
    { value: '06', label: '06 - June' },
    { value: '07', label: '07 - July' },
    { value: '08', label: '08 - August' },
    { value: '09', label: '09 - September' },
    { value: '10', label: '10 - October' },
    { value: '11', label: '11 - November' },
    { value: '12', label: '12 - December' },
  ];

  const formatCardNumber = (value: string) => {
    const cleaned = value.replace(/\s/g, '');
    const chunks = cleaned.match(/.{1,4}/g) || [];
    return chunks.join(' ');
  };

  const handleRoutingNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    if (value.length <= 9) {
      onChange('achrouting', value);
    }
  };

  const handleAccountNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    if (value.length <= 17) {
      onChange('achaccount', value);
    }
  };

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\s/g, '');
    if (/^\d*$/.test(value) && value.length <= 16) {
      onChange('ccNumber', value);
    }
  };


  return (
    <div className="space-y-6 mt-8 pt-8 border-t border-gray-200">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl font-semibold text-gray-800">Payment Information</h2>
        </div>
        <div className="flex items-center gap-1 text-sm text-green-600">
          <Lock className="w-4 h-4" />
          <span className="font-medium">Secure Payment</span>
        </div>
      </div>

      <div className="bg-white border-2 border-gray-300 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Payment Method <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-2 gap-4 items-start">
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onChange('paymentMethod', 'credit-card')}
              className={`flex w-full items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                payment.paymentMethod === 'credit-card'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
              }`}
            >
              <CreditCard className="w-5 h-5" />
              <span className="font-semibold">Credit Card</span>
            </button>
            <p className="text-center text-sm font-normal text-red-600 sm:text-left">
              A 3% credit card fee will apply per transaction
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange('paymentMethod', 'ach')}
            className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
              payment.paymentMethod === 'ach'
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
            }`}
          >
            <Building2 className="w-5 h-5" />
            <span className="font-semibold">Bank Account (ACH)</span>
          </button>
        </div>
      </div>

      {payment.paymentMethod === 'credit-card' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-sm text-blue-800 font-medium">
              We accept:
            </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-white rounded px-3 py-2 shadow-sm border border-gray-200 flex items-center gap-2">
              <div className="w-12 h-8 flex items-center justify-center bg-blue-700 rounded">
                <svg viewBox="0 0 48 16" className="w-10 h-4">
                  <text x="0" y="12" fill="white" fontFamily="Arial, sans-serif" fontSize="11" fontWeight="bold" letterSpacing="1">VISA</text>
                </svg>
              </div>
              <span className="text-xs font-semibold text-gray-700">Visa</span>
            </div>
            <div className="bg-white rounded px-3 py-2 shadow-sm border border-gray-200 flex items-center gap-2">
              <div className="w-12 h-8 flex items-center justify-center bg-white rounded border border-gray-300">
                <svg viewBox="0 0 48 32" className="w-full h-full">
                  <circle cx="18" cy="16" r="8" fill="#EB001B"/>
                  <circle cx="30" cy="16" r="8" fill="#F79E1B"/>
                  <path d="M24 10a7.96 7.96 0 00-3 6 7.96 7.96 0 003 6 7.96 7.96 0 003-6 7.96 7.96 0 00-3-6z" fill="#FF5F00"/>
                </svg>
              </div>
              <span className="text-xs font-semibold text-gray-700">Mastercard</span>
            </div>
            <div className="bg-white rounded px-3 py-2 shadow-sm border border-gray-200 flex items-center gap-2">
              <div className="w-12 h-8 flex items-center justify-center bg-blue-600 rounded">
                <svg viewBox="0 0 48 16" className="w-10 h-4">
                  <text x="1" y="12" fill="white" fontFamily="Arial, sans-serif" fontSize="9" fontWeight="bold" letterSpacing="0.5">AMEX</text>
                </svg>
              </div>
              <span className="text-xs font-semibold text-gray-700">Amex</span>
            </div>
            <div className="bg-white rounded px-3 py-2 shadow-sm border border-gray-200 flex items-center gap-2">
              <div className="w-12 h-8 flex items-center justify-center bg-orange-500 rounded relative overflow-hidden">
                <svg viewBox="0 0 48 32" className="w-full h-full">
                  <rect width="48" height="32" fill="#FF6000"/>
                  <circle cx="12" cy="16" r="4" fill="white" opacity="0.9"/>
                  <text x="18" y="20" fill="white" fontFamily="Arial, sans-serif" fontSize="8" fontWeight="bold">D</text>
                </svg>
              </div>
              <span className="text-xs font-semibold text-gray-700">Discover</span>
            </div>
          </div>
        </div>
        </div>
      )}

      {payment.paymentMethod === 'ach' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Building2 className="w-5 h-5 text-green-700 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-green-800 font-medium mb-1">
                ACH Bank Transfer
              </p>
              <p className="text-xs text-green-700">
                Pay directly from your bank account. Please have your routing number, account number, and bank name ready.
              </p>
            </div>
          </div>
        </div>
      )}

      {payment.paymentMethod === 'credit-card' ? (
        <div className="grid grid-cols-1 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Card Type <span className="text-red-500">*</span>
          </label>
          <select
            value={payment.ccType}
            onChange={(e) => onChange('ccType', e.target.value)}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition appearance-none bg-white ${
              errors.ccType ? 'border-red-500' : 'border-gray-300'
            }`}
          >
            <option value="">Select card type...</option>
            <option value="VISA">Visa</option>
            <option value="MC">Mastercard</option>
            <option value="AMEX">American Express</option>
            <option value="DISC">Discover</option>
          </select>
          {errors.ccType && <p className="mt-1 text-sm text-red-500">{errors.ccType}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Card Number <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type={!showCardNumber && !supportsTextSecurity ? 'password' : 'text'}
              value={formatCardNumber(payment.ccNumber)}
              onChange={handleCardNumberChange}
              autoComplete="new-password"
              style={!showCardNumber && supportsTextSecurity ? { WebkitTextSecurity: 'disc' } : undefined}
              className={`w-full px-4 pr-10 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                errors.ccNumber ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="1234 5678 9012 3456"
              maxLength={19}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowCardNumber(!showCardNumber)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showCardNumber ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.ccNumber && <p className="mt-1 text-sm text-red-500">{errors.ccNumber}</p>}
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Expiration Month <span className="text-red-500">*</span>
            </label>
            <select
              value={payment.ccExpMonth}
              onChange={(e) => onChange('ccExpMonth', e.target.value)}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition appearance-none bg-white ${
                errors.ccExpMonth ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <option value="">Month</option>
              {months.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
            {errors.ccExpMonth && <p className="mt-1 text-sm text-red-500">{errors.ccExpMonth}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Expiration Year <span className="text-red-500">*</span>
            </label>
            <select
              value={payment.ccExpYear}
              onChange={(e) => onChange('ccExpYear', e.target.value)}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition appearance-none bg-white ${
                errors.ccExpYear ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <option value="">Year</option>
              {years.map((year) => (
                <option key={year} value={year.toString().slice(-2)}>
                  {year}
                </option>
              ))}
            </select>
            {errors.ccExpYear && <p className="mt-1 text-sm text-red-500">{errors.ccExpYear}</p>}
          </div>
        </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <Lock className="w-4 h-4 text-gray-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-gray-600">
                Your payment information is processed securely using industry-standard encryption.
                We never store your complete card number on our servers.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Routing Number <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={!showRouting && !supportsTextSecurity ? 'password' : 'text'}
                value={payment.achrouting}
                onChange={handleRoutingNumberChange}
                autoComplete="new-password"
                style={!showRouting && supportsTextSecurity ? { WebkitTextSecurity: 'disc' } : undefined}
                className={`w-full px-4 pr-10 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                  errors.achrouting ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="123456789"
                maxLength={9}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowRouting(!showRouting)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showRouting ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.achrouting && <p className="mt-1 text-sm text-red-500">{errors.achrouting}</p>}
            <p className="mt-1 text-xs text-gray-500">9-digit bank routing number</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Account Number <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={!showAccount && !supportsTextSecurity ? 'password' : 'text'}
                value={payment.achaccount}
                onChange={handleAccountNumberChange}
                autoComplete="new-password"
                style={!showAccount && supportsTextSecurity ? { WebkitTextSecurity: 'disc' } : undefined}
                className={`w-full px-4 pr-10 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                  errors.achaccount ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Enter account number"
                maxLength={17}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowAccount(!showAccount)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showAccount ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.achaccount && <p className="mt-1 text-sm text-red-500">{errors.achaccount}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Bank Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={payment.achbank}
              onChange={(e) => onChange('achbank', e.target.value)}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                errors.achbank ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Enter bank name"
            />
            {errors.achbank && <p className="mt-1 text-sm text-red-500">{errors.achbank}</p>}
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <Lock className="w-4 h-4 text-gray-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-gray-600">
                Your banking information is processed securely using industry-standard encryption.
                We never store your complete account details on our servers.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
