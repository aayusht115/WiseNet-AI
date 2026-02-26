
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
    <div className="space-y-10 animate-in fade-in duration-500">
      {/* Timeline Section (Upcoming stuff) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 moodle-card p-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-slate-800 flex items-center space-x-2">
              <Clock size={20} className="text-moodle-blue" />
              <span>Timeline</span>
            </h2>
            <button className="text-moodle-blue text-sm font-semibold hover:underline">
              Go to calendar
            </button>
          </div>
          <div className="space-y-6">
            {timeline.length > 0 ? timeline.map((item, i) => (
              <div key={item.id} className="flex space-x-4 group cursor-pointer p-3 hover:bg-slate-50 rounded-lg transition-colors border border-transparent hover:border-slate-100">
                <div className="flex flex-col items-center pt-1">
                  <div className="w-3 h-3 bg-moodle-blue rounded-full ring-4 ring-blue-50"></div>
                  {i < timeline.length - 1 && <div className="w-0.5 h-full bg-slate-100 my-2"></div>}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                      {new Date(item.due_date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </p>
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded uppercase">Upcoming</span>
                  </div>
                  <h5 className="text-base font-bold text-slate-800 group-hover:text-moodle-blue transition-colors">{item.title}</h5>
                  <p className="text-sm text-slate-500">{item.course_code} • {item.course_name}</p>
                </div>
              </div>
            )) : (
              <div className="text-center py-12">
                <CheckCircle2 size={40} className="mx-auto text-slate-200 mb-3" />
                <p className="text-slate-500 font-medium">No upcoming activities</p>
              </div>
            )}
          </div>
        </div>

        {/* Quick Stats / Info Block */}
        <div className="space-y-6">
          <div className="moodle-card p-6 bg-slate-800 text-white border-none">
            <h3 className="text-lg font-bold mb-4 flex items-center space-x-2">
              <TrendingUp size={20} className="text-moodle-blue" />
              <span>Study Progress</span>
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Overall Completion</span>
                  <span className="text-moodle-blue font-bold">68%</span>
                </div>
                <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-moodle-blue w-[68%]"></div>
                </div>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                You have 3 assignments due this week. Keep up the great work!
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Course Overview Section */}
      <div className="space-y-6">
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
          </div>
        </div>

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
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
