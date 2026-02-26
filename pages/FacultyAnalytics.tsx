
import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Target, 
  Flame, 
  AlertTriangle, 
  TrendingUp, 
  MousePointer2,
  Bell,
  CheckCircle,
  Clock
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';

const QUIZ_SCORES = [
  { range: '0-20%', count: 5 },
  { range: '21-40%', count: 12 },
  { range: '41-60%', count: 45 },
  { range: '61-80%', count: 88 },
  { range: '81-100%', count: 32 },
];

const COMPLETION_DATA = [
  { name: 'Opened', val: 182 },
  { name: 'Summary View', val: 156 },
  { name: 'Full Read', val: 98 },
  { name: 'Quiz Started', val: 92 },
  { name: 'Quiz Finished', val: 88 },
];

const HEATMAP_CONCEPTS = [
  { name: 'RAFT Protocol', difficulty: 85, confidence: 32, students: 45 },
  { name: 'CAP Theorem', difficulty: 45, confidence: 78, students: 82 },
  { name: 'Byzantine Fault', difficulty: 92, confidence: 15, students: 30 },
  { name: 'Network Partition', difficulty: 60, confidence: 55, students: 76 },
];

const FacultyAnalytics: React.FC = () => {
  const [risks, setRisks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRisks = async () => {
      try {
        const response = await fetch('/api/analytics/risks');
        if (response.ok) {
          setRisks(await response.json());
        }
      } catch (err) {
        console.error("Failed to fetch risks", err);
      } finally {
        setLoading(false);
      }
    };
    fetchRisks();
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Class Readiness Insights</h2>
          <p className="text-slate-500 text-sm mt-1">Distributed Systems CS401 • Section A</p>
        </div>
        <div className="flex space-x-3">
          <button className="px-4 py-2 bg-white border border-slate-300 rounded text-sm font-bold hover:bg-slate-50 transition-colors">
            Export Dataset
          </button>
          <button className="moodle-btn-primary px-4 py-2 rounded text-sm font-bold shadow-sm">
            Push Nudge to Low Activity
          </button>
        </div>
      </div>

      {/* Primary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { icon: <CheckCircle className="text-emerald-500" />, label: 'Readiness Meter', value: '72%', color: 'text-emerald-600' },
          { icon: <Clock className="text-moodle-blue" />, label: 'Avg. Time Spent', value: '38m', color: 'text-moodle-blue' },
          { icon: <Target className="text-blue-500" />, label: 'Quiz Proficiency', value: 'B+', color: 'text-blue-600' },
          { icon: <Flame className="text-moodle-orange" />, label: 'Burnout Risk', value: 'Low', color: 'text-emerald-600' },
        ].map((stat, i) => (
          <div key={i} className="moodle-card p-6">
            <div className="w-10 h-10 bg-slate-50 rounded border border-slate-100 flex items-center justify-center mb-4">
              {stat.icon}
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
            <h3 className={`text-2xl font-black mt-1 ${stat.color}`}>{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Completion Funnel */}
        <div className="lg:col-span-2 moodle-card p-8">
          <h3 className="text-lg font-bold text-slate-800 mb-8 flex items-center space-x-2">
            <MousePointer2 size={20} className="text-moodle-blue" />
            <span>Learning Engagement Funnel</span>
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={COMPLETION_DATA} layout="vertical">
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700, fill: '#64748b'}} />
                <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '4px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Bar dataKey="val" radius={[0, 2, 2, 0]} barSize={24}>
                  {COMPLETION_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === COMPLETION_DATA.length - 1 ? '#0070f3' : '#e2e8f0'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Engagement Risks */}
        <div className="moodle-card p-6 space-y-6">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center space-x-2">
            <AlertTriangle size={20} className="text-red-500" />
            <span>Engagement Risks</span>
          </h3>
          <div className="space-y-4">
            {loading ? (
              <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-moodle-blue"></div></div>
            ) : risks.length > 0 ? risks.map((risk, i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded border border-slate-200 group">
                <div>
                  <h5 className="text-sm font-bold text-slate-800">{risk.name}</h5>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{risk.issue}</p>
                </div>
                <button className={`p-2 rounded transition-colors border ${risk.status === 'critical' ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' : 'bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100'}`}>
                  <Bell size={16} />
                </button>
              </div>
            )) : (
              <p className="text-sm text-slate-500 italic text-center py-4">No critical risks identified.</p>
            )}
          </div>
          <button className="w-full py-2.5 bg-slate-800 text-white rounded font-bold text-xs hover:bg-slate-700 transition-all shadow-sm">
            View All 12 Risks
          </button>
        </div>
      </div>

      {/* Heatmap Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="moodle-card p-8">
          <h3 className="text-lg font-bold text-slate-800 mb-8 flex items-center space-x-2">
            <TrendingUp size={20} className="text-emerald-500" />
            <span>Weak Concept Heatmap</span>
          </h3>
          <div className="space-y-4">
            {HEATMAP_CONCEPTS.map((concept, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-between items-end">
                  <span className="text-sm font-bold text-slate-700">{concept.name}</span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{concept.confidence}% Confidence</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                  <div 
                    className={`h-full transition-all duration-1000 ${concept.confidence < 40 ? 'bg-red-500' : concept.confidence < 70 ? 'bg-moodle-orange' : 'bg-emerald-500'}`}
                    style={{ width: `${concept.confidence}%` }}
                  ></div>
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Impacts {concept.students} students</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-800 rounded p-8 text-white relative overflow-hidden border-l-4 border-moodle-blue shadow-lg">
           <div className="absolute top-[-20px] right-[-20px] w-40 h-40 bg-moodle-blue/10 rounded-full blur-3xl"></div>
           <h3 className="text-lg font-bold mb-6 flex items-center space-x-2">
             <Users size={20} className="text-moodle-blue" />
             <span>AI Pedagogy Recommendation</span>
           </h3>
           <div className="space-y-6">
             <div className="bg-slate-700/50 backdrop-blur-sm border border-slate-600 p-5 rounded">
               <p className="text-sm leading-relaxed text-slate-200 italic">
                 "72% of students identified <span className="font-bold text-moodle-blue">Consensus Mechanisms</span> as their weakest topic. Suggest starting tomorrow's lecture with a live demo of the visual RAFT simulator to bridge the mental model gap."
               </p>
             </div>
             <div className="grid grid-cols-2 gap-4">
               <div className="bg-slate-700/30 p-4 rounded border border-slate-700">
                 <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Top Query</div>
                 <div className="text-sm font-bold truncate">"What happens during partition?"</div>
               </div>
               <div className="bg-slate-700/30 p-4 rounded border border-slate-700">
                 <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Best Time to Teach</div>
                 <div className="text-sm font-bold">First 15 mins</div>
               </div>
             </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default FacultyAnalytics;
