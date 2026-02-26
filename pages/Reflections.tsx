
import React, { useState } from 'react';
import { BrainCircuit, Loader2, Sparkles, MessageCircle, Heart, Share2 } from 'lucide-react';
import { ReflectionPrompt } from '../types';
import { geminiService } from '../services/geminiService';

const Reflections: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [topic, setTopic] = useState('');
  const [prompts, setPrompts] = useState<ReflectionPrompt[]>([]);

  const handleGenerate = async () => {
    if (!topic) return;
    setLoading(true);
    try {
      const result = await geminiService.generateReflectionPrompts(topic);
      setPrompts(result);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-slate-800">Deepen Your Understanding</h2>
        <p className="text-slate-500 text-sm">
          Retention happens through reflection. Input a topic you've just learned to receive AI-generated prompts that challenge your thinking.
        </p>
      </div>

      <div className="moodle-card p-4 flex items-center space-x-4">
        <div className="flex-1 relative">
          <input 
            type="text" 
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
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
            <div key={idx} className="moodle-card p-8 hover:border-moodle-blue transition-all group relative overflow-hidden">
               <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex space-x-2">
                  <button className="p-2 text-slate-400 hover:text-moodle-blue bg-slate-50 rounded border border-slate-200"><Share2 size={16}/></button>
                  <button className="p-2 text-slate-400 hover:text-red-500 bg-slate-50 rounded border border-slate-200"><Heart size={16}/></button>
                </div>
              </div>
              <div className="flex flex-col h-full justify-between space-y-6">
                <div>
                  <span className="text-[10px] font-bold text-moodle-blue px-3 py-1 bg-blue-50 rounded border border-blue-100 uppercase tracking-widest">
                    {prompt.category}
                  </span>
                  <h3 className="text-xl font-bold text-slate-800 mt-4 leading-snug">
                    "{prompt.question}"
                  </h3>
                </div>
                <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
                  <button className="flex items-center space-x-2 text-sm font-bold text-moodle-blue hover:underline">
                    <MessageCircle size={18} />
                    <span>Journal My Thoughts</span>
                  </button>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Suggested: 5-10 mins writing</span>
                </div>
              </div>
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
