import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FormData } from '../hooks/useEnrollmentStorage';
import { maskSSN, maskCardNumber, maskRoutingNumber, maskAccountNumber } from './maskingUtils';
import { TOBACCO_MONTHLY_FEE_USD } from '../constants/pricing';
import {
  TERMS_AND_CONDITIONS_PARAGRAPHS,
  TERMS_FULL_BOLD_EXACT,
  isTermsShortColonHeading,
} from '../constants/termsAndConditionsEnrollment';
import { formatEffectiveDateLongDisplay } from './dateCalculations';

async function loadImageAsBase64(imagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } else {
        reject(new Error('Failed to get canvas context'));
      }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imagePath;
  });
}

/** Terms body: same paragraph + bold rules as TermsAndConditionsFormatted; returns next Y (pt). */
function appendTermsBlocksToPdf(
  doc: jsPDF,
  paragraphs: readonly string[],
  yStart: number,
  pageWidth: number,
  pageHeight: number,
  marginX: number,
  bottomMargin: number,
  fontSize: number,
  lineHeightPt: number
): number {
  const contentWidth = pageWidth - marginX * 2;

  function appendWrappedSegment(text: string, bold: boolean, y: number): number {
    if (!text) return y;
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, contentWidth);
    let yy = y;
    for (const line of lines) {
      if (yy > pageHeight - bottomMargin) {
        doc.addPage();
        yy = 20;
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
      }
      doc.text(line, marginX, yy);
      yy += lineHeightPt;
    }
    return yy;
  }

  let y = yStart;

  for (const para of paragraphs) {
    if (TERMS_FULL_BOLD_EXACT.has(para)) {
      y = appendWrappedSegment(para, true, y);
      continue;
    }
    if (isTermsShortColonHeading(para)) {
      y = appendWrappedSegment(para, true, y);
      continue;
    }
    if (para.startsWith('For example:')) {
      y = appendWrappedSegment('For example:', true, y);
      y = appendWrappedSegment(para.slice('For example:'.length), false, y);
      continue;
    }
    if (para.startsWith('11A.')) {
      y = appendWrappedSegment('11A.', true, y);
      y = appendWrappedSegment(para.slice(4), false, y);
      continue;
    }
    const numbered = para.match(/^(\d{1,2}\.\s[^.]+\.)([\s\S]*)$/);
    if (numbered) {
      y = appendWrappedSegment(numbered[1], true, y);
      y = appendWrappedSegment(numbered[2], false, y);
      continue;
    }
    y = appendWrappedSegment(para, false, y);
  }

  return y;
}

