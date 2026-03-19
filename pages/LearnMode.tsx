
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Maximize2,
  MessageCircle,
  Send,
  Loader2,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
} from 'lucide-react';
import { PreReadSession, QuizQuestion, ChatMessage } from '../types';

interface LearnModeProps {
  session: PreReadSession;
  onExit: () => void;
  onComplete: () => void;
}

// ── Lightweight inline markdown renderer ────────────────────────────────────
function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match **bold**, *italic*, or `code`
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[0].startsWith('**'))
      parts.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>);
    else if (match[0].startsWith('`'))
      parts.push(<code key={match.index} className="bg-slate-200 rounded px-1 text-[11px] font-mono">{match[4]}</code>);
    else
      parts.push(<em key={match.index}>{match[3]}</em>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  const isBullet   = (l: string) => /^[-•*]\s/.test(l);
  const isNumbered = (l: string) => /^\d+[.)]\s/.test(l);
  // Skip a single blank line if the next non-blank line continues the same list type
  const peekContinues = (idx: number, check: (l: string) => boolean) => {
    let j = idx;
    while (j < lines.length && !lines[j].trim()) j++;
    return j < lines.length && check(lines[j]);
  };

  while (i < lines.length) {
    const line = lines[i];
    // ── Headings ──
    if (/^###\s/.test(line)) {
      elements.push(<p key={i} className="font-bold text-slate-900 mt-2 mb-0.5 text-[13px]">{parseInline(line.replace(/^###\s/, ''))}</p>);
    } else if (/^##\s/.test(line)) {
      elements.push(<p key={i} className="font-bold text-slate-900 mt-2 mb-0.5 text-[13px]">{parseInline(line.replace(/^##\s/, ''))}</p>);
    } else if (/^#\s/.test(line)) {
      elements.push(<p key={i} className="font-bold text-slate-900 mt-2 mb-0.5 text-[13px]">{parseInline(line.replace(/^#\s/, ''))}</p>);
    }
    // ── Unordered list — bridge blank lines so 1,2,3 stay in one <ul> ──
    else if (isBullet(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        if (isBullet(lines[i])) {
          items.push(<li key={i} className="ml-1">{parseInline(lines[i].replace(/^[-•*]\s+/, ''))}</li>);
          i++;
        } else if (!lines[i].trim() && peekContinues(i + 1, isBullet)) {
          i++; // skip blank line, continue list
        } else {
          break;
        }
      }
      elements.push(<ul key={`ul${i}`} className="list-disc pl-4 space-y-0.5 my-1 text-sm">{items}</ul>);
      continue;
    }
    // ── Numbered list — bridge blank lines so 1,2,3 stay in one <ol> ──
    else if (isNumbered(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        if (isNumbered(lines[i])) {
          items.push(<li key={i} className="ml-1">{parseInline(lines[i].replace(/^\d+[.)]\s+/, ''))}</li>);
          i++;
        } else if (!lines[i].trim() && peekContinues(i + 1, isNumbered)) {
          i++; // skip blank line, continue list
        } else {
          break;
        }
      }
      elements.push(<ol key={`ol${i}`} className="list-decimal pl-4 space-y-1 my-1 text-sm">{items}</ol>);
      continue;
    }
    // ── Empty line — small gap ──
    else if (!line.trim()) {
      elements.push(<div key={i} className="h-1.5" />);
    }
    // ── Normal paragraph ──
    else {
      elements.push(<p key={i} className="leading-relaxed">{parseInline(line)}</p>);
    }
    i++;
  }
  return <>{elements}</>;
}

const SUGGESTED_PROMPTS = [
  'Summarise this reading in simple terms.',
  'What are the 3 most important concepts here?',
  'What should I focus on before class?',
  'Explain the main argument step by step.',
  'Give me an example that illustrates the key idea.',
];

const LearnMode: React.FC<LearnModeProps> = ({ session, onExit, onComplete }) => {
  const [activeItemIndex, setActiveItemIndex] = useState(0);

  // Right panel: 'chat' | 'quiz' | 'quiz_result'
  const [rightView, setRightView] = useState<'chat' | 'quiz' | 'quiz_result'>('chat');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const contentPaneRef = useRef<HTMLDivElement>(null);

  // Quiz state
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizScore, setQuizScore] = useState(0);
  const [quizLoading, setQuizLoading] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistoryLoaded, setChatHistoryLoaded] = useState<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const currentItem = session.items[activeItemIndex];
  // Canonical numeric material ID — session.id is the definitive source
  const materialId = Number(session.id);

  // Scroll chat to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Reset chat when switching material
  useEffect(() => {
    setChatHistoryLoaded(null);
    setChatMessages([]);
    setRightView('chat');
  }, [activeItemIndex]);

  // Load persisted chat history when chat panel mounts / becomes active
  useEffect(() => {
    if (rightView === 'chat' && chatHistoryLoaded !== materialId) {
      loadChatHistory();
    }
    if (rightView === 'chat') {
      setTimeout(() => chatInputRef.current?.focus(), 100);
    }
  }, [rightView, materialId]);

  const loadChatHistory = async () => {
    try {
      const res = await fetch(`/api/materials/${materialId}/chat/history`);
      if (res.ok) {
        const rows = await res.json();
        setChatMessages(rows.map((r: any) => ({ id: r.id, role: r.role, content: r.content })));
        setChatHistoryLoaded(materialId);
      }
    } catch (err) {
      console.error('Failed to load chat history', err);
    }
  };

  // ── Quiz handlers ───────────────────────────────────────────────────────
  const handleStartQuiz = async () => {
    setQuizLoading(true);
    setRightView('quiz');
    try {
      await fetch(`/api/materials/${materialId}/progress/read`, { method: 'POST' });
      const res = await fetch(`/api/materials/${materialId}/quiz`);
      if (res.ok) {
        const data = await res.json();
        // Server returns { completed: true, score, total } if student already attempted
        if (!Array.isArray(data) && data.completed) {
          setQuizScore(data.score ?? 0);
          setQuizQuestions(Array(data.total ?? 0).fill(null));
          setRightView('quiz_result');
        } else if (Array.isArray(data) && data.length > 0) {
          setQuizQuestions(data);
          setCurrentQuizIndex(0);
          setSelectedOption(null);
          setQuizScore(0);
          setQuizAnswers([]);
        }
      }
    } catch (err) {
      console.error('Failed to load quiz', err);
    } finally {
      setQuizLoading(false);
    }
  };

  const handleQuizAnswer = (idx: number) => {
    if (selectedOption !== null) return;
    setSelectedOption(idx);
    setQuizAnswers((prev) => [...prev, idx]);
    if (idx === quizQuestions[currentQuizIndex].correctAnswer) {
      setQuizScore((s) => s + 1);
    }
  };

  const nextQuizQuestion = async () => {
    if (currentQuizIndex < quizQuestions.length - 1) {
      setCurrentQuizIndex((i) => i + 1);
      setSelectedOption(null);
    } else {
      try {
        await fetch(`/api/materials/${materialId}/quiz/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: [...quizAnswers] }),
        });
      } catch (err) {
        console.error('Failed to submit quiz', err);
      }
      // Stay inside LearnMode — show result inline, do NOT navigate away
      setRightView('quiz_result');
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

  // ── Chat: SSE streaming send ────────────────────────────────────────────
  const handleSendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? chatInput).trim();
    if (!text || chatLoading) return;
    setChatInput('');

    setChatMessages((prev) => [...prev, { role: 'user', content: text }]);
    setChatMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);
    setChatLoading(true);

    try {
      const response = await fetch(`/api/materials/${materialId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (raw === '[DONE]') break;
            try {
              const parsed = JSON.parse(raw);
              const token: string = parsed?.token ?? '';
              if (token) {
                fullContent += token;
                setChatMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: fullContent, streaming: true };
                  return updated;
                });
              }
            } catch { /* skip malformed */ }
          }
        }

        setChatMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: fullContent, streaming: false };
          return updated;
        });
      } else {
        // Non-streaming fallback (e.g. no HF key)
        const data = await response.json();
        const reply = String(data.reply || '');
        setChatMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: reply, streaming: false };
          return updated;
        });
      }
    } catch (err) {
      console.error('Chat error:', err);
      setChatMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
          streaming: false,
        };
        return updated;
      });
    } finally {
      setChatLoading(false);
      chatInputRef.current?.focus();
    }
  }, [chatInput, chatLoading, materialId]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-white text-slate-900 overflow-hidden">

      {/* ── Header ── */}
      <header className="h-14 border-b border-slate-200 px-6 flex items-center justify-between shrink-0 bg-white z-20">
        <div className="flex items-center gap-4">
          <button onClick={onExit} className="text-slate-500 hover:text-moodle-blue transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div>
            <h2 className="text-sm font-bold text-slate-800 truncate max-w-[260px]">{currentItem.title}</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              Item {activeItemIndex + 1} of {session.items.length}
            </p>
          </div>
        </div>
        {/* No quiz button in header — quiz lives only in the right panel tab */}
      </header>

      {/* ── Split Screen ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: PDF / Text viewer ── */}
        <div ref={contentPaneRef} className="flex-1 flex flex-col relative border-r border-slate-200 bg-slate-100">

          {currentItem.type === 'pdf' ? (
            /* Render the actual PDF via the binary endpoint */
            <iframe
              src={`/api/materials/${materialId}/pdf-file`}
              title={currentItem.title}
              className="flex-1 w-full border-0"
              style={{ minHeight: 0 }}
            />
          ) : (
            /* Rendered extracted text for article/link materials */
            <div className="flex-1 overflow-y-auto p-10">
              <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm border border-slate-200 p-10 space-y-6">
                <div className="space-y-2">
                  <h1 className="text-2xl font-bold text-slate-900">{currentItem.title}</h1>
                  {currentItem.source_url && (
                    <a
                      href={currentItem.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-moodle-blue hover:underline font-medium"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      View original article
                    </a>
                  )}
                </div>
                <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed">
                  {currentItem.content.split('\n').filter(Boolean).map((p, i) => (
                    <p key={i} className="mb-5">{p}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Navigation controls (only needed when multiple items) */}
          {session.items.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-white border border-slate-200 px-5 py-2.5 rounded-full shadow-lg">
              <button
                disabled={activeItemIndex === 0}
                onClick={() => setActiveItemIndex((v) => v - 1)}
                className="text-slate-400 hover:text-moodle-blue disabled:opacity-30"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-xs font-bold text-slate-500">
                {activeItemIndex + 1} / {session.items.length}
              </span>
              <button
                disabled={activeItemIndex === session.items.length - 1}
                onClick={() => setActiveItemIndex((v) => v + 1)}
                className="text-slate-400 hover:text-moodle-blue disabled:opacity-30"
              >
                <ChevronRight size={20} />
              </button>
              <div className="h-4 w-px bg-slate-200" />
              <button onClick={toggleFullscreen} className="text-slate-400 hover:text-moodle-blue">
                <Maximize2 size={17} />
              </button>
            </div>
          )}
        </div>

        {/* ── Right: AI Panel ── */}
        <div className="w-[440px] bg-white flex flex-col shadow-inner z-10">

          {/* Tab bar — Ask AI | Quiz */}
          <div className="px-4 pt-3 pb-0 border-b border-slate-200 bg-slate-50 flex items-center shrink-0">
            <button
              onClick={() => setRightView('chat')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-t border-b-2 transition-all ${
                rightView === 'chat'
                  ? 'text-moodle-blue border-moodle-blue bg-white'
                  : 'text-slate-400 border-transparent hover:text-slate-600'
              }`}
            >
              <MessageCircle size={14} />
              Ask AI
              {chatMessages.filter(m => m.role === 'assistant').length > 0 && rightView !== 'chat' && (
                <span className="ml-1 w-4 h-4 rounded-full bg-moodle-blue text-white text-[9px] flex items-center justify-center">
                  {chatMessages.filter(m => m.role === 'assistant').length}
                </span>
              )}
            </button>

            <button
              onClick={handleStartQuiz}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-t border-b-2 transition-all ${
                rightView === 'quiz' || rightView === 'quiz_result'
                  ? 'text-moodle-blue border-moodle-blue bg-white'
                  : 'text-slate-400 border-transparent hover:text-slate-600'
              }`}
            >
              <BrainCircuit size={14} />
              Quiz
            </button>
          </div>

          {/* ── CHAT VIEW ── */}
          {rightView === 'chat' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">

                {/* Welcome card + suggested prompts */}
                {chatMessages.length === 0 && (
                  <div className="space-y-3 pt-2">
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-full bg-moodle-blue flex items-center justify-center">
                          <Sparkles size={13} className="text-white" />
                        </div>
                        <span className="text-xs font-bold text-moodle-blue">Ekosh AI</span>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        I've read <strong>{currentItem.title}</strong>. Ask me anything — I'll answer strictly from the reading.
                      </p>
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1 pt-1">Try asking</p>
                    <div className="space-y-2">
                      {SUGGESTED_PROMPTS.map((p, i) => (
                        <button
                          key={i}
                          onClick={() => handleSendMessage(p)}
                          disabled={chatLoading}
                          className="w-full text-left px-3 py-2.5 text-xs bg-white border border-slate-200 hover:border-moodle-blue hover:bg-blue-50 rounded-lg text-slate-600 transition-all disabled:opacity-50"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Message bubbles */}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    {msg.role === 'assistant' && (
                      <div className="w-7 h-7 rounded-full bg-moodle-blue flex items-center justify-center shrink-0 mt-1">
                        <Sparkles size={12} className="text-white" />
                      </div>
                    )}
                    <div
                      className={`max-w-[82%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-moodle-blue text-white rounded-tr-sm'
                          : 'bg-slate-100 text-slate-800 rounded-tl-sm border border-slate-200'
                      }`}
                    >
                      {msg.role === 'assistant' ? (
                        <>
                          <MarkdownContent content={msg.content} />
                          {msg.streaming && (
                            <span className="inline-block w-1.5 h-3.5 bg-slate-400 rounded-sm ml-0.5 animate-pulse" />
                          )}
                        </>
                      ) : (
                        <>
                          {msg.content}
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {/* Typing indicator — before first token arrives */}
                {chatLoading && chatMessages[chatMessages.length - 1]?.content === '' && (
                  <div className="flex gap-2">
                    <div className="w-7 h-7 rounded-full bg-moodle-blue flex items-center justify-center shrink-0">
                      <Sparkles size={12} className="text-white" />
                    </div>
                    <div className="px-4 py-3 bg-slate-100 rounded-2xl rounded-tl-sm border border-slate-200">
                      <div className="flex gap-1 items-center h-4">
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* Input bar */}
              <div className="p-3 border-t border-slate-200 bg-slate-50 shrink-0">
                <div className="flex gap-2">
                  <input
                    ref={chatInputRef}
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    placeholder="Ask anything about this reading…"
                    disabled={chatLoading}
                    className="flex-1 bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue focus:border-transparent disabled:opacity-60"
                  />
                  <button
                    onClick={() => handleSendMessage()}
                    disabled={!chatInput.trim() || chatLoading}
                    className="p-2.5 bg-moodle-blue text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
                  >
                    <Send size={18} />
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5 px-1">
                  Answers are grounded in the reading material only.
                </p>
              </div>
            </div>
          )}

          {/* ── QUIZ VIEW ── */}
          {(rightView === 'quiz' || rightView === 'quiz_result') && (
            <div className="flex-1 overflow-y-auto p-6">

              {rightView === 'quiz' && (
                <div className="space-y-6">
                  {quizLoading ? (
                    <div className="flex flex-col items-center justify-center py-24 space-y-4">
                      <div className="w-10 h-10 border-4 border-blue-100 border-t-moodle-blue rounded-full animate-spin" />
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Loading Questions…</p>
                    </div>
                  ) : quizQuestions.length > 0 ? (
                    <>
                      {/* Progress bar */}
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">
                          Q {currentQuizIndex + 1}/{quizQuestions.length}
                        </span>
                        <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-moodle-blue transition-all duration-300"
                            style={{ width: `${((currentQuizIndex + 1) / quizQuestions.length) * 100}%` }}
                          />
                        </div>
                      </div>

                      <h3 className="text-base font-bold leading-snug text-slate-800">
                        {quizQuestions[currentQuizIndex].question}
                      </h3>

                      <div className="space-y-2.5">
                        {quizQuestions[currentQuizIndex].options.map((opt, i) => (
                          <button
                            key={i}
                            disabled={selectedOption !== null}
                            onClick={() => handleQuizAnswer(i)}
                            className={`w-full text-left p-3.5 rounded-lg border text-sm transition-all ${
                              selectedOption === null
                                ? 'bg-white border-slate-200 hover:border-moodle-blue hover:bg-blue-50'
                                : i === quizQuestions[currentQuizIndex].correctAnswer
                                ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                                : selectedOption === i
                                ? 'bg-red-50 border-red-400 text-red-700'
                                : 'bg-slate-50 border-slate-200 text-slate-400'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-[10px] font-bold shrink-0 text-slate-500">
                                {String.fromCharCode(65 + i)}
                              </span>
                              {opt}
                            </div>
                          </button>
                        ))}
                      </div>

                      {selectedOption !== null && (
                        <div className="space-y-3">
                          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500 italic leading-relaxed">
                            {quizQuestions[currentQuizIndex].explanation}
                          </div>
                          <button
                            onClick={nextQuizQuestion}
                            className="moodle-btn-primary w-full py-3 font-bold flex items-center justify-center gap-2"
                          >
                            {currentQuizIndex === quizQuestions.length - 1 ? 'Finish Quiz' : 'Next Question'}
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      )}

                      {currentQuizIndex === 0 && selectedOption === null && (
                        <button
                          onClick={() => setRightView('chat')}
                          className="w-full py-2 text-slate-400 hover:text-moodle-blue text-xs font-bold transition-all"
                        >
                          ← Back to Chat
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-20 text-slate-400">
                      <BrainCircuit size={40} className="mx-auto mb-3 opacity-20" />
                      <p className="text-sm">No quiz questions available yet.</p>
                    </div>
                  )}
                </div>
              )}

              {rightView === 'quiz_result' && (
                <div className="space-y-6 text-center py-8">
                  <div className="w-18 h-18 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-500 border border-emerald-100 p-4">
                    <CheckCircle2 size={44} />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-800">Quiz Complete!</h3>
                    <p className="text-slate-500 mt-1 font-medium">
                      Score: {quizScore} / {quizQuestions.length}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-2">
                      The quiz can only be attempted once.
                    </p>
                  </div>

                  {/* Show wrong answers if we have the question data from this session */}
                  {quizAnswers.length > 0 && quizScore < quizQuestions.length && (
                    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-left space-y-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Missed</p>
                      <div className="flex flex-wrap gap-2">
                        {quizAnswers.map((ans, i) =>
                          ans !== quizQuestions[i]?.correctAnswer && quizQuestions[i] ? (
                            <span key={i} className="px-2 py-1 bg-red-50 text-red-600 rounded text-[10px] font-bold border border-red-100">
                              Q{i + 1}: {quizQuestions[i]?.question?.slice(0, 45)}…
                            </span>
                          ) : null
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => setRightView('chat')}
                    className="moodle-btn-primary w-full py-2.5 text-xs font-bold"
                  >
                    Back to Chat
                  </button>

                  {quizScore < quizQuestions.length && (
                    <button
                      onClick={() => setRightView('chat')}
                      className="w-full py-2.5 bg-blue-50 hover:bg-blue-100 text-moodle-blue rounded-lg text-xs font-bold flex items-center justify-center gap-2 border border-blue-200"
                    >
                      <MessageCircle size={13} />
                      Discuss missed questions with AI
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LearnMode;
