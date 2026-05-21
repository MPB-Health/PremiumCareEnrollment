import { AlertCircle } from 'lucide-react';

interface PreExistingConditionsSectionProps {
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

export default function PreExistingConditionsSection({
  value,
  error,
  onChange,
}: PreExistingConditionsSectionProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="w-5 h-5 text-blue-600" />
        <h2 className="text-xl font-semibold text-gray-800">Limitations on Pre-Existing Conditions</h2>
      </div>

      <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6">
        <div className="prose prose-sm max-w-none">
          <p className="text-gray-800 leading-relaxed mb-4">
          Any pre-existing medical condition whether diagnosed or not, that has been active or needed treatment within 36 months prior to a Member’s membership start date is subject to sharing limitations. Pre-existing conditions will become eligible for sharing based on the Member’s tenure with the Sedera Medical Cost Sharing Community, as indicated by the following graduated sharing schedule.
          </p>
          <ul className="space-y-2 text-gray-700 list-none pl-0">
            <li className="flex items-start gap-2">
              <span className="font-semibold text-blue-700 mt-0.5">•</span>
              <span><strong className="text-gray-900">First 12 months</strong> – Not shareable.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-semibold text-blue-700 mt-0.5">•</span>
              <span><strong className="text-gray-900">Months 13-24</strong> – Shareable up to $25,000.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-semibold text-blue-700 mt-0.5">•</span>
              <span><strong className="text-gray-900">Months 25-36</strong> – Shareable up to $50,000.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-semibold text-blue-700 mt-0.5">•</span>
              <span><strong className="text-gray-900">Months 37 and after</strong> – shareable.</span>
            </li>
          </ul>
        </div>

        <div className="mt-6 pt-6 border-t-2 border-blue-200">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Do you acknowledge and agree to these terms? <span className="text-red-500">*</span>
          </label>

          <div className="flex gap-6">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name="preExistingConditions"
                value="Yes"
                checked={value === 'Yes'}
                onChange={(e) => onChange(e.target.value)}
                className="w-5 h-5 text-blue-600 border-gray-300 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                aria-required="true"
              />
              <span className="text-base font-medium text-gray-800 group-hover:text-blue-700 transition">
                Yes
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name="preExistingConditions"
                value="No"
                checked={value === 'No'}
                onChange={(e) => onChange(e.target.value)}
                className="w-5 h-5 text-blue-600 border-gray-300 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                aria-required="true"
              />
              <span className="text-base font-medium text-gray-800 group-hover:text-blue-700 transition">
                No
              </span>
            </label>
          </div>

          {error && (
            <p className="mt-2 text-sm text-red-500 font-medium" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
