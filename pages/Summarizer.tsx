
import React, { useState } from 'react';
import { FileText, Loader2, Sparkles, Copy, Download, ExternalLink } from 'lucide-react';
import { SummaryResult } from '../types';
import { geminiService } from '../services/geminiService';

const Summarizer: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState<SummaryResult | null>(null);

  const handleSummarize = async () => {
    if (!content) return;
    setLoading(true);
    try {
      const result = await geminiService.summarizeContent(title || 'Untitled Reading', content);
      setSummary(result);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Content Summarizer</h2>
        <p className="text-slate-500 text-sm mt-1">Condense long academic papers and textbooks into key insights instantly.</p>
      </div>

      <div className="grid grid-cols-1 gap-8">
        <div className="moodle-card p-6 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Document Title (Optional)</label>
            <input 
              type="text" 
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Chapter 4: Economic Theory"
              className="w-full bg-white border border-slate-300 rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Content</label>
            <textarea 
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste the text you want to summarize here..."
              className="w-full bg-white border border-slate-300 rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue resize-none font-mono"
            ></textarea>
          </div>
          <div className="flex items-center justify-between pt-2">
             <div className="text-[10px] font-bold text-slate-400 uppercase">Word Count: {content.trim().split(/\s+/).filter(Boolean).length}</div>
             <button 
              onClick={handleSummarize}
              disabled={loading || !content}
              className="moodle-btn-primary px-8 py-2.5 text-sm shadow-sm flex items-center space-x-2 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
              <span>Summarize Now</span>
            </button>
          </div>
        </div>

        {summary && (
          <div className="moodle-card overflow-hidden animate-in fade-in zoom-in duration-500">
            <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between text-slate-800">
              <div className="flex items-center space-x-2">
                <FileText size={20} className="text-moodle-blue" />
                <span className="font-bold">AI Summary: {summary.title}</span>
              </div>
              <div className="flex items-center space-x-3 text-slate-400">
                <button className="hover:text-moodle-blue transition-colors"><Copy size={18} /></button>
                <button className="hover:text-moodle-blue transition-colors"><Download size={18} /></button>
              </div>
            </div>
            
            <div className="p-8 space-y-8">
              <section className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center space-x-2">
                  <div className="w-1 h-4 bg-moodle-blue rounded-full"></div>
                  <span>The Abstract</span>
                </h3>
                <p className="text-slate-600 leading-relaxed italic border-l-4 border-slate-100 pl-4 text-sm">
                  {summary.summary}
                </p>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center space-x-2">
                  <div className="w-1 h-4 bg-emerald-500 rounded-full"></div>
                  <span>Key Takeaways</span>
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  {summary.keyTakeaways.map((point, i) => (
                    <div key={i} className="bg-slate-50 p-4 rounded flex items-start space-x-3 border border-slate-100">
                      <div className="w-6 h-6 rounded bg-blue-50 text-moodle-blue flex items-center justify-center flex-shrink-0 text-[10px] font-bold border border-blue-100">
                        {i + 1}
                      </div>
                      <p className="text-sm text-slate-700">{point}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center space-x-2">
                  <div className="w-1 h-4 bg-moodle-orange rounded-full"></div>
                  <span>Further Learning</span>
                </h3>
                <ul className="space-y-2">
                  {summary.furtherReading.map((item, i) => (
                    <li key={i} className="flex items-center space-x-2 text-sm text-moodle-blue hover:underline cursor-pointer">
                      <ExternalLink size={14} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Summarizer;
