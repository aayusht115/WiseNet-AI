
import React, { useState } from 'react';
import { BrainCircuit, Loader2, Sparkles, MessageCircle, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { ReflectionPrompt } from '../types';
import { geminiService } from '../services/geminiService';

const Reflections: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [topic, setTopic] = useState('');
  const [prompts, setPrompts] = useState<ReflectionPrompt[]>([]);
  const [journalOpen, setJournalOpen] = useState<number | null>(null);
  const [journalText, setJournalText] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});

  const handleGenerate = async () => {
    if (!topic) return;
    setLoading(true);
    setJournalOpen(null);
    setJournalText({});
    setSaved({});
    try {
      const result = await geminiService.generateReflectionPrompts(topic);
      setPrompts(result);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveJournal = (idx: number) => {
    setSaved((prev) => ({ ...prev, [idx]: true }));
    setTimeout(() => setSaved((prev) => ({ ...prev, [idx]: false })), 2000);
  };

  const wordCount = (text: string) =>
    text.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-slate-800">Deepen Your Understanding</h2>
        <p className="text-slate-500 text-sm">
          Retention happens through reflection. Input a topic you've just learned to receive prompts that challenge your thinking.
        </p>
      </div>

      <div className="moodle-card p-4 flex items-center space-x-4">
        <div className="flex-1 relative">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            placeholder="What did you learn today? (e.g. Prisoner's Dilemma)"
            className="w-full bg-white border border-slate-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue placeholder:text-slate-400"
          />
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading || !topic}
          className="moodle-btn-primary p-3 shadow-sm disabled:opacity-50"
        >
          {loading ? <Loader2 className="animate-spin" size={24} /> : <Sparkles size={24} />}
        </button>
      </div>

      {prompts.length > 0 && (
        <div className="grid grid-cols-1 gap-6 mt-8 animate-in fade-in slide-in-from-top-4 duration-700">
          {prompts.map((prompt, idx) => (
            <div key={idx} className="moodle-card hover:border-moodle-blue transition-all">
              <div className="p-8">
                <span className="text-[10px] font-bold text-moodle-blue px-3 py-1 bg-blue-50 rounded border border-blue-100 uppercase tracking-widest">
                  {prompt.category}
                </span>
                <h3 className="text-xl font-bold text-slate-800 mt-4 leading-snug">
                  "{prompt.question}"
                </h3>

                <div className="pt-6 border-t border-slate-100 mt-6 flex items-center justify-between">
                  <button
                    onClick={() => setJournalOpen(journalOpen === idx ? null : idx)}
                    className="flex items-center space-x-2 text-sm font-bold text-moodle-blue hover:underline"
                  >
                    <MessageCircle size={18} />
                    <span>Journal My Thoughts</span>
                    {journalOpen === idx
                      ? <ChevronUp size={14} />
                      : <ChevronDown size={14} />}
                  </button>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Suggested: 5-10 mins writing
                  </span>
                </div>
              </div>

              {journalOpen === idx && (
                <div className="border-t border-slate-100 px-8 pb-8 space-y-3 animate-in slide-in-from-top-2 duration-200">
                  <textarea
                    autoFocus
                    rows={5}
                    value={journalText[idx] || ''}
                    onChange={(e) =>
                      setJournalText((prev) => ({ ...prev, [idx]: e.target.value }))
                    }
                    placeholder="Write your thoughts here..."
                    className="w-full bg-slate-50 border border-slate-200 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue resize-none text-slate-700 placeholder:text-slate-400"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      {wordCount(journalText[idx] || '')} words
                    </span>
                    <button
                      onClick={() => handleSaveJournal(idx)}
                      disabled={!journalText[idx]?.trim()}
                      className="flex items-center space-x-1.5 px-4 py-1.5 bg-moodle-blue text-white rounded text-xs font-bold hover:bg-blue-700 disabled:opacity-40 transition-colors"
                    >
                      {saved[idx] ? <Check size={13} /> : null}
                      <span>{saved[idx] ? 'Saved!' : 'Save Entry'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {prompts.length === 0 && !loading && (
        <div className="text-center py-20 opacity-40">
          <BrainCircuit size={64} className="mx-auto mb-4 text-slate-300" />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Your reflection cards will appear here.</p>
        </div>
      )}
    </div>
  );
};

export default Reflections;
