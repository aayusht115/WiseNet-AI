
import React, { useState, useRef } from 'react';
import { FileText, Loader2, Sparkles, Copy, Check, ExternalLink, AlertCircle, Upload, X } from 'lucide-react';
import { SummaryResult } from '../types';
import { geminiService } from '../services/geminiService';

type DetailLevel = 'Brief' | 'Standard' | 'Detailed';

const Summarizer: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('Standard');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSummarize = async () => {
    if (!content) return;
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const result = await geminiService.summarizeContent(title || 'Untitled Reading', content, detailLevel);
      if (!result.summary) throw new Error('No summary returned. Try pasting more content (at least a few paragraphs).');
      setSummary(result);
    } catch (err: any) {
      setError(err.message || 'Failed to summarize. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!summary) return;
    const text = [
      `# ${summary.title}`,
      '',
      '## Summary',
      summary.summary,
      '',
      '## Key Takeaways',
      ...summary.keyTakeaways.map((t, i) => `${i + 1}. ${t}`),
      '',
      '## Further Reading',
      ...summary.furtherReading.map((r) => `- ${r}`),
    ].join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clearFile = () => {
    setFileName(null);
    setContent('');
    setTitle('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileLoading(true);
    setError(null);
    setFileName(file.name);
    if (!title) setTitle(file.name.replace(/\.[^/.]+$/, ''));

    try {
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        const text = await file.text();
        setContent(text);
      } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
        const base64 = btoa(binary);

        const res = await fetch('/api/ai/extract-pdf-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64 }),
        });
        if (!res.ok) throw new Error('PDF text extraction failed. Try copying the text manually.');
        const data = await res.json();
        setContent(data.text || '');
      } else {
        throw new Error('Unsupported file type. Please upload a .txt or .pdf file.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to read file.');
      setFileName(null);
    } finally {
      setFileLoading(false);
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
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Summary Depth</label>
            <div className="flex items-center bg-slate-100 rounded p-1 w-fit gap-1">
              {(['Brief', 'Standard', 'Detailed'] as DetailLevel[]).map((level) => (
                <button
                  key={level}
                  onClick={() => setDetailLevel(level)}
                  className={`px-4 py-1.5 text-xs font-bold rounded transition-all ${
                    detailLevel === level
                      ? 'bg-white text-moodle-blue shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Content</label>
              <div className="flex items-center space-x-2">
                {fileName && (
                  <div className="flex items-center space-x-1 bg-blue-50 border border-blue-100 text-moodle-blue rounded px-2 py-1 text-xs font-semibold">
                    <FileText size={12} />
                    <span>{fileName}</span>
                    <button onClick={clearFile} className="ml-1 hover:text-red-500 transition-colors">
                      <X size={12} />
                    </button>
                  </div>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={fileLoading}
                  className="flex items-center space-x-1.5 px-3 py-1.5 border border-slate-300 rounded text-xs font-semibold text-slate-600 hover:border-moodle-blue hover:text-moodle-blue transition-colors disabled:opacity-50"
                >
                  {fileLoading ? <Loader2 className="animate-spin" size={12} /> : <Upload size={12} />}
                  <span>{fileLoading ? 'Reading...' : 'Upload File'}</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.pdf"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            </div>
            <textarea
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste the text you want to summarize here, or upload a .txt or .pdf file above..."
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

        {error && (
          <div className="flex items-start space-x-3 bg-red-50 border border-red-200 rounded p-4 animate-in fade-in duration-300">
            <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {summary && (
          <div className="moodle-card overflow-hidden animate-in fade-in zoom-in duration-500">
            <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between text-slate-800">
              <div className="flex items-center space-x-2">
                <FileText size={20} className="text-moodle-blue" />
                <span className="font-bold">Summary: {summary.title}</span>
              </div>
              <button
                onClick={handleCopy}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded border border-slate-200 text-xs font-semibold hover:border-moodle-blue hover:text-moodle-blue transition-colors text-slate-500"
                title="Copy summary to clipboard"
              >
                {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>

            <div className="p-8 space-y-8">
              {/* ── Overview / Abstract ── */}
              <section className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center space-x-2">
                  <div className="w-1 h-4 bg-moodle-blue rounded-full"></div>
                  <span>Overview</span>
                </h3>
                <div className="border-l-4 border-moodle-blue pl-5 py-1">
                  <p className="text-slate-700 leading-relaxed text-sm whitespace-pre-line">
                    {summary.summary}
                  </p>
                </div>
              </section>

              {/* ── Key Takeaways (labeled per chunk) ── */}
              <section className="space-y-4">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center space-x-2">
                  <div className="w-1 h-4 bg-emerald-500 rounded-full"></div>
                  <span>Key Takeaways</span>
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  {summary.keyTakeaways.map((point, i) => {
                    const label = summary.keyTakeawayLabels?.[i] ?? `Insight ${i + 1}`;
                    return (
                      <div key={i} className="bg-slate-50 rounded-lg border border-slate-100 overflow-hidden">
                        <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center space-x-2">
                          <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                            {i + 1}
                          </div>
                          <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">{label}</span>
                        </div>
                        <p className="px-4 py-3 text-sm text-slate-700 leading-relaxed">{point}</p>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* ── Further Learning ── */}
              <section className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center space-x-2">
                  <div className="w-1 h-4 bg-moodle-orange rounded-full"></div>
                  <span>Further Learning</span>
                </h3>
                <ul className="space-y-2">
                  {summary.furtherReading.map((item, i) => (
                    <li key={i} className="flex items-center space-x-2 text-sm text-slate-600">
                      <ExternalLink size={14} className="text-moodle-blue shrink-0" />
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
