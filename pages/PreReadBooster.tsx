
import React, { useState, useEffect } from 'react';
import { Zap, Clock, BookOpen, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { PreReadSession } from '../types';

interface PreReadBoosterProps {
  onStart: (session: PreReadSession) => void;
}

const PreReadBooster: React.FC<PreReadBoosterProps> = ({ onStart }) => {
  const [sessions, setSessions] = useState<PreReadSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const response = await fetch('/api/booster/sessions');
        if (response.ok) {
          setSessions(await response.json());
        }
      } catch (err) {
        console.error("Failed to fetch sessions", err);
      } finally {
        setLoading(false);
      }
    };
    fetchSessions();
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Pre-read Booster</h2>
          <p className="text-slate-500 text-sm mt-1">Prime your brain for the next lecture with AI-accelerated summaries.</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded px-4 py-2 flex items-center space-x-3">
          <div className="w-2 h-2 bg-moodle-blue rounded-full animate-pulse"></div>
          <span className="text-xs font-bold text-moodle-blue">Upcoming Session: Tomorrow at 10 AM</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Active Sessions</h3>
          <div className="space-y-6">
            {loading ? (
              <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-moodle-blue"></div></div>
            ) : sessions.length > 0 ? sessions.map((session) => (
              <div key={session.id} className="moodle-card p-6 hover:border-moodle-blue transition-all group">
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
                    onClick={() => onStart(session)}
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

        <div className="space-y-6">
          <div className="moodle-card p-6 border-l-4 border-l-moodle-blue relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 text-moodle-blue">
              <Zap size={80} />
            </div>
            <h3 className="text-lg font-bold mb-4 flex items-center space-x-2 text-slate-800">
              <AlertCircle size={20} className="text-moodle-blue" />
              <span>Study Impact</span>
            </h3>
            <p className="text-slate-600 text-sm leading-relaxed mb-6">
              Completing these pre-reads now will reduce your weekend review load by <span className="font-bold text-moodle-blue">4.5 hours</span>. 
            </p>
            <div className="bg-slate-50 rounded p-4 border border-slate-200">
              <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">Weekend Load Projection</div>
              <div className="flex items-end space-x-1 h-20">
                <div className="w-3 h-12 bg-slate-200 rounded-t-sm"></div>
                <div className="w-3 h-16 bg-slate-200 rounded-t-sm"></div>
                <div className="w-3 h-10 bg-slate-200 rounded-t-sm"></div>
                <div className="w-3 h-20 bg-slate-200 rounded-t-sm"></div>
                <div className="w-3 h-8 bg-moodle-blue/40 rounded-t-sm"></div>
                <div className="w-3 h-6 bg-moodle-blue/40 rounded-t-sm"></div>
              </div>
              <p className="text-[10px] mt-3 text-slate-400 italic">* Blue bars represent hours saved by Boosters.</p>
            </div>
          </div>

          <div className="moodle-card p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Prime Benefits</h3>
            <ul className="space-y-4">
              {[
                { title: 'Recall Speed', value: '+40%', desc: 'Mentioned by students who use Boosters.' },
                { title: 'Confidence', value: 'High', desc: 'Pre-prime your brain for complex topics.' },
                { title: 'Grade Impact', value: '+12%', desc: 'Based on historical cohort data.' }
              ].map((benefit, i) => (
                <li key={i} className="flex items-start space-x-3">
                  <div className="w-1 h-10 bg-blue-100 rounded-full flex-shrink-0"></div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-moodle-blue">{benefit.value}</span>
                      <span className="text-xs font-bold text-slate-800">{benefit.title}</span>
                    </div>
                    <p className="text-[10px] text-slate-400">{benefit.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreReadBooster;