export async function generateEnrollmentPDF(formData: FormData): Promise<Blob> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let yPosition = 15;

  try {
    const logoBase64 = await loadImageAsBase64('/assets/MPB-Health-No-background.png');
    const logoWidth = 60;
    const logoHeight = 25;
    const logoX = (pageWidth - logoWidth) / 2;
    doc.addImage(logoBase64, 'PNG', logoX, yPosition, logoWidth, logoHeight);
    yPosition += logoHeight + 12;
  } catch (error) {
    yPosition += 5;
  }

  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Premium Care Enrollment', pageWidth / 2, yPosition, { align: 'center' });

  yPosition += 10;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, yPosition, { align: 'center' });

  yPosition += 15;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Primary Member Information', 14, yPosition);
  yPosition += 7;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const fullAddress = `${formData.address1}, ${formData.city}, ${formData.state} ${formData.zipcode}`;

  const memberInfo = [
    ['Name:', `${formData.firstName} ${formData.lastName}`],
    ['Address:', fullAddress],
    ['Phone:', formData.phone],
    ['Email:', formData.email],
    ['Date of Birth:', formData.dob],
    ['Gender:', formData.gender],
    ['Smoker:', formData.smoker],
    ['SSN:', maskSSN(formData.ssn)],
    ['Effective Date:', formatEffectiveDateLongDisplay(formData.effectiveDate)],
    ['Benefit ID:', formData.benefitId],
  ];

  autoTable(doc, {
    startY: yPosition,
    head: [],
    body: memberInfo,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 1.5 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 40 },
      1: { cellWidth: 'auto' }
    },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 10;

  if (formData.dependents && formData.dependents.length > 0) {
    if (yPosition > pageHeight - 60) {
      doc.addPage();
      yPosition = 20;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Dependents Information', 14, yPosition);
    yPosition += 7;

    const dependentRows = formData.dependents.map((dep, index) => [
      `Dependent ${index + 1}`,
      `${dep.firstName} ${dep.lastName}`,
      dep.dob,
      dep.relationship,
      dep.smoker,
      dep.gender || 'N/A',
      maskSSN(dep.ssn || ''),
    ]);

    autoTable(doc, {
      startY: yPosition,
      head: [['#', 'Name', 'DOB', 'Relationship', 'Smoker', 'Gender', 'SSN']],
      body: dependentRows,
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 1.5 },
      headStyles: { fillColor: [66, 139, 202], textColor: 255, fontStyle: 'bold', padding: 1.5 },
    });

    yPosition = (doc as any).lastAutoTable.finalY + 10;
  }

  if (yPosition > pageHeight - 80) {
    doc.addPage();
    yPosition = 20;
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Enrollment Fees', 14, yPosition);
  yPosition += 7;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const enrollmentFeeAmount = formData.appliedPromo?.discountAmount
    ? 100 - formData.appliedPromo.discountAmount
    : 100;

  const enrollmentFeeText = formData.appliedPromo?.discountAmount
    ? `$${enrollmentFeeAmount.toFixed(2)} one-time discount applied`
    : '$100.00 one-time';

  const enrollmentFeesInfo = [
    ['Annual Membership Fee:', '$25.00 per Year'],
    ['Enrollment Fee:', enrollmentFeeText],
  ];

  autoTable(doc, {
    startY: yPosition,
    head: [],
    body: enrollmentFeesInfo,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 1.5 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 60 },
      1: { cellWidth: 'auto' }
    },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 10;

  if (yPosition > pageHeight - 60) {
    doc.addPage();
    yPosition = 20;
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Selected Products', 14, yPosition);
  yPosition += 7;

  const isSubscriberSmoker = formData.smoker.toLowerCase() === 'yes';
  const hasDependentSmoker = formData.dependents.some(dep => dep.smoker.toLowerCase() === 'yes');

  const productRows = formData.products.map((product) => {
    const isVirtualCare = product.id === 'virtual-care';

    let smokerFee = '';
    if (isVirtualCare) {
      smokerFee = '';
    } else {
      smokerFee = (isSubscriberSmoker || hasDependentSmoker)
        ? `$${TOBACCO_MONTHLY_FEE_USD.toFixed(2)}`
        : '$0.00';
    }

    let planDisplay = product.selectedPlan || 'N/A';
    if (isVirtualCare && planDisplay.toLowerCase().includes('member')) {
      planDisplay = 'Telehealth access to: Primary Care, Urgent Care, Mental Health, and Pet Care ( Free )';
    }

    return [
      product.name,
      planDisplay,
      smokerFee,
    ];
  });

  autoTable(doc, {
    startY: yPosition,
    head: [['Product', 'Plan', 'Smoker Fee']],
    body: productRows,
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [66, 139, 202], textColor: 255, fontStyle: 'bold' },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 10;

  if (yPosition > pageHeight - 80) {
    doc.addPage();
    yPosition = 20;
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Payment Information', 14, yPosition);
  yPosition += 7;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const paymentInfo = [];
  if (formData.payment.paymentMethod === 'credit-card') {
    paymentInfo.push(
      ['Payment Method:', 'Credit Card'],
      ['Card Type:', formData.payment.ccType],
      ['Card Number:', maskCardNumber(formData.payment.ccNumber)],
      ['Expiration:', `${formData.payment.ccExpMonth}/${formData.payment.ccExpYear}`]
    );
  } else if (formData.payment.paymentMethod === 'ach') {
    paymentInfo.push(
      ['Payment Method:', 'ACH/Bank Account'],
      ['Bank Name:', formData.payment.achbank],
      ['Routing Number:', maskRoutingNumber(formData.payment.achrouting)],
      ['Account Number:', maskAccountNumber(formData.payment.achaccount)]
    );
  }

  autoTable(doc, {
    startY: yPosition,
    body: paymentInfo,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 50 },
      1: { cellWidth: 'auto' }
    },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 10;

  if (yPosition > pageHeight - 80) {
    doc.addPage();
    yPosition = 20;
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Limitations on Pre-Existing Conditions', 14, yPosition);
  yPosition += 7;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const limitationsOnPreExistingBlock =
    'Any pre-existing medical condition whether diagnosed or not, that has been active or needed treatment within 36 months prior to a Member\'s membership start date is subject to sharing limitations. Pre-existing conditions will become eligible for sharing based on the Member\'s tenure with the Sedera Medical Cost Sharing Community, as indicated by the following graduated sharing schedule.\n\n' +
    '• First 12 months – Not shareable.\n' +
    '• Months 13-24 – Shareable up to $25,000.\n' +
    '• Months 25-36 – Shareable up to $50,000.\n' +
    '• Months 37 and after – shareable.\n\n' +
    'Do you acknowledge and agree to these terms?';

  autoTable(doc, {
    startY: yPosition,
    body: [[limitationsOnPreExistingBlock, formData.preExistingConditionsAcknowledged || 'N/A']],
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 3, lineColor: [200, 200, 200], lineWidth: 0.1 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 120 },
      1: { cellWidth: 'auto', halign: 'left' },
    },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 10;

  if (yPosition > pageHeight - 80) {
    doc.addPage();
    yPosition = 20;
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Questionnaire Responses', 14, yPosition);
  yPosition += 7;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const formatAnswer = (answer: string) => {
    if (answer === 'Y') return 'YES';
    if (answer === 'N') return 'NO';
    return answer || 'N/A';
  };

  const hasSpouse = formData.dependents.some(dep => dep.relationship === 'Spouse');

  const sederaPrinciplesBlock =
    'Membership Principles\n\n' +
    'Understanding Premium Care Principles of Membership\n\n' +
    'I/we commit to living according to the Sedera (Sharing Organization) Membership Principles, including:\n\n' +
    '• Acting with honesty, integrity, and ethical behavior.\n' +
    '• Supporting fellow members through voluntary sharing of medical costs whenever possible.\n' +
    '• Maintaining personal accountability and acting as good stewards of community resources.\n' +
    '• Treating family, friends, and others with care, respect, and compassion.\n' +
    '• Practicing healthy lifestyle choices, avoiding illegal substances, and pursuing a balanced, harmonious life.';

  const sederaPrimaryMemberBlock =
    'I, as the Primary Member, approve this membership commitment for myself and all household members listed on this application.\n\n' +
    'I understand that:\n\n' +
    '• This membership is not insurance; it is a voluntary medical needs sharing program.\n' +
    '• There are no guarantees that medical expenses will be shared.\n' +
    '• Acceptance is a privilege based on the medical history I provide.\n' +
    '• Failure to follow the Member Principles or Commitments may result in ineligible sharing or inactive membership.\n' +
    '• Membership Guidelines in effect on the date of service govern eligibility.\n' +
    '• Monthly contributions are voluntary and may change based on operating costs.';

  const sederaDisputeBlock =
    'Dispute Resolution & Responsibility\n\n' +
    '• I agree to resolve disputes through mediation and binding arbitration as described in the Membership Guidelines.\n' +
    '• I understand it is my responsibility to submit medical bills within 6 months of the date of service.\n' +
    '• I agree to hold Sedera harmless and not pursue legal claims over sharing decisions.';

  const sederaAcknowledgementsBlock =
    'Acknowledgements & State Notices\n\n' +
    '• I understand Sedera is a faith-based, nonprofit organization, not an insurance company.\n' +
    '• I acknowledge that membership is subject to any state-specific legal notices or disclaimers.\n' +
    '• I confirm my billing information is correct and authorize Sedera to process monthly contributions per the Escrow Instructions.\n' +
    '• I have read and understand the current Membership Guidelines and accept them as the governing document for determining eligibility of medical needs.';

  const healthHistoryPreExistingBlock =
    'Health History\n\n' +
    'I understand:\n\n' +
    '• I must provide accurate medical and pre-existing condition information for myself and all household members.\n' +
    '• Pre-existing conditions may have waiting periods or limitations for sharing.\n' +
    '• A pre-existing condition may only be shareable after 36 months of symptom-free, treatment-free, and medication-free status before the membership start date.\n' +
    '• Undisclosed medical conditions discovered after enrollment will be treated as if disclosed at the membership start date.';

  const maternityDeliveryNeedsBlock =
    'Maternity and Delivery Needs\n\n' +
    'I understand that maternity and delivery-related medical needs are subject to specific waiting periods and sharing limitations.\n\n' +
    'Household Membership IUA: $1,250 (Standard Maternity IUA: $2,500)\n\n' +
    'These limitations may include:\n\n' +
    '• Waiting periods before maternity needs are eligible for sharing.\n' +
    '• Certain pre-existing conditions related to pregnancy may delay or exclude sharing.\n' +
    '• Multiple pregnancies or complicated deliveries may have additional considerations under the Membership Guidelines.\n\n' +
    'I acknowledge that all maternity and delivery needs must comply with the current Membership Guidelines to be considered for sharing.';

  const medicalCostSharingAuthBlock =
    'Medical Cost Sharing is not insurance or an insurance policy nor is it offered through an insurance company. Medical Cost Sharing is not a discount healthcare program nor a discount health card program. Whether anyone chooses to assist you with your medical bills will be totally voluntary, as neither the organization nor any other member is liable for or may be compelled to make the payment of your medical bill. As such, medical cost sharing should never be considered to be insurance. Whether you receive any amounts for medical expenses and whether or not medical cost sharing continues to operate, you are always personally responsible for the payment of your own medical bills. Medical Cost Sharing is not subject to the regulatory requirements or consumer protections of your particular State\'s Insurance Code or Statutes.\n\n' +
    'By checking this box, I acknowledge that I understand and agree to the authorization';

  const primaryTreatments36MoQuestion =
    'Primary Medical Treatments\n\nIn the past 36 months prior to the membership start date, has the primary member experienced symptoms, been diagnosed with, or been treated for any medical condition?';

  const primaryTreatmentsDetailsBlock =
    'Primary Medical Treatments (details)\n\n' +
    'If you have any pre-existing conditions or answered "Yes" to health history questions, please provide:\n\n' +
    '• Date of treatment\n' +
    '• Type of treatment\n' +
    '• Specific genetic defect or hereditary disease (if applicable)';

  const questionnaireData = [
    [sederaPrinciplesBlock, formatAnswer(formData.questionnaireAnswers.zionPrinciplesAccept)],
    [sederaPrimaryMemberBlock, formatAnswer(formData.questionnaireAnswers.zionm1a)],
    [sederaDisputeBlock, formatAnswer(formData.questionnaireAnswers.zionm1b)],
    [sederaAcknowledgementsBlock, formatAnswer(formData.questionnaireAnswers.zionm1d)],
    [healthHistoryPreExistingBlock, formatAnswer(formData.questionnaireAnswers.zionmh2P)],
    [maternityDeliveryNeedsBlock, formatAnswer(formData.questionnaireAnswers.maternityDeliveryAck ?? '')],
    [primaryTreatments36MoQuestion, formatAnswer(formData.questionnaireAnswers.primaryMemberConditionsPast36Mo ?? '')],
    [primaryTreatmentsDetailsBlock, formData.questionnaireAnswers.primaryMedicalTreatments || 'N/A'],
    ...(hasSpouse ? [['Spouse\'s Medical Conditions *\n\nHas the primary member\'s spouse experienced symptoms of, been diagnosed with, or been treated for any condition within the past 24 months?\n\nAdd conditions below. For multiple conditions, please add one per line. (If there are no conditions present, enter NA)', formData.questionnaireAnswers.spouseMedicalConditions || 'N/A']] : []),
    [medicalCostSharingAuthBlock, formData.questionnaireAnswers.medicalCostSharingAuth ? 'YES' : 'NO'],
    [
      'Terms and Conditions — Applicant read and accepted the full text presented in the questionnaire',
      formData.questionnaireAnswers.termsAndConditionsAccept ? 'YES' : 'NO',
    ],
    [
      'Referral (optional)\n\nAdd A Referral Or Leave It Blank',
      (formData.questionnaireAnswers.referral || '').trim() || 'None provided',
    ],
  ];

  autoTable(doc, {
    startY: yPosition,
    body: questionnaireData,
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 3, lineColor: [200, 200, 200], lineWidth: 0.1 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 120 },
      1: { cellWidth: 'auto', halign: 'left' }
    },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 10;

  if (yPosition > pageHeight - 120) {
    doc.addPage();
    yPosition = 20;
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Terms and Conditions — Premium Care Enrollment', 14, yPosition);
  yPosition += 8;

  yPosition = appendTermsBlocksToPdf(
    doc,
    TERMS_AND_CONDITIONS_PARAGRAPHS,
    yPosition,
    pageWidth,
    pageHeight,
    14,
    22,
    9,
    4.5
  );
  yPosition += 10;

  if (yPosition > pageHeight - 60) {
    doc.addPage();
    yPosition = 20;
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Signature', 14, yPosition);
  yPosition += 7;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const agreementText = 'By electronically acknowledging this authorization, I acknowledge that I have read and agree to the\nterms and conditions set forth in this agreement.';
  const agreementLines = doc.splitTextToSize(agreementText, pageWidth - 28);
  doc.text(agreementLines, 14, yPosition);
  yPosition += (agreementLines.length * 5) + 5;

  if (formData.questionnaireAnswers.signatureData) {
    try {
      doc.addImage(formData.questionnaireAnswers.signatureData, 'PNG', 14, yPosition, 80, 30);
      yPosition += 35;
    } catch (error) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.text('Signature image could not be embedded', 14, yPosition);
      yPosition += 10;
    }
  }

  if (formData.questionnaireAnswers.typedSignature) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Typed Signature: ${formData.questionnaireAnswers.typedSignature}`, 14, yPosition);
    yPosition += 7;
  }

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Signed on: ${new Date().toLocaleDateString()}`, 14, yPosition);

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
  }

  return doc.output('blob');
}

