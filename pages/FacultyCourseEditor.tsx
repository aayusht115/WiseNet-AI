
import React, { useState, useEffect } from 'react';
import { ChevronDown, HelpCircle, AlertCircle, Upload, X, Loader2 } from 'lucide-react';
import { Course } from '../types';

interface FacultyCourseEditorProps {
  courseId?: number;
  onSave: () => void;
  onCancel: () => void;
}

const FormSection = ({ title, children, isOpen = true }: { title: string, children: React.ReactNode, isOpen?: boolean }) => {
  const [open, setOpen] = useState(isOpen);
  return (
    <div className="border-b border-slate-200">
      <button 
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center p-4 hover:bg-slate-50 transition-all duration-200"
      >
        <div className={`p-1 bg-blue-50 rounded mr-3 transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}>
          <ChevronDown size={16} className="text-moodle-blue" />
        </div>
        <h3 className="text-xl font-medium text-slate-800">{title}</h3>
      </button>
      {open && <div className="p-6 pt-0 space-y-6 animate-in fade-in slide-in-from-top-2 duration-200">{children}</div>}
    </div>
  );
};

const FormField = ({ label, required, children, help }: { label: string, required?: boolean, children: React.ReactNode, help?: string }) => (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
    <div className="flex items-center space-x-2 pt-2">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      {required && <AlertCircle size={14} className="text-red-500 fill-red-500" />}
      {help && <HelpCircle size={14} className="text-moodle-blue cursor-help" />}
    </div>
    <div className="md:col-span-2">
      {children}
    </div>
  </div>
);

const FacultyCourseEditor: React.FC<FacultyCourseEditorProps> = ({ courseId, onSave, onCancel }) => {
  const [formData, setFormData] = useState<Partial<Course>>({
    name: '',
    code: '',
    visibility: 'show',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0],
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (courseId) {
      // Fetch course data if editing
      const fetchCourse = async () => {
        const response = await fetch(`/api/courses/${courseId}`);
        if (response.ok) {
          const data = await response.json();
          setFormData(data);
        }
      };
      fetchCourse();
    }
  }, [courseId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const url = courseId ? `/api/courses/${courseId}` : '/api/courses';
      const method = courseId ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        onSave();
      }
    } catch (err) {
      console.error("Failed to save course", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6">
        <div className="text-xs text-moodle-blue flex items-center space-x-2 mb-2">
          <span>Courses</span>
          <span>/</span>
          <span>Category 1</span>
          <span>/</span>
          <span>Manage courses and categories</span>
          <span>/</span>
          <span className="text-slate-500">Add a new course</span>
        </div>
        <h1 className="text-3xl font-bold text-slate-800">Category 1</h1>
      </div>

      <div className="flex border-b border-slate-200 mb-8">
        {['Category', 'Settings', 'Upload courses', 'More'].map((tab, i) => (
          <button 
            key={tab}
            className={`px-4 py-3 text-sm font-medium transition-all relative ${
              i === 1 ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
            {i === 1 && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-moodle-blue"></div>}
            {tab === 'More' && <ChevronDown size={14} className="inline ml-1" />}
          </button>
        ))}
      </div>

      <h2 className="text-2xl font-bold text-slate-800 mb-8">Add a new course</h2>

      <form onSubmit={handleSubmit} className="moodle-card overflow-hidden bg-white shadow-sm border border-slate-200 rounded-lg">
        <div className="flex justify-end p-4 border-b border-slate-100">
          <button type="button" className="text-xs text-moodle-blue font-medium hover:underline">Expand all</button>
        </div>

        <FormSection title="General">
          <FormField label="Course full name" required help="The full name of the course is displayed at the top of each page in the course and in the list of courses.">
            <input 
              type="text" 
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
              className="w-full md:w-2/3 border border-slate-300 rounded p-2 text-sm focus:ring-1 focus:ring-moodle-blue outline-none" 
              required
            />
          </FormField>
          
          <FormField label="Course short name" required help="Many institutions have a short name for a course, such as a number or a code.">
            <input 
              type="text" 
              value={formData.code}
              onChange={e => setFormData({...formData, code: e.target.value})}
              className="w-full md:w-1/3 border border-slate-300 rounded p-2 text-sm focus:ring-1 focus:ring-moodle-blue outline-none" 
              required
            />
          </FormField>

          <FormField label="Course category" required>
            <div className="flex items-center space-x-2">
              <div className="bg-blue-50 text-moodle-blue px-3 py-1 rounded border border-blue-100 text-sm flex items-center">
                <X size={14} className="mr-2 cursor-pointer" />
                Category 1
              </div>
              <select className="border border-slate-300 rounded p-2 text-sm focus:ring-1 focus:ring-moodle-blue outline-none">
                <option>Search</option>
              </select>
            </div>
          </FormField>

          <FormField label="Course visibility">
            <select 
              value={formData.visibility}
              onChange={e => setFormData({...formData, visibility: e.target.value as 'show' | 'hide'})}
              className="w-full md:w-1/4 border border-slate-300 rounded p-2 text-sm focus:ring-1 focus:ring-moodle-blue outline-none"
            >
              <option value="show">Show</option>
              <option value="hide">Hide</option>
            </select>
          </FormField>

          <FormField label="Course start date">
            <input 
              type="date" 
              value={formData.start_date?.split('T')[0]}
              onChange={e => setFormData({...formData, start_date: e.target.value})}
              className="border border-slate-300 rounded p-2 text-sm focus:ring-1 focus:ring-moodle-blue outline-none" 
            />
          </FormField>

          <FormField label="Course end date">
            <div className="flex items-center space-x-4">
              <input 
                type="date" 
                value={formData.end_date?.split('T')[0]}
                onChange={e => setFormData({...formData, end_date: e.target.value})}
                className="border border-slate-300 rounded p-2 text-sm focus:ring-1 focus:ring-moodle-blue outline-none" 
              />
              <label className="flex items-center text-sm text-slate-600">
                <input type="checkbox" className="mr-2" defaultChecked />
                Enable
              </label>
            </div>
          </FormField>
        </FormSection>

        <FormSection title="Description" isOpen={false}>
          <FormField label="Course summary">
            <textarea 
              rows={6}
              value={formData.description}
              onChange={e => setFormData({...formData, description: e.target.value})}
              className="w-full border border-slate-300 rounded p-2 text-sm focus:ring-1 focus:ring-moodle-blue outline-none"
              placeholder="Enter course description..."
            ></textarea>
          </FormField>

          <FormField label="Course image">
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-12 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer">
              <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                <Upload size={24} className="text-slate-500" />
              </div>
              <p className="text-sm text-slate-600">You can drag and drop files here to add them.</p>
              <p className="text-xs text-slate-400 mt-2">Maximum file size: Unlimited, maximum number of files: 1</p>
            </div>
          </FormField>
        </FormSection>

        <FormSection title="Course format" isOpen={false}>
          <FormField label="Format">
            <select className="w-full md:w-1/3 border border-slate-300 rounded p-2 text-sm focus:ring-1 focus:ring-moodle-blue outline-none">
              <option>Custom sections</option>
              <option>Weekly format</option>
              <option>Topics format</option>
            </select>
          </FormField>
        </FormSection>

        <FormSection title="Appearance" isOpen={false}>
          <p className="text-sm text-slate-500 italic">No appearance settings available yet.</p>
        </FormSection>

        <div className="p-6 bg-slate-50 flex items-center space-x-4">
          <button 
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 bg-moodle-blue text-white rounded font-bold hover:bg-blue-700 transition-all disabled:opacity-70 flex items-center space-x-2 shadow-sm"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            <span>{loading ? 'Saving...' : 'Save and return'}</span>
          </button>
          <button 
            type="button"
            disabled={loading}
            className="px-6 py-2.5 bg-slate-800 text-white rounded font-bold hover:bg-slate-700 transition-all disabled:opacity-70 flex items-center space-x-2 shadow-sm"
          >
            <span>Save and display</span>
          </button>
          <button 
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-6 py-2.5 bg-slate-200 text-slate-800 rounded font-bold hover:bg-slate-300 transition-all disabled:opacity-70"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default FacultyCourseEditor;
