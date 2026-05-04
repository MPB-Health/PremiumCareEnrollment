import { FileText, ArrowLeft, PenTool, X, ExternalLink } from 'lucide-react';
import { FormData } from '../hooks/useEnrollmentStorage';
import { useRef, useState, useEffect } from 'react';
import { TermsAndConditionsFormatted } from './TermsAndConditionsFormatted';

interface QuestionnaireAnswers {
  zionPrinciplesAccept: string;
  zionm1a: string;
  zionm1b: string;
  zionm1d: string;
  zionm1h: string;
  zionTimelySubmission: string;
  zionmh1: string;
  zionmh2P: string;
  maternityDeliveryAck: string;
  zionmh2: string;
  zionmh3: string;
  primaryMemberConditionsPast36Mo: string;
  primaryMedicalTreatments: string;
  spouseMedicalConditions: string;
  medicalCostSharingAuth: boolean;
  termsAndConditionsAccept: boolean;
  signatureData: string;
  typedSignature: string;
  referral: string;
}

interface Step2QuestionnaireProps {
  formData: FormData;
  errors: Record<string, string>;
  onNext: () => void;
  onBack: () => void;
  onQuestionnaireChange: (field: keyof QuestionnaireAnswers, value: string | boolean) => void;
}

export default function Step2Questionnaire({
  formData,
  errors,
  onNext,
  onBack,
  onQuestionnaireChange,
}: Step2QuestionnaireProps) {
  const GUIDELINES_PDF = `/assets/${encodeURIComponent('Sedera_-_Access_Membership_Guidelines_20221001.pdf')}`;

  const answers = formData.questionnaireAnswers;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawnSignature, setHasDrawnSignature] = useState(false);
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);

  useEffect(() => {
    if (!guidelinesOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGuidelinesOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [guidelinesOpen]);
  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  const allStrokesRef = useRef<{ x: number; y: number }[][]>([]);

  useEffect(() => {
    if (answers.signatureData && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          setHasDrawnSignature(true);
        };
        img.src = answers.signatureData;
      }
    }
  }, []);

  const handleRadioChange = (field: keyof QuestionnaireAnswers, value: string) => {
    onQuestionnaireChange(field, value);
  };

  const handleTermsCheckboxChange = (checked: boolean) => {
    onQuestionnaireChange('termsAndConditionsAccept', checked);
  };

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    return { x, y };
  };

  const drawSmoothCurve = (points: { x: number; y: number }[]) => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 2; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }

    if (points.length > 1) {
      ctx.quadraticCurveTo(
        points[points.length - 2].x,
        points[points.length - 2].y,
        points[points.length - 1].x,
        points[points.length - 1].y
      );
    }

    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const { x, y } = getCanvasCoordinates(e);
    pointsRef.current = [{ x, y }];

    setIsDrawing(true);
    setHasDrawnSignature(true);
  };

  const redrawAllStrokes = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    allStrokesRef.current.forEach(stroke => {
      drawSmoothCurve(stroke);
    });
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasCoordinates(e);
    pointsRef.current.push({ x, y });

    redrawAllStrokes();
    drawSmoothCurve(pointsRef.current);
  };

  const smoothSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = 'high';
    tempCtx.putImageData(imageData, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tempCanvas, 0, 0);
  };

  const stopDrawing = () => {
    if (isDrawing && canvasRef.current) {
      if (pointsRef.current.length > 0) {
        allStrokesRef.current.push([...pointsRef.current]);
        pointsRef.current = [];
      }
      smoothSignature();
      const signatureData = canvasRef.current.toDataURL('image/png');
      onQuestionnaireChange('signatureData', signatureData);
    }
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pointsRef.current = [];
    allStrokesRef.current = [];
    onQuestionnaireChange('signatureData', '');
    setHasDrawnSignature(false);
  };

  return (
    <div className="space-y-8">
      <fieldset className="border border-gray-300 rounded-lg p-6 space-y-6">
        <legend className="text-xl font-semibold text-gray-800 px-2">
          <FileText className="w-5 h-5 inline mr-2 text-blue-600" />
          Membership Principles
        </legend>

        <div className="space-y-8">
          <div className="space-y-4">
            <p className="font-semibold text-gray-900">
              Understanding Premium Care Principles of Membership
              <span className="text-red-500 ml-1">*</span>
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">
              I/we commit to living according to the Sedera (Sharing Organization) Membership Principles, including:
            </p>
            <ul className="text-sm text-gray-700 leading-relaxed list-disc list-inside space-y-2 mb-4">
              <li>Acting with honesty, integrity, and ethical behavior.</li>
              <li>Supporting fellow members through voluntary sharing of medical costs whenever possible.</li>
              <li>Maintaining personal accountability and acting as good stewards of community resources.</li>
              <li>Treating family, friends, and others with care, respect, and compassion.</li>
              <li>Practicing healthy lifestyle choices, avoiding illegal substances, and pursuing a balanced, harmonious life.</li>
            </ul>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="zionPrinciplesAccept"
                  value="Y"
                  checked={answers.zionPrinciplesAccept === 'Y'}
                  onChange={(e) => handleRadioChange('zionPrinciplesAccept', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">YES</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="zionPrinciplesAccept"
                  value="N"
                  checked={answers.zionPrinciplesAccept === 'N'}
                  onChange={(e) => handleRadioChange('zionPrinciplesAccept', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">NO</span>
              </label>
            </div>
            {errors.zionPrinciplesAccept && (
              <p className="mt-2 text-sm text-red-500">{errors.zionPrinciplesAccept}</p>
            )}
          </div>

          <div className="space-y-4 border-t border-gray-200 pt-6">
            <p className="text-sm text-gray-700 leading-relaxed">
              I, as the Primary Member, approve this membership commitment for myself and all household members listed on this
              application.
            </p>
            <p className="font-semibold text-gray-900">
              I understand that:
              <span className="text-red-500 ml-1">*</span>
            </p>
            <ul className="text-sm text-gray-700 leading-relaxed list-disc list-inside space-y-2 mb-4">
              <li>This membership is not insurance; it is a voluntary medical needs sharing program.</li>
              <li>There are no guarantees that medical expenses will be shared.</li>
              <li>Acceptance is a privilege based on the medical history I provide.</li>
              <li>
                Failure to follow the Member Principles or Commitments may result in ineligible sharing or inactive membership.
              </li>
              <li>Membership Guidelines in effect on the date of service govern eligibility.</li>
              <li>Monthly contributions are voluntary and may change based on operating costs.</li>
            </ul>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="zionm1a"
                  value="Y"
                  checked={answers.zionm1a === 'Y'}
                  onChange={(e) => handleRadioChange('zionm1a', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">YES</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="zionm1a"
                  value="N"
                  checked={answers.zionm1a === 'N'}
                  onChange={(e) => handleRadioChange('zionm1a', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">NO</span>
              </label>
            </div>
            {errors.zionm1a && <p className="mt-2 text-sm text-red-500">{errors.zionm1a}</p>}
          </div>

          <div className="space-y-4 border-t border-gray-200 pt-6">
            <p className="font-semibold text-gray-900">
              Dispute Resolution &amp; Responsibility
              <span className="text-red-500 ml-1">*</span>
            </p>
            <ul className="text-sm text-gray-700 leading-relaxed list-disc list-inside space-y-2 mb-4">
              <li>
                I agree to resolve disputes through mediation and binding arbitration as described in the Membership Guidelines.
              </li>
              <li>I understand it is my responsibility to submit medical bills within 6 months of the date of service.</li>
              <li>I agree to hold Sedera harmless and not pursue legal claims over sharing decisions.</li>
            </ul>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="zionm1b"
                  value="Y"
                  checked={answers.zionm1b === 'Y'}
                  onChange={(e) => handleRadioChange('zionm1b', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">YES</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="zionm1b"
                  value="N"
                  checked={answers.zionm1b === 'N'}
                  onChange={(e) => handleRadioChange('zionm1b', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">NO</span>
              </label>
            </div>
            {errors.zionm1b && <p className="mt-2 text-sm text-red-500">{errors.zionm1b}</p>}
          </div>

          <div className="space-y-4 border-t border-gray-200 pt-6">
            <p className="font-semibold text-gray-900">
              Acknowledgements &amp; State Notices
              <span className="text-red-500 ml-1">*</span>
            </p>
            <ul className="text-sm text-gray-700 leading-relaxed list-disc list-inside space-y-2 mb-4">
              <li>I understand Sedera is a faith-based, nonprofit organization, not an insurance company.</li>
              <li>I acknowledge that membership is subject to any state-specific legal notices or disclaimers.</li>
              <li>
                I confirm my billing information is correct and authorize Sedera to process monthly contributions per the Escrow
                Instructions.
              </li>
              <li>
                I have read and understand the current Membership Guidelines and accept them as the governing document for
                determining eligibility of medical needs.
              </li>
            </ul>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="zionm1d"
                  value="Y"
                  checked={answers.zionm1d === 'Y'}
                  onChange={(e) => handleRadioChange('zionm1d', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">YES</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="zionm1d"
                  value="N"
                  checked={answers.zionm1d === 'N'}
                  onChange={(e) => handleRadioChange('zionm1d', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">NO</span>
              </label>
            </div>
            {errors.zionm1d && <p className="mt-2 text-sm text-red-500">{errors.zionm1d}</p>}
          </div>
        </div>
      </fieldset>

      <fieldset className="border border-gray-300 rounded-lg p-6 space-y-6">
        <legend className="text-xl font-semibold text-gray-800 px-2">Health History</legend>

        <div className="space-y-4">
          <div>
            <p className="font-semibold text-gray-900 mb-3">
              I understand:
              <span className="text-red-500 ml-1">*</span>
            </p>
            <ul className="text-sm text-gray-700 list-disc list-inside space-y-2 mb-4">
              <li>
                I must provide accurate medical and pre-existing condition information for myself and all household members.
              </li>
              <li>Pre-existing conditions may have waiting periods or limitations for sharing.</li>
              <li>
                A pre-existing condition may only be shareable after 36 months of symptom-free, treatment-free, and
                medication-free status before the membership start date.
              </li>
              <li>
                Undisclosed medical conditions discovered after enrollment will be treated as if disclosed at the membership
                start date.
              </li>
            </ul>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="zionmh2P"
                  value="Y"
                  checked={answers.zionmh2P === 'Y'}
                  onChange={(e) => handleRadioChange('zionmh2P', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">YES</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="zionmh2P"
                  value="N"
                  checked={answers.zionmh2P === 'N'}
                  onChange={(e) => handleRadioChange('zionmh2P', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">NO</span>
              </label>
            </div>
            {errors.zionmh2P && <p className="mt-2 text-sm text-red-500">{errors.zionmh2P}</p>}
          </div>

          <div className="border-t border-gray-200 pt-6 space-y-4">
            <p className="font-semibold text-gray-900">
              Maternity and Delivery Needs
              <span className="text-red-500 ml-1">*</span>
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">
              I understand that maternity and delivery-related medical needs are subject to specific waiting periods and sharing
              limitations.
            </p>
            <p className="font-semibold text-gray-900 text-sm">These limitations may include:</p>
            <ul className="text-sm text-gray-700 list-disc list-inside space-y-2">
              <li>Waiting periods before maternity needs are eligible for sharing.</li>
              <li>Certain pre-existing conditions related to pregnancy may delay or exclude sharing.</li>
              <li>
                Multiple pregnancies or complicated deliveries may have additional considerations under the Membership Guidelines.
              </li>
            </ul>
            <p className="text-sm text-gray-700 leading-relaxed">
              I acknowledge that all maternity and delivery needs must comply with the current Membership Guidelines to be
              considered for sharing.
            </p>

            <div className="flex flex-col gap-2 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="maternityDeliveryAck"
                  value="Y"
                  checked={answers.maternityDeliveryAck === 'Y'}
                  onChange={(e) => handleRadioChange('maternityDeliveryAck', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">YES</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="maternityDeliveryAck"
                  value="N"
                  checked={answers.maternityDeliveryAck === 'N'}
                  onChange={(e) => handleRadioChange('maternityDeliveryAck', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">NO</span>
              </label>
            </div>
            {errors.maternityDeliveryAck && (
              <p className="mt-2 text-sm text-red-500">{errors.maternityDeliveryAck}</p>
            )}
          </div>

          <div>
            <p className="font-semibold text-gray-900 mb-2">
              Primary Medical Treatments
              <span className="text-red-500 ml-1">*</span>
            </p>
            <p className="text-sm text-gray-700 mb-3">
              In the past 36 months prior to the membership start date, has the primary member experienced symptoms, been diagnosed
              with, or been treated for any medical condition?
            </p>

            <div className="flex flex-col gap-2 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="primaryMemberConditionsPast36Mo"
                  value="Y"
                  checked={answers.primaryMemberConditionsPast36Mo === 'Y'}
                  onChange={(e) => handleRadioChange('primaryMemberConditionsPast36Mo', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">Yes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="primaryMemberConditionsPast36Mo"
                  value="N"
                  checked={answers.primaryMemberConditionsPast36Mo === 'N'}
                  onChange={(e) => handleRadioChange('primaryMemberConditionsPast36Mo', e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">No</span>
              </label>
            </div>
            {errors.primaryMemberConditionsPast36Mo && (
              <p className="mt-2 text-sm text-red-500">{errors.primaryMemberConditionsPast36Mo}</p>
            )}

            <p className="text-sm text-gray-700 mb-3">
              If you have any pre-existing conditions or answered &ldquo;Yes&rdquo; to health history questions, please provide:
            </p>
            <ul className="text-sm text-gray-700 list-disc list-inside space-y-1 mb-3">
              <li>Date of treatment</li>
              <li>Type of treatment</li>
              <li>Specific genetic defect or hereditary disease (if applicable)</li>
            </ul>

            <textarea
              name="primaryMedicalTreatments"
              value={answers.primaryMedicalTreatments}
              onChange={(e) => handleRadioChange('primaryMedicalTreatments', e.target.value)}
              rows={4}
              maxLength={500}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                errors.primaryMedicalTreatments ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Enter treatment details or leave blank if not applicable"
            />
            {errors.primaryMedicalTreatments && <p className="mt-2 text-sm text-red-500">{errors.primaryMedicalTreatments}</p>}
          </div>

          {formData.dependents.some(dep => dep.relationship === 'Spouse') && (
            <div>
              <p className="font-semibold text-gray-900 mb-2">
                Spouse's Medical Conditions
              </p>
              <p className="text-sm text-gray-700 mb-2">
                Has the primary member's spouse experienced symptoms of, been diagnosed with, or been treated for any condition within the past 24 months?
              </p>
              <p className="text-sm mb-2" style={{ color: '#9b0000' }}>
                Add conditions below. For multiple conditions, please add one per line. (If there are no conditions present, enter NA)
              </p>

              <textarea
                name="spouseMedicalConditions"
                value={answers.spouseMedicalConditions}
                onChange={(e) => handleRadioChange('spouseMedicalConditions', e.target.value)}
                rows={3}
                maxLength={255}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                  errors.spouseMedicalConditions ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Enter spouse medical conditions or NA"
              />
              {errors.spouseMedicalConditions && <p className="mt-2 text-sm text-red-500">{errors.spouseMedicalConditions}</p>}
            </div>
          )}

          <div>
            <p className="font-semibold text-gray-900 mb-3">
              Medical Cost Sharing Authorization
              <span className="text-red-500 ml-1">*</span>
            </p>
            <div className="bg-gray-50 border border-gray-300 rounded-lg p-4 mb-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                Medical Cost Sharing is not insurance or an insurance policy nor is it offered through an insurance company.
                Medical Cost Sharing is not a discount healthcare program nor a discount health card program. Whether anyone
                chooses to assist you with your medical bills will be totally voluntary, as neither the organization nor any
                other member is liable for or may be compelled to make the payment of your medical bill. As such, medical cost
                sharing should never be considered to be insurance. Whether you receive any amounts for medical expenses and
                whether or not medical cost sharing continues to operate, you are always personally responsible for the
                payment of your own medical bills. Medical Cost Sharing is not subject to the regulatory requirements or
                consumer protections of your particular State&apos;s Insurance Code or Statutes.
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="medicalCostSharingAuth"
                checked={answers.medicalCostSharingAuth}
                onChange={(e) => onQuestionnaireChange('medicalCostSharingAuth', e.target.checked)}
                className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0"
              />
              <span className="text-sm text-gray-700">
                By checking this box, I acknowledge that I understand and agree to the authorization
              </span>
            </label>
            {errors.medicalCostSharingAuth && (
              <p className="mt-2 text-sm text-red-500">{errors.medicalCostSharingAuth}</p>
            )}
          </div>

          <div className="border-t border-gray-200 pt-6 space-y-4">
            <p className="font-semibold text-gray-900">
              Terms and Conditions
              <span className="text-red-500 ml-1">*</span>
            </p>
            <div className="bg-gray-50 border border-gray-300 rounded-lg p-4 mb-4">
              <div
                role="region"
                aria-label="Terms and Conditions full text"
                className="max-h-[min(17.5rem,42vh)] sm:max-h-[min(18rem,40vh)] overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-y [-webkit-overflow-scrolling:touch]"
              >
                <TermsAndConditionsFormatted />
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="termsAndConditionsAccept"
                checked={answers.termsAndConditionsAccept}
                onChange={(e) => handleTermsCheckboxChange(e.target.checked)}
                className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0"
              />
              <span className="text-sm text-gray-700">
                I have read and accept the Terms and Conditions
              </span>
            </label>
            {errors.termsAndConditionsAccept && (
              <p className="mt-2 text-sm text-red-500">{errors.termsAndConditionsAccept}</p>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset className="border border-gray-300 rounded-lg p-6 space-y-6 mt-6">
        <legend className="text-xl font-semibold text-gray-800 px-2">Referral</legend>
        <p className="font-semibold text-gray-900 mb-3">
          Add A Referral Or Leave It Blank
        </p>
        <input
          type="text"
          name="referral"
          value={answers.referral}
          onChange={(e) => handleRadioChange('referral', e.target.value)}
          placeholder="Type referral name"
          maxLength={24}
          className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition font-serif text-lg ${
            errors.referral ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        {errors.referral && (
          <p className="mt-2 text-sm text-red-500">{errors.referral}</p>
        )}
      </fieldset>

      <div className="bg-gradient-to-r from-blue-50 to-blue-100 border-2 border-blue-200 rounded-lg p-6">
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setGuidelinesOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-900 hover:bg-blue-800 text-white font-semibold rounded-lg transition duration-200 shadow-md hover:shadow-lg text-center"
          >
            <FileText className="w-5 h-5 shrink-0" />
            Guidelines
          </button>
        </div>
      </div>

      {guidelinesOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4">
          <div
            role="presentation"
            className="absolute inset-0 bg-black/50"
            onClick={() => setGuidelinesOpen(false)}
          />
          <div
            className="relative z-10 flex h-[722px] max-h-[90vh] w-[896px] max-w-[min(896px,calc(100vw-1rem))] min-h-0 flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guidelines-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <h2
                id="guidelines-title"
                className="pr-2 text-lg font-semibold text-gray-900 sm:text-xl"
              >
                Guidelines
              </h2>
              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                <a
                  href={GUIDELINES_PDF}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-blue-800 hover:bg-blue-50"
                >
                  <ExternalLink className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">Open in new tab</span>
                </a>
                <button
                  type="button"
                  onClick={() => setGuidelinesOpen(false)}
                  className="shrink-0 rounded-lg p-2 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
                  aria-label="Close guidelines"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
              <iframe
                title="Guidelines PDF"
                src={GUIDELINES_PDF}
                className="h-full w-full rounded border border-gray-200"
              />
            </div>
          </div>
        </div>
      )}

      <fieldset className="border border-gray-300 rounded-lg p-6 space-y-6">
        <legend className="text-xl font-semibold text-gray-800 px-2">
          <PenTool className="w-5 h-5 inline mr-2 text-blue-600" />
          Signature
        </legend>

        <div className="space-y-6">
          <div>
            <p className="font-semibold text-gray-900 mb-3">
              Draw Your Signature
              <span className="text-red-500 ml-1">*</span>
            </p>
            <p className="text-sm text-gray-600 mb-4">
              Use your mouse or finger to sign in the box below. Click "Clear" to start over if needed.
            </p>

            <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-white">
              <canvas
                ref={canvasRef}
                width={600}
                height={200}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className="w-full cursor-crosshair touch-none"
                style={{ maxWidth: '100%', height: 'auto', aspectRatio: '3/1' }}
              />
            </div>

            <button
              type="button"
              onClick={clearSignature}
              disabled={!hasDrawnSignature}
              className="mt-3 px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 text-gray-700 font-medium rounded-lg transition duration-200"
            >
              Clear Signature
            </button>

            {errors.signatureData && (
              <p className="mt-2 text-sm text-red-500">{errors.signatureData}</p>
            )}
          </div>

          <div className="border-t border-gray-200 pt-6">
            <p className="font-semibold text-gray-900 mb-3">
              Type Your Full Name
              <span className="text-red-500 ml-1">*</span>
            </p>
            <p className="text-sm text-gray-600 mb-4">
              Please type your full name below to accompany your drawn signature. Both are required to complete your enrollment.
            </p>

            <input
              type="text"
              name="typedSignature"
              value={answers.typedSignature}
              onChange={(e) => handleRadioChange('typedSignature', e.target.value)}
              placeholder="Type your full name"
              maxLength={24}
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition font-serif text-lg ${
                errors.typedSignature ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.typedSignature && (
              <p className="mt-2 text-sm text-red-500">{errors.typedSignature}</p>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> Both your drawn signature and typed name are required to continue with your enrollment.
            </p>
          </div>
        </div>
      </fieldset>

      <div className="pt-6 flex gap-4">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center gap-2"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Previous Page
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition duration-200"
        >
          Continue to Enrollment Details
        </button>
      </div>
    </div>
  );
}
