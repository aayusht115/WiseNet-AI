
import React, { useState, useEffect } from 'react';
import { Plus, MoreHorizontal, ChevronDown, Loader2 } from 'lucide-react';
import { Course, NavigationTab } from '../types';

interface FacultySetupProps {
  onAddCourse: () => void;
  onSelectCourse: (courseId: number) => void;
}

const FacultySetup: React.FC<FacultySetupProps> = ({ onAddCourse, onSelectCourse }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectingId, setSelectingId] = useState<number | null>(null);

  const fetchCourses = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch('/api/courses');
      if (!response.ok) {
        setError("Could not load your courses.");
        return;
      }
      const data = await response.json();
      setCourses(data);
    } catch (err) {
      console.error("Failed to fetch courses", err);
      setError("Could not load your courses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  const handleSelect = (id: number) => {
    setSelectingId(id);
    onSelectCourse(id);
  };

  return (
    <div className="animate-in fade-in duration-500">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800 mb-6">WiseNet LMS</h1>
        
        {/* Moodle-style Tabs */}
        <div className="flex border-b border-slate-200 mb-8">
          {['Home', 'Settings', 'Participants', 'Reports', 'Question banks', 'More'].map((tab, i) => (
            <button 
              key={tab}
              className={`px-4 py-3 text-sm font-medium transition-all relative ${
                i === 0 ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab}
              {i === 0 && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-moodle-blue"></div>}
              {tab === 'More' && <ChevronDown size={14} className="inline ml-1" />}
            </button>
          ))}
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-2xl font-bold text-slate-800">Available courses</h2>
            <button
              onClick={onAddCourse}
              className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-black"
            >
              + Add Course
            </button>
          </div>
          
          <p className="text-sm text-slate-500">
            Courses are fetched from the database and can be edited from course management.
          </p>

          {loading ? (
            <div className="py-12 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-moodle-blue"></div>
            </div>
          ) : error ? (
            <div className="moodle-card p-6 border border-rose-200 bg-rose-50 text-rose-700 text-sm flex items-center justify-between gap-3">
              <span>{error}</span>
              <button
                onClick={fetchCourses}
                className="px-3 py-1.5 rounded border border-rose-300 text-xs font-bold hover:bg-rose-100"
              >
                Retry
              </button>
            </div>
          ) : courses.length === 0 ? (
            <div className="moodle-card p-8 text-center space-y-3">
              <p className="text-sm text-slate-600">No courses created yet.</p>
              <button
                onClick={onAddCourse}
                className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-black"
              >
                Create Your First Course
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
              {courses.map(course => (
                <button
                  type="button"
                  key={course.id}
                  onClick={() => handleSelect(course.id)}
                  className={`moodle-card group cursor-pointer hover:shadow-md transition-all overflow-hidden relative ${selectingId === course.id ? 'opacity-70 pointer-events-none' : ''}`}
                >
                  {selectingId === course.id && (
                    <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] flex items-center justify-center z-10">
                      <Loader2 size={32} className="text-moodle-blue animate-spin" />
                    </div>
                  )}
                  <div className="h-32 bg-slate-100 relative">
                    {course.image_url ? (
                      <img src={course.image_url} alt={course.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <Plus size={48} />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                      {course.code}
                    </div>
                    <h3 className="text-sm font-bold text-slate-800 group-hover:text-moodle-blue transition-colors line-clamp-2">
                      {course.name}
                    </h3>
                    <div className="mt-4 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">{course.instructor}</span>
                      <span className="p-1 text-slate-400">
                        <MoreHorizontal size={16} />
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FacultySetup;
