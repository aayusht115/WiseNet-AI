
import React, { useState } from 'react';
import { Calendar, Loader2, Plus, Sparkles, Clock, BookOpen } from 'lucide-react';
import { StudyPlanItem } from '../types';
import { geminiService } from '../services/geminiService';

const Planner: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [course, setCourse] = useState('');
  const [topics, setTopics] = useState('');
  const [duration, setDuration] = useState('1 week');
  const [plan, setPlan] = useState<StudyPlanItem[]>([]);

  const generatePlan = async () => {
    if (!course || !topics) return;
    setLoading(true);
    try {
      const result = await geminiService.generateStudyPlan(course, topics, duration);
      setPlan(result);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">AI Study Planner</h2>
          <p className="text-slate-500 text-sm">Transform your syllabus into a personalized learning roadmap.</p>
        </div>
        <div className="flex items-center text-xs font-bold text-moodle-blue bg-blue-50 px-4 py-2 rounded-full border border-blue-100">
          <Sparkles size={14} className="mr-2" />
          AI-Powered Scheduling
        </div>
      </div>

      <div className="moodle-card p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Course / Module Name</label>
            <input 
              type="text" 
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              placeholder="e.g. Data Structures"
              className="w-full bg-white border border-slate-300 rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue focus:border-transparent"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Duration</label>
            <select 
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue focus:border-transparent"
            >
              <option>3 days (Intense)</option>
              <option>1 week</option>
              <option>2 weeks</option>
              <option>1 month</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">Topics to Cover</label>
          <textarea 
            rows={4}
            value={topics}
            onChange={(e) => setTopics(e.target.value)}
            placeholder="Paste your topic list or syllabus here..."
            className="w-full bg-white border border-slate-300 rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue focus:border-transparent resize-none"
          ></textarea>
        </div>
        <div className="flex justify-end">
          <button 
            onClick={generatePlan}
            disabled={loading || !course || !topics}
            className="moodle-btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <>
                <Calendar size={18} />
                <span>Generate My Study Plan</span>
              </>
            )}
          </button>
        </div>
      </div>

      {plan.length > 0 && (
        <div className="space-y-6 animate-in fade-in duration-700">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h2 className="text-xl font-bold text-slate-800">Your Personalized Plan</h2>
            <button className="text-sm font-semibold text-moodle-blue flex items-center hover:underline">
              <Plus size={16} className="mr-1" /> Add to calendar
            </button>
          </div>
          <div className="space-y-4">
            {plan.map((item, idx) => (
              <div key={idx} className="moodle-card p-6 hover:border-moodle-blue transition-colors group">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <span className="text-[10px] font-bold text-moodle-blue uppercase tracking-widest">{item.day}</span>
                    <h3 className="text-lg font-bold text-slate-900 mt-1">{item.topic}</h3>
                  </div>
                  <div className="flex items-center text-slate-400 text-xs font-medium">
                    <Clock size={14} className="mr-1" />
                    {item.estimatedTime}
                  </div>
                </div>
                <div className="space-y-3">
                  {item.activities.map((activity, aIdx) => (
                    <div key={aIdx} className="flex items-start space-x-3 group/item">
                      <div className="mt-1 w-4 h-4 rounded border border-slate-300 flex items-center justify-center group-hover/item:border-moodle-blue transition-colors bg-slate-50">
                        <div className="w-2 h-2 bg-moodle-blue rounded-sm opacity-0 group-hover/item:opacity-100"></div>
                      </div>
                      <span className="text-slate-600 text-sm leading-tight">{activity}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Planner;
