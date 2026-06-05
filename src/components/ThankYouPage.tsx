import { CheckCircle } from 'lucide-react';

interface ThankYouPageProps {
  enrollmentData: {
    firstName: string;
    email: string;
  };
  pdfUrl?: string | null;
}

export default function ThankYouPage({ enrollmentData, pdfUrl }: ThankYouPageProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-blue-50 to-white flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8 md:p-12 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
            <CheckCircle className="w-12 h-12 text-green-600" />
          </div>

          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Thank you!
          </h1>

          <p className="text-lg text-gray-700 mb-2">
            Your enrollment to MPB Health has been completed.
          </p>

          <p className="text-lg text-gray-700 mb-8">
            Bellow is the link to your health benefits, it is recommended to save it to your bookmarks. 
          </p>

          <p className="text-lg text-gray-700 mb-8">
            Please allow our system 1h to update your plan before access it. 
          </p>

          <div className="mb-8 py-4 border-t-2 border-b-2 border-blue-600">
            <h2 className="text-2xl md:text-3xl font-bold text-blue-600">
              Welcome to MPB Health
            </h2>
          </div>

          <div className="text-center">
            <a
              href="https://app.mpb.health/"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-blue-700 transition"
            >
              Access Your Health Benefits
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
