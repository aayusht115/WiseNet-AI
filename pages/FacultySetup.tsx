
import React, { useState, useEffect } from 'react';
import { Plus, MoreHorizontal, ChevronDown } from 'lucide-react';
import { Course, NavigationTab } from '../types';

interface FacultySetupProps {
  onAddCourse: () => void;
  onSelectCourse: (courseId: number) => void;
}

const FacultySetup: React.FC<FacultySetupProps> = ({ onAddCourse, onSelectCourse }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const response = await fetch('/api/courses');
        if (response.ok) {
          const data = await response.json();
          setCourses(data);
        }
      } catch (err) {
        console.error("Failed to fetch courses", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCourses();
  }, []);

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
          <h2 className="text-2xl font-bold text-slate-800">Available courses</h2>
          
          <button 
            onClick={onAddCourse}
            className="px-4 py-2 bg-slate-200 text-slate-800 rounded text-sm font-medium hover:bg-slate-300 transition-colors"
          >
            Add a new course
          </button>

          {loading ? (
            <div className="py-12 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-moodle-blue"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
              {courses.map(course => (
                <div 
                  key={course.id}
                  onClick={() => onSelectCourse(course.id)}
                  className="moodle-card group cursor-pointer hover:shadow-md transition-all overflow-hidden"
                >
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
                      <button className="p-1 text-slate-400 hover:text-slate-600">
                        <MoreHorizontal size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FacultySetup;
