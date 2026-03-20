
import React, { useState, useEffect } from 'react';
import { Zap, Clock, BookOpen, ChevronRight, CheckCircle2 } from 'lucide-react';
import { PreReadSession } from '../types';

interface PreReadBoosterProps {
  onStart: (session: PreReadSession) => void;
  highlightMaterialId?: number;
}

const PreReadBooster: React.FC<PreReadBoosterProps> = ({ onStart, highlightMaterialId }) => {
  const [sessions, setSessions] = useState<PreReadSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSessions = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/booster/sessions', { cache: 'no-store' });
      if (response.ok) {
        setSessions(await response.json());
      } else {
        const payload = await response.json().catch(() => ({ error: "Couldn't load your sessions. Please try again." }));
        setError(payload.error || "Couldn't load your sessions. Please try again.");
      }
    } catch (err) {
      console.error("Failed to fetch sessions", err);
      setError("Couldn't load your sessions. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const startBooster = async (session: PreReadSession) => {
    try {
      await fetch(`/api/materials/${session.id}/progress/open`, { method: "POST" });
      setSessions((prev) =>
        prev.map((item) =>
          item.id === session.id
            ? { ...item, progress: Math.max(item.progress || 0, 30), status: "in_progress" }
            : item
        )
      );
    } catch (error) {
      console.error("Failed to mark pre-read as opened", error);
    }
    onStart(session);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Pre-read Booster</h2>
          <p className="text-slate-500 text-sm mt-1">Prime your brain for the next lecture with AI-accelerated summaries.</p>
        </div>
      </div>

      <div className="space-y-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Active Sessions</h3>
          <div className="space-y-6">
            {loading ? (
              <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-moodle-blue"></div></div>
            ) : error ? (
              <div className="moodle-card p-6 border border-rose-200 bg-rose-50 text-center space-y-3">
                <p className="text-sm text-rose-700">{error}</p>
                <button
                  onClick={fetchSessions}
                  className="px-3 py-2 rounded border border-rose-300 text-xs font-bold text-rose-700 hover:bg-rose-100"
                >
                  Retry
                </button>
              </div>
            ) : sessions.length > 0 ? sessions.map((session) => (
              <div
                key={session.id}
                id={`session-${session.id}`}
                className={`moodle-card p-6 hover:border-moodle-blue transition-all group ${String(session.id) === String(highlightMaterialId) ? 'ring-2 ring-moodle-blue' : ''}`}
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="flex items-center space-x-4">
                    <div className={`w-12 h-12 rounded flex items-center justify-center ${session.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-moodle-blue'}`}>
                      <Zap size={24} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 group-hover:text-moodle-blue transition-colors">{session.title}</h3>
                      <p className="text-xs text-slate-500 font-medium">{session.date} • {session.items.length} items</p>
                    </div>
                  </div>
                  {session.status === 'completed' ? (
                    <span className="flex items-center space-x-1 text-emerald-600 bg-emerald-50 px-3 py-1 rounded text-xs font-bold">
                      <CheckCircle2 size={14} />
                      <span>Ready for Class</span>
                    </span>
                  ) : (
                    <div className="flex items-center text-slate-400 text-xs space-x-3 font-medium">
                      <div className="flex items-center">
                        <Clock size={14} className="mr-1" />
                        {session.estimatedTime}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2 mb-6">
                  {session.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-3 rounded bg-slate-50 border border-slate-200">
                      <div className="flex items-center space-x-3">
                        <BookOpen size={16} className="text-slate-400" />
                        <span className="text-sm font-medium text-slate-700">{item.title}</span>
                      </div>
                      <span className="text-[10px] uppercase font-bold text-slate-400">{item.type}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                  <div className="flex-1 mr-8">
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase mb-1">
                      <span>Completion</span>
                      <span>{session.progress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-moodle-blue rounded-full transition-all duration-500" 
                        style={{ width: `${session.progress}%` }}
                      ></div>
                    </div>
                  </div>
                  <button 
                    onClick={() => startBooster(session)}
                    className="moodle-btn-primary flex items-center space-x-2 text-sm shadow-sm"
                  >
                    <span>{session.status === 'not_started' ? 'Start Booster' : 'Continue'}</span>
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )) : (
              <div className="moodle-card p-12 text-center">
                <Zap size={48} className="mx-auto text-slate-200 mb-4" />
                <p className="text-slate-500 font-medium">No active booster sessions found.</p>
                <p className="text-xs text-slate-400 mt-1">Check back later for upcoming lecture materials.</p>
              </div>
            )}
          </div>
      </div>
    </div>
  );
};

export default PreReadBooster;
