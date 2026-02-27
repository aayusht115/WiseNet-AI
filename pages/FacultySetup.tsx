
import React, { useState, useEffect } from 'react';
import { Plus, MoreHorizontal, ChevronDown, Loader2, MessageSquareText } from 'lucide-react';
import { Course, CourseSession } from '../types';

interface FacultySetupProps {
  onAddCourse: () => void;
  onSelectCourse: (courseId: number) => void;
}

type FeedbackInsightMetric = {
  question_id: number;
  question_order: number;
  question_text: string;
  question_type: "mcq" | "text";
  responses: number;
  average?: number;
  distribution?: Array<{
    option_index: number;
    option_text: string;
    count: number;
    percentage: number;
  }>;
  highlights?: string[];
};

type FacultyFeedbackInsight = {
  id: number;
  form_id: number;
  course_id: number;
  course_name: string;
  course_code: string;
  trigger_session_number: number;
  open_at: string;
  due_at: string;
  submissions_count: number;
  summary_text: string;
  metrics: FeedbackInsightMetric[];
  text_comments: string[];
  generated_at: string;
};

const FacultySetup: React.FC<FacultySetupProps> = ({ onAddCourse, onSelectCourse }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectingId, setSelectingId] = useState<number | null>(null);
  const [feedbackInsights, setFeedbackInsights] = useState<FacultyFeedbackInsight[]>([]);
  const [showFeedbackPopup, setShowFeedbackPopup] = useState(false);
  const [activeInsightIndex, setActiveInsightIndex] = useState(0);
  const [insightError, setInsightError] = useState("");
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [markingInsightId, setMarkingInsightId] = useState<number | null>(null);

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

  const fetchPendingFeedbackInsights = async () => {
    setLoadingInsights(true);
    setInsightError("");
    try {
      const nowOverride = localStorage.getItem("wisenet_time_override");
      const response = await fetch('/api/faculty/feedback-insights/pending', {
        headers: nowOverride ? { "x-now-override": nowOverride } : {},
      });
      if (!response.ok) {
        setInsightError("Could not load feedback summary.");
        setFeedbackInsights([]);
        setShowFeedbackPopup(false);
        return;
      }
      const payload = await response.json();
      const list = Array.isArray(payload) ? (payload as FacultyFeedbackInsight[]) : [];
      setFeedbackInsights(list);
      setActiveInsightIndex(0);
      setShowFeedbackPopup(list.length > 0);
    } catch (err) {
      console.error("Failed to fetch feedback insights", err);
      setInsightError("Could not load feedback summary.");
      setFeedbackInsights([]);
      setShowFeedbackPopup(false);
    } finally {
      setLoadingInsights(false);
    }
  };

  useEffect(() => {
    fetchCourses();
    fetchPendingFeedbackInsights();
  }, []);

  useEffect(() => {
    const onTimeOverrideUpdated = () => {
      fetchPendingFeedbackInsights();
    };
    window.addEventListener("wisenet-time-override-updated", onTimeOverrideUpdated);
    return () => window.removeEventListener("wisenet-time-override-updated", onTimeOverrideUpdated);
  }, []);

  const handleSelect = (id: number) => {
    setSelectingId(id);
    onSelectCourse(id);
  };

  const getSessionPreview = (course: Course): CourseSession[] => {
    const raw = (course as any).session_preview;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as CourseSession[];
    try {
      const parsed = JSON.parse(String(raw));
      return Array.isArray(parsed) ? (parsed as CourseSession[]) : [];
    } catch {
      return [];
    }
  };

  const activeInsight = showFeedbackPopup ? feedbackInsights[activeInsightIndex] || null : null;

  const markInsightReviewed = async () => {
    if (!activeInsight) return;
    setMarkingInsightId(activeInsight.id);
    setInsightError("");
    try {
      const response = await fetch(`/api/faculty/feedback-insights/${activeInsight.id}/viewed`, {
        method: "POST",
      });
      if (!response.ok) {
        setInsightError("Could not mark feedback summary as reviewed.");
        return;
      }
      setFeedbackInsights((prev) => {
        const remaining = prev.filter((item) => item.id !== activeInsight.id);
        if (remaining.length === 0) {
          setShowFeedbackPopup(false);
          setActiveInsightIndex(0);
          return [];
        }
        setActiveInsightIndex((idx) => Math.min(idx, remaining.length - 1));
        return remaining;
      });
    } catch (err) {
      console.error("Failed to mark insight reviewed", err);
      setInsightError("Could not mark feedback summary as reviewed.");
    } finally {
      setMarkingInsightId(null);
    }
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
          {loadingInsights ? (
            <div className="moodle-card p-3 text-sm text-slate-600 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-moodle-blue" />
              Checking for recently closed feedback cycles...
            </div>
          ) : null}

          {!loadingInsights && feedbackInsights.length > 0 ? (
            <div className="moodle-card p-4 border border-amber-200 bg-amber-50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-amber-800">
                <MessageSquareText size={16} />
                <span>
                  {feedbackInsights.length} feedback summary
                  {feedbackInsights.length === 1 ? "" : "ies"} ready for review.
                </span>
              </div>
              <button
                onClick={() => setShowFeedbackPopup(true)}
                className="px-3 py-1.5 rounded bg-slate-900 text-white text-xs font-bold hover:bg-black"
              >
                View Summary
              </button>
            </div>
          ) : null}

          {insightError && !showFeedbackPopup ? (
            <div className="moodle-card p-3 border border-rose-200 bg-rose-50 text-sm text-rose-700 flex items-center justify-between gap-3">
              <span>{insightError}</span>
              <button
                onClick={fetchPendingFeedbackInsights}
                className="px-3 py-1.5 rounded border border-rose-300 text-xs font-bold hover:bg-rose-100"
              >
                Retry
              </button>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-2xl font-bold text-slate-800">My courses</h2>
            <button
              onClick={onAddCourse}
              className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-black"
            >
              + Add Course
            </button>
          </div>
          
          <p className="text-sm text-slate-500">
            Only courses initiated by your faculty account are shown here.
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

                    <div className="mt-4 border-t border-slate-100 pt-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Course Calendar</p>
                      {getSessionPreview(course).length === 0 ? (
                        <p className="text-xs text-slate-500">No sessions scheduled yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {getSessionPreview(course)
                            .slice(0, 3)
                            .map((session) => (
                              <div key={session.id} className="text-xs text-slate-700 flex items-center justify-between">
                                <span className="font-semibold">S{session.session_number}</span>
                                <span className="truncate ml-2">{session.title}</span>
                                <span className="text-slate-500 ml-2">
                                  {new Date(session.session_date).toLocaleDateString()}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showFeedbackPopup && activeInsight ? (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-white rounded-lg shadow-xl border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-amber-600">
                  Anonymous Feedback Summary
                </p>
                <h3 className="text-xl font-bold text-slate-800 mt-1">
                  {activeInsight.course_name} ({activeInsight.course_code})
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Trigger: Session {activeInsight.trigger_session_number} | Due:{" "}
                  {new Date(activeInsight.due_at).toLocaleString()} | Responses:{" "}
                  {activeInsight.submissions_count}
                </p>
              </div>
              <button
                onClick={() => setShowFeedbackPopup(false)}
                className="px-3 py-1.5 rounded border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Remind me later
              </button>
            </div>

            <div className="p-6 space-y-6">
              {insightError ? (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {insightError}
                </div>
              ) : null}

              <div className="rounded border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-800 mb-2">Overall Summary</p>
                <p className="text-sm text-slate-700 leading-relaxed">{activeInsight.summary_text}</p>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-800">Question-wise Snapshot</h4>
                {(activeInsight.metrics || []).map((metric) => (
                  <div key={metric.question_id} className="rounded border border-slate-200 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-800">
                        Q{metric.question_order}. {metric.question_text}
                      </p>
                      <span className="text-xs font-bold text-slate-500 uppercase">
                        {metric.question_type === "mcq" ? "MCQ" : "Text"}
                      </span>
                    </div>

                    {metric.question_type === "mcq" ? (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-600">
                          Average score: <span className="font-bold">{Number(metric.average || 0).toFixed(2)}/5</span> | Responses:{" "}
                          <span className="font-bold">{metric.responses || 0}</span>
                        </p>
                        <div className="space-y-1.5">
                          {(metric.distribution || []).map((entry) => (
                            <div key={entry.option_index} className="flex items-center gap-2 text-xs">
                              <span className="w-24 shrink-0 text-slate-600 truncate">{entry.option_text}</span>
                              <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
                                <div
                                  className="h-full bg-moodle-blue"
                                  style={{ width: `${Math.max(0, Math.min(100, entry.percentage || 0))}%` }}
                                />
                              </div>
                              <span className="w-16 text-right text-slate-600">
                                {entry.count} ({entry.percentage}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-600">
                          Written responses: <span className="font-bold">{metric.responses || 0}</span>
                        </p>
                        {(metric.highlights || []).length > 0 ? (
                          <ul className="space-y-1">
                            {(metric.highlights || []).slice(0, 3).map((comment, idx) => (
                              <li key={idx} className="text-xs text-slate-700 bg-slate-50 border border-slate-100 rounded px-2 py-1.5">
                                "{comment}"
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs italic text-slate-500">No written comments for this question.</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <p className="text-xs text-slate-500">
                  Responses shown here are anonymous. No student identity is displayed.
                </p>
                <div className="flex items-center gap-2">
                  {feedbackInsights.length > 1 ? (
                    <button
                      onClick={() => setActiveInsightIndex((idx) => (idx + 1) % feedbackInsights.length)}
                      className="px-3 py-1.5 rounded border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Next Summary
                    </button>
                  ) : null}
                  <button
                    onClick={markInsightReviewed}
                    disabled={markingInsightId === activeInsight.id}
                    className="px-4 py-2 rounded bg-slate-900 text-white text-xs font-bold hover:bg-black disabled:opacity-70"
                  >
                    {markingInsightId === activeInsight.id ? "Saving..." : "Mark Reviewed"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default FacultySetup;
