import React, { useEffect, useState } from 'react';
import { ArrowRight, BrainCircuit, Loader2 } from 'lucide-react';
import { PreReadSession } from '../types';

interface FlashQuizProps {
  session: PreReadSession;
  onFinish: (score: number, weakTopics: string[]) => void;
}

type ServerQuizQuestion = {
  id: number;
  order: number;
  question: string;
  options: string[];
};

const FlashQuiz: React.FC<FlashQuizProps> = ({ session, onFinish }) => {
  const [questions, setQuestions] = useState<ServerQuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    generateQuestions();
  }, []);

  const materialId = Number(session.id);

  const generateQuestions = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/materials/${materialId}/quiz`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Quiz fetch failed' }));
        setError(payload.error || 'Quiz fetch failed');
        return;
      }
      const q = (await response.json()) as ServerQuizQuestion[];
      setQuestions(q);
      setAnswers(Array(q.length).fill(-1));
    } catch (fetchError) {
      console.error(fetchError);
      setError('Could not load quiz right now.');
    } finally {
      setLoading(false);
    }
  };

  const lockAnswerAndContinue = () => {
    if (selectedOption === null) return;
    const updated = answers.map((value, idx) => (idx === currentIndex ? selectedOption : value));
    setAnswers(updated);

    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedOption(null);
      return;
    }

    submitQuiz(updated);
  };

  const submitQuiz = async (finalAnswers: number[]) => {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/materials/${materialId}/quiz/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: finalAnswers }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Submit failed' }));
        setError(payload.error || 'Submit failed');
        return;
      }
      const payload = await response.json();
      const quizResult = {
        score: Number(payload.score || 0),
        total: Number(payload.total || questions.length),
      };
      setResult(quizResult);
    } catch (submitError) {
      console.error(submitError);
      setError('Could not submit quiz right now.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center space-y-6 bg-white">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-blue-50 border-t-moodle-blue rounded-full animate-spin"></div>
          <BrainCircuit className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-moodle-blue" size={24} />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-bold text-slate-800">Loading 5Q Quiz</h3>
          <p className="text-slate-500 text-sm">Fetching generated quiz from your assigned reading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="moodle-card p-6 text-center space-y-3">
          <h3 className="text-xl font-bold text-slate-800">Quiz Not Available</h3>
          <p className="text-sm text-slate-500">{error}</p>
          <button
            onClick={generateQuestions}
            className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-black"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="moodle-card p-6 text-center">
          <h3 className="text-xl font-bold text-slate-800">No Quiz Questions Found</h3>
          <p className="text-sm text-slate-500 mt-2">Ask faculty to assign a reading with generated quiz.</p>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="moodle-card p-8 text-center space-y-3">
          <h3 className="text-2xl font-black text-slate-800">Quiz Completed</h3>
          <p className="text-slate-600 text-sm">
            Score: <span className="font-bold text-moodle-blue">{result.score}/{result.total}</span>
          </p>
          <p className="text-xs text-slate-500">
            Your score has been posted to the teacher analytics dashboard.
          </p>
          <button
            onClick={() => onFinish(result.score, [])}
            className="mt-2 px-4 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-black"
          >
            Back to Pre-read Booster
          </button>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIndex];

  return (
    <div className="max-w-3xl mx-auto p-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Question Progress</h4>
          <div className="text-sm font-semibold text-slate-700 mt-1">
            {currentIndex + 1} / {questions.length}
          </div>
        </div>
        <div className="h-1 flex-1 mx-6 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-moodle-blue transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
          ></div>
        </div>
      </div>

      <div className="moodle-card p-8 space-y-6">
        <h2 className="text-2xl font-bold text-slate-900 leading-snug">{currentQ.question}</h2>

        <div className="grid grid-cols-1 gap-3">
          {currentQ.options.map((option, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedOption(idx)}
              className={`w-full p-4 rounded border-2 text-left transition-all ${
                selectedOption === idx
                  ? 'border-moodle-blue bg-blue-50/50'
                  : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center space-x-4">
                <span
                  className={`w-8 h-8 rounded flex items-center justify-center font-bold text-sm ${
                    selectedOption === idx ? 'bg-moodle-blue text-white' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className="font-semibold text-slate-700">{option}</span>
              </div>
            </button>
          ))}
        </div>

        <button
          disabled={selectedOption === null || submitting}
          onClick={lockAnswerAndContinue}
          className="moodle-btn-primary w-full py-3 font-bold flex items-center justify-center gap-2 shadow-sm disabled:opacity-60"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
          <span>{currentIndex === questions.length - 1 ? 'Submit Quiz' : 'Save & Next'}</span>
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

export default FlashQuiz;
