
import React, { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, Clock, Sparkles, TrendingUp, MoreHorizontal, Filter, Grid, List } from 'lucide-react';
import { Course, Activity } from '../types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const STUDY_DATA = [
  { name: 'Mon', hours: 4 },
  { name: 'Tue', hours: 3 },
  { name: 'Wed', hours: 6 },
  { name: 'Thu', hours: 4 },
  { name: 'Fri', hours: 2 },
  { name: 'Sat', hours: 8 },
  { name: 'Sun', hours: 5 },
];

const Dashboard: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [timeline, setTimeline] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [coursesRes, timelineRes] = await Promise.all([
          fetch('/api/courses/overview'),
          fetch('/api/dashboard/timeline')
        ]);
        if (coursesRes.ok) setCourses(await coursesRes.json());
        if (timelineRes.ok) setTimeline(await timelineRes.json());
      } catch (err) {
        console.error("Failed to fetch dashboard data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-moodle-blue"></div>
    </div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Course Overview Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Course overview</h2>
        <div className="flex items-center space-x-2">
          <div className="flex bg-slate-100 p-1 rounded-md">
            <button className="p-1.5 bg-white shadow-sm rounded text-moodle-blue"><Grid size={16} /></button>
            <button className="p-1.5 text-slate-500"><List size={16} /></button>
          </div>
          <button className="flex items-center space-x-2 px-3 py-1.5 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Filter size={14} />
            <span>All</span>
          </button>
          <button className="flex items-center space-x-2 px-3 py-1.5 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50">
            <span>Sort by course name</span>
          </button>
        </div>
      </div>

      {/* Course Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {courses.map((course) => (
          <div key={course.id} className="moodle-card overflow-hidden hover:shadow-lg transition-all duration-300 cursor-pointer group">
            <div className="h-32 bg-slate-200 relative">
              <img 
                src={`https://picsum.photos/seed/${course.id}/400/200`} 
                alt={course.name}
                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                referrerPolicy="no-referrer"
              />
              <div className="absolute top-2 right-2">
                <button className="p-1 bg-white/80 rounded-full hover:bg-white text-slate-600">
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </div>
            <div className="p-5">
              <div className="mb-4">
                <p className="text-[10px] font-bold text-moodle-blue uppercase tracking-wider mb-1">{course.code}</p>
                <h4 className="font-bold text-slate-900 group-hover:text-moodle-blue transition-colors leading-tight line-clamp-2 h-10">{course.name}</h4>
                <p className="text-xs text-slate-500 mt-1 truncate">{course.instructor}</p>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">{course.progress}% complete</span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-moodle-blue rounded-full transition-all duration-500" 
                    style={{ width: `${course.progress}%` }}
                  ></div>
                </div>
              </div>
              
              {course.nextDeadline && (
                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center text-[10px] text-amber-600 font-bold uppercase">
                  <Clock size={12} className="mr-1" />
                  Due: {course.nextDeadline}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Activity Trends Block */}
        <div className="lg:col-span-2 moodle-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-slate-800">Learning Activity</h2>
            <div className="flex items-center space-x-2 text-xs text-slate-500">
              <span className="flex items-center"><span className="w-3 h-3 bg-moodle-blue rounded-full mr-1"></span> Study Hours</span>
            </div>
          </div>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={STUDY_DATA}>
                <defs>
                  <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f6cbf" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#0f6cbf" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: '1px solid #dee2e6', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}
                  itemStyle={{ color: '#0f6cbf', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="hours" stroke="#0f6cbf" strokeWidth={2} fillOpacity={1} fill="url(#colorHours)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sidebar Blocks */}
        <div className="space-y-6">
          {/* AI Insights Block */}
          <div className="moodle-card p-6 border-l-4 border-l-moodle-orange">
            <div className="flex items-center space-x-2 mb-4 text-moodle-orange">
              <Sparkles size={20} />
              <h3 className="text-lg font-bold">AI Insights</h3>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed mb-4 italic">
              "You've been studying Business Communication late at night. Research shows you retain more logic-based concepts in the morning."
            </p>
            <button className="w-full py-2 bg-moodle-blue text-white rounded text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm">
              View Recommendations
            </button>
          </div>

          {/* Timeline Block */}
          <div className="moodle-card p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Timeline</h3>
            <div className="space-y-4">
              {timeline.length > 0 ? timeline.map((item, i) => (
                <div key={item.id} className="flex space-x-3 group cursor-pointer">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 bg-moodle-blue rounded-full"></div>
                    {i < timeline.length - 1 && <div className="w-0.5 h-full bg-slate-100 my-1"></div>}
                  </div>
                  <div className="pb-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">
                      {new Date(item.due_date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </p>
                    <h5 className="text-sm font-bold text-slate-800 group-hover:text-moodle-blue transition-colors">{item.title}</h5>
                    <p className="text-xs text-slate-500">{item.course_code}</p>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-slate-500 italic">No upcoming activities</p>
              )}
            </div>
            <button className="w-full mt-2 py-2 text-moodle-blue text-sm font-semibold hover:underline">
              Go to calendar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
