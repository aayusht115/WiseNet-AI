
import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, HelpCircle, ArrowRight, Save, BrainCircuit, Loader2 } from 'lucide-react';
import { QuizQuestion, PreReadSession } from '../types';
import { geminiService } from '../services/geminiService';

interface FlashQuizProps {
  session: PreReadSession;
  onFinish: (score: number, weakTopics: string[]) => void;
}

const FlashQuiz: React.FC<FlashQuizProps> = ({ session, onFinish }) => {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [score, setScore] = useState(0);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [results, setResults] = useState<{qid: string, correct: boolean, confidence: number}[]>([]);

  useEffect(() => {
    generateQuestions();
  }, []);

  const generateQuestions = async () => {
    setLoading(true);
    try {
      const fullContent = session.items.map(i => i.content).join('\n\n');
      const q = await geminiService.generateQuiz(fullContent);
      setQuestions(q);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    const isCorrect = selectedOption === questions[currentIndex].correctAnswer;
    if (isCorrect) setScore(v => v + 1);
    
    setResults(v => [...v, { 
      qid: questions[currentIndex].id, 
      correct: isCorrect, 
      confidence: confidence || 0 
    }]);

    if (currentIndex < questions.length - 1) {
      setCurrentIndex(v => v + 1);
      setSelectedOption(null);
      setShowFeedback(false);
      setConfidence(null);
    } else {
      onFinish(score + (isCorrect ? 1 : 0), results.filter(r => !r.correct).map((_, i) => questions[i].question.substring(0, 30)));
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
          <h3 className="text-xl font-bold text-slate-800">Generating Flash Quiz</h3>
          <p className="text-slate-500 text-sm">Creating adaptive questions based on your reading focus...</p>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIndex];

  return (
    <div className="max-w-3xl mx-auto p-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="flex items-center justify-between mb-12">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-moodle-blue text-white rounded flex items-center justify-center font-bold text-lg shadow-sm">
            {currentIndex + 1}
          </div>
          <div>
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Question Progress</h4>
            <div className="flex space-x-1 mt-1.5">
              {questions.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all ${i === currentIndex ? 'w-10 bg-moodle-blue' : i < currentIndex ? 'w-4 bg-emerald-400' : 'w-4 bg-slate-200'}`}></div>
              ))}
            </div>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Score</span>
          <p className="text-2xl font-black text-slate-800">{score * 10}</p>
        </div>
      </div>

      <div className="moodle-card p-8 space-y-8">
        <h2 className="text-2xl font-bold text-slate-900 leading-snug">
          {currentQ.question}
        </h2>

        <div className="grid grid-cols-1 gap-3">
          {currentQ.options.map((option, idx) => (
            <button
              key={idx}
              disabled={showFeedback}
              onClick={() => setSelectedOption(idx)}
              className={`w-full p-5 rounded border-2 text-left transition-all relative group overflow-hidden ${
                selectedOption === idx 
                  ? 'border-moodle-blue bg-blue-50/50' 
                  : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center space-x-4 relative z-10">
                <span className={`w-8 h-8 rounded flex items-center justify-center font-bold text-sm ${selectedOption === idx ? 'bg-moodle-blue text-white' : 'bg-slate-100 text-slate-400'}`}>
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className={`font-semibold ${selectedOption === idx ? 'text-slate-900' : 'text-slate-600'}`}>{option}</span>
              </div>
            </button>
          ))}
        </div>

        {selectedOption !== null && !showFeedback && (
          <div className="bg-slate-50 p-6 rounded border border-slate-200 animate-in fade-in slide-in-from-top-2">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 text-center">How confident are you?</h4>
            <div className="flex justify-between gap-2">
              {[1, 2, 3, 4, 5].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setConfidence(lvl)}
                  className={`flex-1 py-3 rounded font-bold text-lg transition-all border-2 ${confidence === lvl ? 'bg-moodle-blue border-moodle-blue text-white scale-105 shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:border-moodle-blue hover:text-moodle-blue'}`}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase mt-2 px-1">
              <span>Just Guessing</span>
              <span>Certain</span>
            </div>
            <button
              disabled={confidence === null}
              onClick={() => setShowFeedback(true)}
              className="moodle-btn-primary w-full mt-6 py-4 font-bold shadow-md flex items-center justify-center space-x-2"
            >
              <span>Submit Answer</span>
            </button>
          </div>
        )}

        {showFeedback && (
          <div className={`p-6 rounded border-2 animate-in slide-in-from-top-4 duration-500 ${selectedOption === currentQ.correctAnswer ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <div className="flex items-start space-x-4">
              {selectedOption === currentQ.correctAnswer ? (
                <CheckCircle2 size={24} className="text-emerald-500 shrink-0 mt-1" />
              ) : (
                <XCircle size={24} className="text-red-500 shrink-0 mt-1" />
              )}
              <div className="flex-1">
                <h4 className={`font-bold ${selectedOption === currentQ.correctAnswer ? 'text-emerald-900' : 'text-red-900'}`}>
                  {selectedOption === currentQ.correctAnswer ? 'Correct!' : 'Incorrect'}
                </h4>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                  {currentQ.explanation}
                </p>
                <button
                  onClick={handleNext}
                  className="mt-6 flex items-center space-x-2 bg-slate-800 text-white px-8 py-2.5 rounded text-sm font-bold hover:bg-slate-700 transition-all shadow-sm"
                >
                  <span>{currentIndex < questions.length - 1 ? 'Next Question' : 'Finish Quiz'}</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FlashQuiz;
