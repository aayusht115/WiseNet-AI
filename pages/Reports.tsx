
import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Download, Filter, FileSpreadsheet, FileJson, TrendingUp, AlertTriangle, Loader2 } from 'lucide-react';

const COLORS = ['#0070f3', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

interface QuizPerf { subject: string; score: number; avg: number; }
interface PrereadStat { name: string; value: number; }
interface LearningStats {
  quiz_performance: QuizPerf[];
  preread_stats: PrereadStat[];
  totals: { total: number; readDone: number; quizDone: number; };
}

const Reports: React.FC = () => {
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/student/learning-stats')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setStats(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const perfData = stats?.quiz_performance ?? [];
  const pieData = stats?.preread_stats ?? [];

  const worstSubject = perfData.length
    ? perfData.reduce((a, b) => (a.score < b.score ? a : b))
    : null;

  const avgUserScore = perfData.length
    ? Math.round(perfData.reduce((s, d) => s + d.score, 0) / perfData.length)
    : null;
  const avgClassScore = perfData.length
    ? Math.round(perfData.reduce((s, d) => s + d.avg, 0) / perfData.length)
    : null;
  const diffVsPeers = avgUserScore !== null && avgClassScore !== null
    ? avgUserScore - avgClassScore
    : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Learning Insights</h2>
          <p className="text-slate-500 text-sm mt-1">Analytics based on your quiz attempts and reading activity.</p>
        </div>
        <div className="flex space-x-2">
          <button className="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-300 rounded text-sm font-medium hover:bg-slate-50 transition-colors">
            <Filter size={16} />
            <span>This Semester</span>
          </button>
          <div className="relative group">
            <button className="moodle-btn-primary flex items-center space-x-2 px-4 py-2 rounded text-sm font-bold shadow-sm">
              <Download size={16} />
              <span>Export Report</span>
            </button>
            <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
              <button className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 flex items-center space-x-2 border-b border-slate-50">
                <FileSpreadsheet className="text-emerald-500" size={16} />
                <span>Excel (.xlsx)</span>
              </button>
              <button className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 flex items-center space-x-2">
                <FileJson className="text-amber-500" size={16} />
                <span>JSON Data</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="animate-spin mr-2" size={20} />
          <span className="text-sm font-medium">Loading your stats...</span>
        </div>
      )}

      {!loading && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="moodle-card p-8">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-lg font-bold text-slate-800">Quiz Performance by Course</h3>
                {diffVsPeers !== null && (
                  <span className={`text-[10px] font-bold px-2 py-1 rounded border uppercase tracking-widest ${diffVsPeers >= 0 ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-red-500 bg-red-50 border-red-100'}`}>
                    {diffVsPeers >= 0 ? '+' : ''}{diffVsPeers}% vs Peers
                  </span>
                )}
              </div>
              {perfData.length > 0 ? (
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={perfData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="subject" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} domain={[0, 100]} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '4px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Legend iconType="rect" wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontWeight: 600 }} />
                      <Bar dataKey="score" name="Your Score" fill="#0070f3" radius={[2, 2, 0, 0]} barSize={24} />
                      <Bar dataKey="avg" name="Class Average" fill="#cbd5e1" radius={[2, 2, 0, 0]} barSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-slate-400 text-sm">
                  No quiz attempts yet. Complete a quiz to see your performance here.
                </div>
              )}
            </div>

            <div className="moodle-card p-8">
              <h3 className="text-lg font-bold text-slate-800 mb-8">Pre-Read Activity</h3>
              {pieData.length > 0 ? (
                <div className="flex flex-col md:flex-row items-center h-[300px]">
                  <div className="h-full w-full md:w-1/2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {pieData.map((_entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full md:w-1/2 space-y-4">
                    {pieData.map((entry, index) => (
                      <div key={index} className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS[index] }}></div>
                          <span className="text-xs font-semibold text-slate-600">{entry.name}</span>
                        </div>
                        <span className="text-xs font-bold text-slate-800">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-slate-400 text-sm">
                  No reading activity recorded yet.
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-blue-50 border border-blue-100 rounded p-6 flex items-start space-x-4">
              <div className="w-12 h-12 bg-white border border-blue-200 rounded flex items-center justify-center text-moodle-blue flex-shrink-0 shadow-sm">
                <TrendingUp size={24} />
              </div>
              <div>
                <h4 className="font-bold text-slate-800">Overall Performance</h4>
                {avgUserScore !== null ? (
                  <p className="text-slate-600 text-sm mt-1 leading-relaxed">
                    Your average quiz score is <strong>{avgUserScore}%</strong> compared to a class average of <strong>{avgClassScore}%</strong>.
                    {stats?.totals && ` You have completed ${stats.totals.quizDone} of ${stats.totals.total} available quizzes and read ${stats.totals.readDone} materials.`}
                  </p>
                ) : (
                  <p className="text-slate-600 text-sm mt-1 leading-relaxed">
                    Complete quizzes to start seeing your performance data here.
                  </p>
                )}
              </div>
            </div>
            <div className={`rounded p-6 flex items-start space-x-4 ${worstSubject && worstSubject.score < worstSubject.avg ? 'bg-red-50 border border-red-100' : 'bg-emerald-50 border border-emerald-100'}`}>
              <div className={`w-12 h-12 bg-white rounded flex items-center justify-center flex-shrink-0 shadow-sm ${worstSubject && worstSubject.score < worstSubject.avg ? 'border border-red-200 text-red-600' : 'border border-emerald-200 text-emerald-600'}`}>
                <AlertTriangle size={24} />
              </div>
              <div>
                <h4 className="font-bold text-slate-800">
                  {worstSubject && worstSubject.score < worstSubject.avg ? 'Attention Needed' : 'Keep It Up!'}
                </h4>
                <p className="text-slate-600 text-sm mt-1 leading-relaxed">
                  {worstSubject && worstSubject.score < worstSubject.avg
                    ? `Your score in ${worstSubject.subject} (${worstSubject.score}%) is below the class average (${worstSubject.avg}%). Consider generating a custom study plan.`
                    : worstSubject
                      ? `You are scoring above the class average in all courses. Lowest is ${worstSubject.subject} at ${worstSubject.score}%.`
                      : 'Complete a quiz to get personalised tips here.'}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Reports;
