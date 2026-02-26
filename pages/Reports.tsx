
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Download, Filter, FileSpreadsheet, FileJson, TrendingUp, AlertTriangle } from 'lucide-react';

const PERFORMANCE_DATA = [
  { subject: 'Algorithms', score: 85, avg: 72 },
  { subject: 'Databases', score: 92, avg: 78 },
  { subject: 'Networks', score: 68, avg: 75 },
  { subject: 'AI', score: 88, avg: 80 },
  { subject: 'Security', score: 79, avg: 71 },
];

const TIME_DISTRIBUTION = [
  { name: 'Lectures', value: 35 },
  { name: 'Self-Study', value: 45 },
  { name: 'Projects', value: 20 },
];

const COLORS = ['#0070f3', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const Reports: React.FC = () => {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Learning Insights</h2>
          <p className="text-slate-500 text-sm mt-1">Comprehensive analytics for both students and faculty.</p>
        </div>
        <div className="flex space-x-2">
           <button className="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-300 rounded text-sm font-medium hover:bg-slate-50 transition-colors">
            <Filter size={16} />
            <span>Last Semester</span>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="moodle-card p-8">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-lg font-bold text-slate-800">Subject Performance</h3>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 uppercase tracking-widest">+12% vs Peers</span>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={PERFORMANCE_DATA}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="subject" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 600, fill: '#64748b'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 600, fill: '#64748b'}} />
                <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '4px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend iconType="rect" wrapperStyle={{paddingTop: '20px', fontSize: '11px', fontWeight: 600}} />
                <Bar dataKey="score" name="Your Score" fill="#0070f3" radius={[2, 2, 0, 0]} barSize={24} />
                <Bar dataKey="avg" name="Class Average" fill="#cbd5e1" radius={[2, 2, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="moodle-card p-8">
          <h3 className="text-lg font-bold text-slate-800 mb-8">Study Time Distribution</h3>
          <div className="flex flex-col md:flex-row items-center h-[300px]">
            <div className="h-full w-full md:w-1/2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={TIME_DISTRIBUTION}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {TIME_DISTRIBUTION.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full md:w-1/2 space-y-4">
              {TIME_DISTRIBUTION.map((entry, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS[index] }}></div>
                    <span className="text-xs font-semibold text-slate-600">{entry.name}</span>
                  </div>
                  <span className="text-xs font-bold text-slate-800">{entry.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-blue-50 border border-blue-100 rounded p-6 flex items-start space-x-4">
          <div className="w-12 h-12 bg-white border border-blue-200 rounded flex items-center justify-center text-moodle-blue flex-shrink-0 shadow-sm">
            <TrendingUp size={24} />
          </div>
          <div>
            <h4 className="font-bold text-slate-800">Personal Productivity Score</h4>
            <p className="text-slate-600 text-sm mt-1 leading-relaxed">Your learning efficiency has increased by 18% this month due to consistent AI-summarized readings and scheduled study blocks.</p>
          </div>
        </div>
        <div className="bg-red-50 border border-red-100 rounded p-6 flex items-start space-x-4">
          <div className="w-12 h-12 bg-white border border-red-200 rounded flex items-center justify-center text-red-600 flex-shrink-0 shadow-sm">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h4 className="font-bold text-slate-800">Attention Needed</h4>
            <p className="text-slate-600 text-sm mt-1 leading-relaxed">Computer Networks grade is below your average. Consider generating a custom study plan for Module 5.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reports;
