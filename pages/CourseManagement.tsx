
import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Users, 
  BarChart2, 
  FileText, 
  MoreVertical, 
  Plus, 
  ChevronDown, 
  Edit3, 
  Eye,
  GripVertical,
  MessageSquare,
  File,
  HelpCircle,
  X,
  Loader2
} from 'lucide-react';
import { Course, CourseSection, CourseActivity } from '../types';

interface CourseManagementProps {
  courseId: number;
  onBack: () => void;
}

const CourseManagement: React.FC<CourseManagementProps> = ({ courseId, onBack }) => {
  const [course, setCourse] = useState<Course | null>(null);
  const [sections, setSections] = useState<CourseSection[]>([]);
  const [activities, setActivities] = useState<CourseActivity[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [showEnrolModal, setShowEnrolModal] = useState(false);
  const [enrollingId, setEnrollingId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'course' | 'settings' | 'participants' | 'reports'>('course');
  const [loading, setLoading] = useState(true);

  const fetchParticipants = async () => {
    const response = await fetch(`/api/courses/${courseId}/participants`);
    if (response.ok) setParticipants(await response.json());
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [courseRes, sectionsRes, activitiesRes, participantsRes, studentsRes] = await Promise.all([
          fetch(`/api/courses/${courseId}`),
          fetch(`/api/courses/${courseId}/sections`),
          fetch(`/api/courses/${courseId}/activities`),
          fetch(`/api/courses/${courseId}/participants`),
          fetch(`/api/students`)
        ]);
        
        if (courseRes.ok) setCourse(await courseRes.json());
        if (sectionsRes.ok) setSections(await sectionsRes.json());
        if (activitiesRes.ok) setActivities(await activitiesRes.json());
        if (participantsRes.ok) setParticipants(await participantsRes.json());
        if (studentsRes.ok) setAllStudents(await studentsRes.json());
      } catch (err) {
        console.error("Failed to fetch course data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [courseId]);

  const handleEnrol = async (userId: number) => {
    setEnrollingId(userId);
    try {
      const response = await fetch(`/api/courses/${courseId}/enrol`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
      });
      if (response.ok) {
        await fetchParticipants();
      }
    } finally {
      setEnrollingId(null);
    }
  };

  if (loading) return <div className="py-12 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-moodle-blue"></div></div>;
  if (!course) return <div>Course not found</div>;

  const renderCourseContent = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <div className="flex items-center space-x-4">
          <button className="text-sm font-medium text-slate-600 hover:text-slate-900">Expand all</button>
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-sm font-medium text-slate-700">Edit mode</span>
          <button 
            onClick={() => setEditMode(!editMode)}
            className={`w-10 h-5 rounded-full relative transition-colors ${editMode ? 'bg-moodle-blue' : 'bg-slate-300'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${editMode ? 'right-0.5' : 'left-0.5'}`}></div>
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {sections.map((section) => (
          <div key={section.id} className="moodle-card overflow-hidden bg-white">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between group">
              <div className="flex items-center">
                {editMode && <GripVertical size={16} className="text-slate-300 mr-2 cursor-move" />}
                <h3 className="text-xl font-bold text-slate-800">{section.title}</h3>
                {editMode && <Edit3 size={14} className="ml-2 text-slate-400 cursor-pointer hover:text-moodle-blue" />}
              </div>
              <div className="flex items-center space-x-2">
                {editMode && (
                  <button className="text-xs font-medium text-slate-500 hover:text-moodle-blue flex items-center">
                    Edit <ChevronDown size={14} className="ml-1" />
                  </button>
                )}
              </div>
            </div>
            <div className="p-4 space-y-2">
              {activities.filter(a => a.section_id === section.id).map(activity => (
                <div key={activity.id} className="flex items-center justify-between p-3 hover:bg-slate-50 rounded transition-colors group">
                  <div className="flex items-center space-x-3">
                    {editMode && <GripVertical size={16} className="text-slate-300 cursor-move" />}
                    <div className="p-2 bg-blue-50 rounded text-moodle-blue">
                      {activity.type === 'forum' && <MessageSquare size={16} />}
                      {activity.type === 'resource' && <File size={16} />}
                      {activity.type === 'assignment' && <FileText size={16} />}
                      {activity.type === 'quiz' && <HelpCircle size={16} />}
                    </div>
                    <div>
                      <span className="text-sm font-medium text-slate-800 hover:text-moodle-blue cursor-pointer">
                        {activity.title}
                      </span>
                      {activity.due_date && (
                        <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                          Due: {new Date(activity.due_date).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    {!editMode && <div className="w-4 h-4 border border-slate-300 rounded"></div>}
                    {editMode && (
                      <div className="flex items-center space-x-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="text-xs font-medium text-slate-500 hover:text-moodle-blue">Edit</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {editMode && (
                <button className="w-full py-3 mt-4 border-2 border-dashed border-slate-200 rounded-lg text-slate-400 hover:border-moodle-blue hover:text-moodle-blue transition-all flex items-center justify-center space-x-2">
                  <Plus size={16} />
                  <span className="text-sm font-bold uppercase tracking-widest">Add an activity or resource</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderParticipants = () => (
    <div className="moodle-card p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-slate-800">Enrolled users</h3>
        <button 
          onClick={() => setShowEnrolModal(true)}
          className="moodle-btn-primary px-4 py-2 rounded text-sm font-bold"
        >
          Enrol users
        </button>
      </div>

      {showEnrolModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h4 className="font-bold text-slate-800">Enrol users</h4>
              <button onClick={() => setShowEnrolModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-4 max-h-96 overflow-y-auto space-y-2">
              {allStudents.filter(s => !participants.find(p => p.id === s.id)).map(student => (
                <div key={student.id} className="flex items-center justify-between p-3 hover:bg-slate-50 rounded border border-slate-100">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{student.name}</p>
                    <p className="text-xs text-slate-500">{student.email}</p>
                  </div>
                  <button 
                    onClick={() => handleEnrol(student.id)}
                    disabled={enrollingId === student.id}
                    className="px-3 py-1 bg-moodle-blue text-white rounded text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center space-x-1"
                  >
                    {enrollingId === student.id && <Loader2 size={12} className="animate-spin" />}
                    <span>{enrollingId === student.id ? 'Enrolling...' : 'Enrol'}</span>
                  </button>
                </div>
              ))}
              {allStudents.filter(s => !participants.find(p => p.id === s.id)).length === 0 && (
                <p className="text-sm text-slate-500 italic text-center py-4">All students are already enrolled.</p>
              )}
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button onClick={() => setShowEnrolModal(false)} className="px-4 py-2 bg-slate-200 text-slate-800 rounded text-sm font-bold hover:bg-slate-300">Close</button>
            </div>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-widest">
              <th className="px-4 py-3">First name / Surname</th>
              <th className="px-4 py-3">Email address</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3">Groups</th>
              <th className="px-4 py-3">Last access to course</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {participants.map((user, i) => (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td className="px-4 py-4 font-medium text-moodle-blue">{user.name}</td>
                <td className="px-4 py-4 text-slate-600">{user.email}</td>
                <td className="px-4 py-4 text-slate-600 capitalize">{user.role}</td>
                <td className="px-4 py-4 text-slate-600">None</td>
                <td className="px-4 py-4 text-slate-600">
                  {user.last_accessed ? new Date(user.last_accessed).toLocaleDateString() : 'Never'}
                </td>
                <td className="px-4 py-4">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                    user.last_accessed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {user.last_accessed ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="animate-in fade-in duration-500">
      <div className="mb-6">
        <div className="text-xs text-moodle-blue flex items-center space-x-2 mb-2">
          <span className="cursor-pointer hover:underline" onClick={onBack}>Home</span>
          <span>/</span>
          <span className="text-slate-500">{course.code}</span>
        </div>
        <h1 className="text-3xl font-bold text-slate-800">{course.name}</h1>
      </div>

      <div className="flex border-b border-slate-200 mb-8 overflow-x-auto">
        {[
          { id: 'course', label: 'Course', icon: <BarChart2 size={16} /> },
          { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
          { id: 'participants', label: 'Participants', icon: <Users size={16} /> },
          { id: 'reports', label: 'Reports', icon: <FileText size={16} /> },
        ].map((tab) => (
          <button 
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-6 py-4 text-sm font-medium transition-all relative flex items-center space-x-2 whitespace-nowrap ${
              activeTab === tab.id ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-moodle-blue"></div>}
          </button>
        ))}
        <button className="px-6 py-4 text-sm font-medium text-slate-500 hover:text-slate-700 flex items-center space-x-2">
          <span>More</span>
          <ChevronDown size={14} />
        </button>
      </div>

      {activeTab === 'course' && renderCourseContent()}
      {activeTab === 'participants' && renderParticipants()}
      {activeTab === 'settings' && <div>Settings View (Similar to Editor)</div>}
      {activeTab === 'reports' && <div>Reports View (Analytics)</div>}
    </div>
  );
};

export default CourseManagement;
