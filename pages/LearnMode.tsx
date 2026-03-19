
import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, 
  Settings, 
  Maximize2, 
  Save, 
  Sparkles, 
  Volume2, 
  Eye, 
  FileText,
  Lightbulb,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  X,
  MessageCircle,
  Send,
  Loader2,
  Play,
  Pause,
  RotateCcw,
  ArrowRight,
  BrainCircuit,
  BookOpen
} from 'lucide-react';
import { PreReadSession, SummaryResult, QuizQuestion } from '../types';
import { geminiService } from '../services/geminiService';

interface LearnModeProps {
  session: PreReadSession;
  onExit: () => void;
  onComplete: () => void;
}

const LearnMode: React.FC<LearnModeProps> = ({ session, onExit, onComplete }) => {
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<SummaryResult | null>(null);
  const [depth, setDepth] = useState<'quick' | 'standard' | 'deep'>('standard');
  const [format, setFormat] = useState<'text' | 'visual' | 'audio'>('text');
  
  // Interaction States
  const [rightView, setRightView] = useState<'insights' | 'quiz' | 'quiz_result'>('insights');
  const [showNotes, setShowNotes] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [citationsEnabled, setCitationsEnabled] = useState(false);
  const [audioPlaybackVisible, setAudioPlaybackVisible] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const contentPaneRef = React.useRef<HTMLDivElement>(null);

  // Quiz State
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizScore, setQuizScore] = useState(0);
  const [quizLoading, setQuizLoading] = useState(false);

  // Chat State
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentItem = session.items[activeItemIndex];

  useEffect(() => {
    fetchInsights();
  }, [activeItemIndex, depth]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  const fetchInsights = async () => {
    // Use pre-computed summary stored in course_materials if available
    if (currentItem.summary) {
      const kts = currentItem.keyTakeaways || [];
      setInsights({
        title: currentItem.title,
        summary: currentItem.summary,
        keyTakeaways: kts,
        furtherReading: [],
        soWhat: `Understanding "${currentItem.title}" is essential for your coursework.`,
        keyConcepts: kts.slice(0, 5).map(t => ({
          title: t.split(':')[0]?.trim().slice(0, 60) || t.slice(0, 60),
          description: t.includes(':') ? t.split(':').slice(1).join(':').trim() : t,
        })),
      });
      return;
    }
    // Fallback: generate via AI
    setLoading(true);
    try {
      const result = await geminiService.getLearnInsights(currentItem.title, currentItem.content, depth);
      setInsights(result);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const saveSummary = async () => {
    if (!insights) return;
    try {
      await fetch('/api/summaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity_id: currentItem.id, summary: insights }),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Failed to save summary', error);
    }
  };

  const handleStartQuiz = async () => {
    setQuizLoading(true);
    setRightView('quiz');
    try {
      await fetch(`/api/materials/${session.id}/progress/read`, { method: "POST" });
      const res = await fetch(`/api/materials/${session.id}/quiz`);
      if (res.ok) {
        const questions = await res.json();
        if (Array.isArray(questions) && questions.length > 0) {
          setQuizQuestions(questions);
          setCurrentQuizIndex(0);
          setSelectedOption(null);
          setQuizScore(0);
        }
      }
    } catch (error) {
      console.error("Failed to load quiz", error);
    } finally {
      setQuizLoading(false);
    }
  };

  const handleQuizAnswer = (idx: number) => {
    if (selectedOption !== null) return;
    setSelectedOption(idx);
    setQuizAnswers(prev => [...prev, idx]);
    if (idx === quizQuestions[currentQuizIndex].correctAnswer) {
      setQuizScore(s => s + 1);
    }
  };

  const nextQuizQuestion = async () => {
    if (currentQuizIndex < quizQuestions.length - 1) {
      setCurrentQuizIndex(i => i + 1);
      setSelectedOption(null);
    } else {
      // Submit answers to server, then show result
      const answers = [...quizAnswers];
      try {
        await fetch(`/api/materials/${session.id}/quiz/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        });
      } catch (error) {
        console.error("Failed to submit quiz", error);
      }
      setRightView('quiz_result');
      onComplete();
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      contentPaneRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const retryQuiz = async () => {
    setQuizScore(0);
    setCurrentQuizIndex(0);
    setSelectedOption(null);
    setQuizAnswers([]);
    setRightView('quiz');
    setQuizLoading(true);
    try {
      const res = await fetch(`/api/materials/${session.id}/quiz`);
      if (res.ok) {
        const questions = await res.json();
        if (Array.isArray(questions) && questions.length > 0) {
          setQuizQuestions(questions);
        }
      }
    } catch (error) {
      console.error("Failed to reload quiz", error);
    } finally {
      setQuizLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatLoading(true);
    try {
      const history = chatMessages.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
      const response = await geminiService.chatWithContent(currentItem.content, userMsg, history);
      setChatMessages(prev => [...prev, { role: 'model', text: response }]);
    } catch (error) {
      console.error(error);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white text-slate-900 overflow-hidden relative">

      {/* Floating Chat Button */}
      {!showChat && (
        <button
          onClick={() => setShowChat(true)}
          title="Ask Ekosh AI"
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-moodle-blue text-white shadow-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
        >
          <MessageCircle size={24} />
        </button>
      )}

      {/* Drawer: Saved Notes */}
      {showNotes && (
        <div className="absolute inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowNotes(false)}></div>
          <div className="w-[380px] h-full bg-white border-l border-slate-200 shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold flex items-center gap-2 text-slate-800">
                <FileText size={20} className="text-moodle-blue" />
                Saved Notes
              </h3>
              <button onClick={() => setShowNotes(false)} className="p-2 hover:bg-slate-200 rounded-full text-slate-400">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <button onClick={saveSummary} className="w-full py-3 bg-blue-50 border border-blue-200 text-moodle-blue rounded text-xs font-bold hover:bg-blue-100 transition-all flex items-center justify-center gap-2 mb-4">
                <Save size={14} />
                {saveSuccess ? 'Saved!' : 'Save Current Summary'}
              </button>
              <div className="text-center py-12 text-slate-400">
                <FileText size={48} className="mx-auto mb-4 opacity-10" />
                <p className="text-sm">You haven't saved any notes yet.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drawer: Quick Chat */}
      {showChat && (
        <div className="absolute inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowChat(false)}></div>
          <div className="w-[450px] h-full bg-white border-l border-slate-200 shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2 text-slate-800">
                  <MessageCircle size={20} className="text-moodle-blue" />
                  Quick Chat
                </h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">
                  {session.title} &gt; {currentItem.title}
                </p>
              </div>
              <button onClick={() => setShowChat(false)} className="p-2 hover:bg-slate-200 rounded-full text-slate-400">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {chatMessages.length === 0 && (
                <div className="space-y-4">
                   <p className="text-sm text-slate-600 leading-relaxed bg-blue-50 p-4 rounded border border-blue-100 italic">
                    "I've read through <strong>{currentItem.title}</strong>. How can I help you clarify this topic?"
                   </p>
                   <div className="grid grid-cols-1 gap-2">
                     {[
                       `Summarize the key points of "${currentItem.title}"`,
                       "What are the main arguments or findings?",
                       "What should I focus on before class?"
                     ].map((s, i) => (
                       <button
                         key={i}
                         onClick={() => { setChatInput(s); }}
                         className="text-left p-3 text-xs bg-white border border-slate-200 hover:border-moodle-blue rounded text-slate-600 transition-colors"
                       >
                         {s}
                       </button>
                     ))}
                   </div>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-4 rounded-lg text-sm leading-relaxed ${msg.role === 'user' ? 'bg-moodle-blue text-white' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 p-4 rounded border border-slate-200">
                    <Loader2 size={16} className="animate-spin text-moodle-blue" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-6 border-t border-slate-200 bg-slate-50">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask a follow-up question..."
                  className="flex-1 bg-white border border-slate-300 rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue"
                />
                <button 
                  onClick={handleSendMessage}
                  disabled={!chatInput.trim() || chatLoading}
                  className="p-2.5 bg-moodle-blue text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Control Bar */}
      <header className="h-14 border-b border-slate-200 px-6 flex items-center justify-between shrink-0 bg-white z-20">
        <div className="flex items-center space-x-6">
          <button onClick={onExit} className="text-slate-500 hover:text-moodle-blue transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="h-6 w-px bg-slate-200"></div>
          <div>
            <h2 className="text-sm font-bold text-slate-800 truncate max-w-[200px]">{currentItem.title}</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              Item {activeItemIndex + 1} of {session.items.length}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="hidden md:flex items-center bg-slate-100 rounded p-1">
            {['quick', 'standard', 'deep'].map((d) => (
              <button
                key={d}
                onClick={() => setDepth(d as any)}
                className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${depth === d ? 'bg-white text-moodle-blue shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {d.toUpperCase()}
              </button>
            ))}
          </div>
          <button 
            onClick={handleStartQuiz}
            className="moodle-btn-primary px-4 py-1.5 text-sm shadow-sm flex items-center space-x-2"
          >
            <span>Open 5Q Quiz</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      {/* Split Screen Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Content Viewer */}
        <div ref={contentPaneRef} className="flex-1 bg-slate-50 flex flex-col relative border-r border-slate-200">
          <div className="flex-1 p-12 overflow-y-auto">
            <div className="max-w-3xl mx-auto space-y-8 bg-white p-12 shadow-sm border border-slate-200 rounded">
              <div className="flex items-center space-x-3 mb-8">
                <span className="px-2 py-1 bg-slate-100 text-slate-500 text-[10px] font-bold rounded uppercase tracking-wider">{currentItem.type}</span>
              </div>
              <h1 className="text-3xl font-bold leading-tight text-slate-900">{currentItem.title}</h1>
              {currentItem.summary ? (
                <div className="space-y-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
                    <p className="text-[10px] font-bold text-moodle-blue uppercase tracking-widest mb-2">AI Summary</p>
                    <p className="text-slate-700 leading-relaxed text-base">{currentItem.summary}</p>
                  </div>
                  {currentItem.keyTakeaways && currentItem.keyTakeaways.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-3">Key Takeaways</p>
                      <ul className="space-y-2">
                        {currentItem.keyTakeaways.map((t, i) => (
                          <li key={i} className="flex gap-3 text-slate-700 text-sm leading-relaxed">
                            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{i + 1}</span>
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed text-lg">
                  {currentItem.content.split('\n').filter(Boolean).map((p, i) => (
                    <p key={i} className={`mb-6 relative group transition-colors ${citationsEnabled && i % 3 === 0 ? 'bg-blue-50' : ''}`}>
                      {p}
                      {citationsEnabled && i % 3 === 0 && (
                        <span className="absolute -left-10 top-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-bold text-moodle-blue border border-blue-200 px-1 rounded bg-white">REF: {i + 1}</span>
                      )}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Audio Playback Bar Overlay */}
          {audioPlaybackVisible && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white border border-slate-200 px-6 py-2 rounded shadow-xl flex items-center gap-6 animate-in slide-in-from-top-4">
              <button onClick={() => setIsPlaying(!isPlaying)} className="p-2 hover:bg-slate-100 rounded-full text-moodle-blue">
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <div className="flex flex-col">
                <div className="w-48 h-1 bg-slate-100 rounded-full relative overflow-hidden">
                  <div className={`h-full bg-moodle-blue rounded-full ${isPlaying ? 'animate-pulse' : ''}`} style={{ width: isPlaying ? '40%' : '0%' }}></div>
                </div>
                <span className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">AI Voice: Kore</span>
              </div>
              <button onClick={() => setAudioPlaybackVisible(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
          )}
          
          {/* Viewer Controls */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center space-x-4 bg-white border border-slate-200 px-6 py-3 rounded shadow-lg">
            <button className="text-slate-400 hover:text-moodle-blue" disabled={activeItemIndex === 0} onClick={() => setActiveItemIndex(v => v - 1)}>
              <ChevronLeft size={20} />
            </button>
            <span className="text-xs font-bold text-slate-500">{activeItemIndex + 1} / {session.items.length}</span>
            <button className="text-slate-400 hover:text-moodle-blue" disabled={activeItemIndex === session.items.length - 1} onClick={() => setActiveItemIndex(v => v + 1)}>
              <ChevronRight size={20} />
            </button>
            <div className="h-4 w-px bg-slate-200"></div>
            <button onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} className="text-slate-400 hover:text-moodle-blue"><Maximize2 size={18} /></button>
          </div>
        </div>

        {/* Right: AI Panel (Dynamic View) */}
        <div className="w-[420px] bg-white flex flex-col shadow-inner z-10 transition-all">
          
          {/* Panel Header */}
          <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
             <div className="flex items-center space-x-2">
               {rightView === 'insights' ? (
                 <>
                   <Sparkles size={18} className="text-moodle-blue" />
                   <span className="text-sm font-bold text-slate-800">AI Learning Insights</span>
                 </>
               ) : (
                 <>
                   <BrainCircuit size={18} className="text-moodle-blue" />
                   <span className="text-sm font-bold text-slate-800">Flash Quiz</span>
                 </>
               )}
             </div>
             <div className="flex space-x-1">
               <button 
                 onClick={() => setShowNotes(true)} 
                 className="p-1.5 rounded text-slate-400 hover:text-moodle-blue hover:bg-white border border-transparent hover:border-slate-200"
                 title="Saved Notes"
                >
                   <FileText size={16}/>
               </button>
               <button 
                 onClick={() => setCitationsEnabled(!citationsEnabled)} 
                 className={`p-1.5 rounded transition-colors border ${citationsEnabled ? 'bg-blue-50 border-blue-200 text-moodle-blue' : 'text-slate-400 hover:bg-white border-transparent hover:border-slate-200'}`}
                 title="Toggle Citations"
                >
                   <Eye size={16}/>
               </button>
               <button 
                 onClick={() => setAudioPlaybackVisible(true)} 
                 className={`p-1.5 rounded transition-colors border ${audioPlaybackVisible ? 'bg-blue-50 border-blue-200 text-moodle-blue' : 'text-slate-400 hover:bg-white border-transparent hover:border-slate-200'}`}
                 title="Audio Synthesis"
                >
                   <Volume2 size={16}/>
               </button>
             </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {rightView === 'insights' ? (
              <div className="space-y-8 animate-in fade-in duration-300">
                {loading ? (
                  <div className="h-full flex flex-col items-center justify-center py-20 space-y-4">
                    <div className="w-10 h-10 border-4 border-blue-100 border-t-moodle-blue rounded-full animate-spin"></div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Synthesizing Concepts...</p>
                  </div>
                ) : insights ? (
                  <>
                    <section className="space-y-3">
                      <h4 className="text-[10px] font-bold text-moodle-blue uppercase tracking-widest flex items-center space-x-2">
                        <FileText size={12} />
                        <span>60-Sec TL;DR ({depth})</span>
                      </h4>
                      <div className="bg-slate-50 border border-slate-200 p-4 rounded italic text-slate-600 text-sm leading-relaxed">
                        "{insights.summary}"
                      </div>
                    </section>

                    <section className="space-y-4">
                      <h4 className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest flex items-center space-x-2">
                        <Lightbulb size={12} />
                        <span>Key Concepts</span>
                      </h4>
                      <div className="space-y-3">
                        {insights.keyConcepts?.map((concept, i) => (
                          <div key={i} className="group p-4 rounded bg-white border border-slate-200 hover:border-moodle-blue transition-all cursor-pointer shadow-sm">
                            <div className="flex justify-between items-start mb-2">
                              <h5 className="text-sm font-bold text-slate-800 group-hover:text-moodle-blue transition-colors">{concept.title}</h5>
                              <CheckCircle2 size={14} className="text-slate-300 group-hover:text-emerald-500 transition-colors" />
                            </div>
                            <p className="text-[11px] text-slate-500 leading-normal">{concept.description}</p>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="space-y-3">
                       <h4 className="text-[10px] font-bold text-moodle-orange uppercase tracking-widest">So What? (Relevance)</h4>
                       <p className="text-xs text-slate-600 leading-relaxed bg-orange-50 border-l-2 border-moodle-orange pl-4 py-2">
                         {insights.soWhat}
                       </p>
                    </section>

                    <div className="pt-6 border-t border-slate-100">
                      <button onClick={saveSummary} className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-xs font-bold transition-all flex items-center justify-center space-x-2 border border-slate-200">
                        <Save size={14} />
                        <span>{saveSuccess ? 'Saved!' : 'Add to Study Notes'}</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-20 text-slate-400">
                    <Sparkles size={48} className="mx-auto mb-4 opacity-10" />
                    <p className="text-sm">Select a concept to reveal AI insights.</p>
                  </div>
                )}
              </div>
            ) : rightView === 'quiz' ? (
              <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                {quizLoading ? (
                  <div className="h-full flex flex-col items-center justify-center py-20 space-y-4">
                    <div className="w-10 h-10 border-4 border-blue-100 border-t-moodle-blue rounded-full animate-spin"></div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Generating Questions...</p>
                  </div>
                ) : quizQuestions.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Question {currentQuizIndex + 1} of {quizQuestions.length}</span>
                      <div className="h-1 flex-1 mx-4 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-moodle-blue transition-all duration-300" 
                          style={{ width: `${((currentQuizIndex + 1) / quizQuestions.length) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                    
                    <h3 className="text-lg font-bold leading-snug text-slate-800">{quizQuestions[currentQuizIndex].question}</h3>
                    
                    <div className="space-y-3">
                      {quizQuestions[currentQuizIndex].options.map((opt, i) => (
                        <button 
                          key={i}
                          disabled={selectedOption !== null}
                          onClick={() => handleQuizAnswer(i)}
                          className={`w-full text-left p-4 rounded border transition-all ${
                            selectedOption === null 
                              ? 'bg-white border-slate-200 hover:border-moodle-blue hover:bg-slate-50' 
                              : i === quizQuestions[currentQuizIndex].correctAnswer
                                ? 'bg-emerald-50 border-emerald-500 text-emerald-700'
                                : selectedOption === i 
                                  ? 'bg-red-50 border-red-500 text-red-700'
                                  : 'bg-slate-50 border-slate-200 text-slate-400'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-[10px] font-bold shrink-0 text-slate-500">{String.fromCharCode(65 + i)}</span>
                            <span className="text-sm font-medium">{opt}</span>
                          </div>
                        </button>
                      ))}
                    </div>

                    {selectedOption !== null && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                        <div className="p-4 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-500 italic leading-relaxed">
                          {quizQuestions[currentQuizIndex].explanation}
                        </div>
                        <button 
                          onClick={nextQuizQuestion}
                          className="moodle-btn-primary w-full py-3 font-bold flex items-center justify-center gap-2 shadow-sm"
                        >
                          <span>{currentQuizIndex === quizQuestions.length - 1 ? 'Finish Quiz' : 'Next Question'}</span>
                          <ArrowRight size={18} />
                        </button>
                      </div>
                    )}
                    
                    {currentQuizIndex === 0 && selectedOption === null && (
                      <button onClick={() => setRightView('insights')} className="w-full py-2 text-slate-400 hover:text-moodle-blue text-xs font-bold transition-all">
                        Back to Summary
                      </button>
                    )}
                  </>
                ) : null}
              </div>
            ) : (
              <div className="space-y-8 animate-in zoom-in duration-300 py-10 text-center">
                <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6 text-emerald-500 border border-emerald-100">
                  <CheckCircle2 size={48} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-800">Quiz Completed!</h3>
                  <p className="text-slate-500 mt-2 font-medium">You scored {quizScore} out of {quizQuestions.length}</p>
                </div>
                <div className="p-6 bg-slate-50 rounded border border-slate-200 space-y-4">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                    {quizScore === quizQuestions.length ? "Result" : "Questions to Review"}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {quizScore === quizQuestions.length ? (
                      <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-bold border border-emerald-100">Perfect Mastery!</span>
                    ) : (
                      quizAnswers.map((ans, i) =>
                        ans !== quizQuestions[i]?.correctAnswer ? (
                          <span key={i} className="px-3 py-1 bg-red-50 text-red-600 rounded text-[10px] font-bold border border-red-100 text-left">
                            Q{i + 1}: {quizQuestions[i]?.question?.slice(0, 50)}{quizQuestions[i]?.question?.length > 50 ? "…" : ""}
                          </span>
                        ) : null
                      )
                    )}
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={retryQuiz}
                    className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded text-xs font-bold flex items-center justify-center gap-2"
                  >
                    <RotateCcw size={14} />
                    Retry
                  </button>
                  <button 
                    onClick={() => setRightView('insights')}
                    className="moodle-btn-primary flex-1 py-3 text-xs font-bold"
                  >
                    Back to Summary
                  </button>
                </div>
              </div>
            )}
          </div>
          
          {/* Quick Chat Entry Point */}
          <div className="p-4 border-t border-slate-200 bg-slate-50">
             <button 
               onClick={() => setShowChat(true)}
               className="w-full flex items-center justify-between p-3 rounded bg-white border border-slate-200 hover:border-moodle-blue transition-all group shadow-sm"
             >
               <div className="flex items-center gap-3">
                 <div className="w-8 h-8 rounded bg-moodle-blue flex items-center justify-center text-white shadow-sm">
                    <Sparkles size={16} />
                 </div>
                 <div className="text-left">
                   <p className="text-[10px] font-bold text-moodle-blue uppercase tracking-widest leading-none mb-1">Stuck on a concept?</p>
                   <p className="text-xs font-bold text-slate-700">Ask Ekosh AI</p>
                 </div>
               </div>
               <ChevronRight size={18} className="text-slate-400 group-hover:text-moodle-blue group-hover:translate-x-1 transition-all" />
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LearnMode;
