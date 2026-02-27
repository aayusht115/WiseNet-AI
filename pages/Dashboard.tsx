import React, { useEffect, useState } from "react";
import { BookOpen, Loader2, MessageSquareText } from "lucide-react";
import { ActiveFeedbackForm, Course, CourseSession } from "../types";

interface DashboardProps {
  onOpenCourse?: (courseId: number) => void;
}

type TodoItem = {
  task_type: "pre_read" | "feedback";
  item_id: number;
  item_title: string;
  course_id: number;
  course_name: string;
  course_code: string;
  section_title: string;
  due_at: string;
};

const Dashboard: React.FC<DashboardProps> = ({ onOpenCourse }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [availableCourses, setAvailableCourses] = useState<Course[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTodos, setLoadingTodos] = useState(false);
  const [error, setError] = useState<string>("");
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [feedbackForm, setFeedbackForm] = useState<ActiveFeedbackForm | null>(null);
  const [feedbackAnswers, setFeedbackAnswers] = useState<Record<number, string>>({});
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [enrollingCourseId, setEnrollingCourseId] = useState<number | null>(null);
  const [completingPreReadId, setCompletingPreReadId] = useState<number | null>(null);
  const [completedPreReadIds, setCompletedPreReadIds] = useState<number[]>([]);

  const getNowOverrideHeaders = () => {
    const override = localStorage.getItem("wisenet_time_override");
    if (!override) return {};
    return { "x-now-override": override };
  };

  const fetchCourseScopedData = async (courseId: number) => {
    try {
      const feedbackRes = await fetch(`/api/courses/${courseId}/feedback/active`, {
        headers: getNowOverrideHeaders(),
      });
      if (!feedbackRes.ok) {
        setError("Could not fetch feedback data for this course.");
        return;
      }
      setFeedbackForm(await feedbackRes.json());
    } catch (error) {
      console.error("Failed to fetch course scoped dashboard data", error);
      setError("Could not fetch feedback data for this course.");
    }
  };

  const fetchTodos = async () => {
    setLoadingTodos(true);
    try {
      const response = await fetch("/api/dashboard/todos", { headers: getNowOverrideHeaders() });
      if (!response.ok) return;
      const payload = (await response.json()) as TodoItem[];
      setTodos(Array.isArray(payload) ? payload : []);
    } catch {
      setTodos([]);
    } finally {
      setLoadingTodos(false);
    }
  };

  const fetchDashboardData = async () => {
    setLoading(true);
    setError("");
    try {
      const [overviewRes, catalogRes] = await Promise.all([
        fetch("/api/courses/overview"),
        fetch("/api/courses/catalog"),
      ]);
      if (!overviewRes.ok) {
        setError("Could not load your enrolled courses.");
        return;
      }

      const enrolledCourses = (await overviewRes.json()) as Course[];
      setCourses(enrolledCourses);
      if (enrolledCourses[0]?.id) {
        setSelectedCourseId(enrolledCourses[0].id);
        await fetchCourseScopedData(enrolledCourses[0].id);
      } else {
        setSelectedCourseId(null);
        setFeedbackForm(null);
      }

      if (catalogRes.ok) {
        const catalog = (await catalogRes.json()) as Course[];
        setAvailableCourses(catalog.filter((course) => !course.is_enrolled));
      } else {
        setAvailableCourses([]);
      }
      await fetchTodos();
    } catch (fetchError) {
      console.error("Failed to fetch courses", fetchError);
      setError("Could not load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  useEffect(() => {
    const onTimeOverrideUpdated = () => {
      fetchDashboardData();
      if (selectedCourseId) {
        fetchCourseScopedData(selectedCourseId);
      }
    };
    window.addEventListener("wisenet-time-override-updated", onTimeOverrideUpdated);
    return () => window.removeEventListener("wisenet-time-override-updated", onTimeOverrideUpdated);
  }, [selectedCourseId]);

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

  const submitFeedback = async () => {
    if (!feedbackForm || !selectedCourseId) return;
    const answers = feedbackForm.questions
      .map((q) => {
        const value = feedbackAnswers[q.id];
        if (!value || !value.trim()) return null;
        if (q.question_type === "mcq") {
          return { question_id: q.id, choice_value: Number(value), answer_text: "" };
        }
        return { question_id: q.id, choice_value: null, answer_text: value.trim() };
      })
      .filter(Boolean);

    if (answers.length === 0) return;

    setSubmittingFeedback(true);
    setError("");
    try {
      const response = await fetch(`/api/courses/${selectedCourseId}/feedback/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getNowOverrideHeaders() },
        body: JSON.stringify({ form_id: feedbackForm.form_id, answers }),
      });
      if (response.ok) {
        await fetchCourseScopedData(selectedCourseId);
        await fetchTodos();
        setFeedbackAnswers({});
      } else {
        const payload = await response.json().catch(() => ({ error: "Failed to submit feedback." }));
        setError(payload.error || "Failed to submit feedback.");
      }
    } catch {
      setError("Failed to submit feedback.");
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const enrollInCourse = async (courseId: number) => {
    setEnrollingCourseId(courseId);
    setError("");
    try {
      const response = await fetch(`/api/courses/${courseId}/enroll-self`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Could not enroll in this course." }));
        setError(payload.error || "Could not enroll in this course.");
        return;
      }
      await fetchDashboardData();
    } catch {
      setError("Could not enroll in this course.");
    } finally {
      setEnrollingCourseId(null);
    }
  };

  const openTodoItem = async (item: TodoItem) => {
    if (item.task_type === "pre_read" || item.task_type === "feedback") {
      onOpenCourse?.(item.course_id);
      return;
    }
    setSelectedCourseId(item.course_id);
    await fetchCourseScopedData(item.course_id);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  };

  const markPreReadCompleted = async (materialId: number) => {
    setCompletingPreReadId(materialId);
    setError("");
    try {
      const response = await fetch(`/api/materials/${materialId}/progress/read`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Could not update pre-read status." }));
        setError(payload.error || "Could not update pre-read status.");
        return;
      }
      setCompletedPreReadIds((prev) => [...new Set([...prev, materialId])]);
      window.setTimeout(async () => {
        await fetchTodos();
        setCompletedPreReadIds((prev) => prev.filter((id) => id !== materialId));
      }, 900);
    } catch {
      setError("Could not update pre-read status.");
    } finally {
      setCompletingPreReadId(null);
    }
  };

  if (loading) {
    return (
      <div className="h-60 flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-moodle-blue" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">My Courses</h2>
        <p className="text-sm text-slate-500 mt-1">
          Open a course card to explore session-wise learning materials, summaries and quizzes.
        </p>
      </div>

      {error ? (
        <div className="moodle-card p-4 border border-rose-200 bg-rose-50 text-sm text-rose-700 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            onClick={fetchDashboardData}
            className="px-3 py-1.5 rounded border border-rose-300 text-xs font-bold hover:bg-rose-100"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="moodle-card p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-lg font-bold text-slate-800">To-do</h3>
          {loadingTodos ? <Loader2 size={16} className="animate-spin text-moodle-blue" /> : null}
        </div>
        {todos.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No pending tasks right now.</p>
        ) : (
          <div className="space-y-2">
            {todos.slice(0, 8).map((item) => {
              const isCompleted = completedPreReadIds.includes(item.item_id) && item.task_type === "pre_read";
              return (
              <div
                key={`${item.task_type}-${item.item_id}`}
                className={`border rounded p-3 cursor-pointer transition-colors ${
                  isCompleted ? "border-emerald-200 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"
                }`}
                onClick={() => openTodoItem(item)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{item.item_title}</p>
                  <span
                    className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-wide ${
                      isCompleted
                        ? "bg-emerald-100 text-emerald-700"
                        : item.task_type === "feedback"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {isCompleted ? "Completed" : item.task_type === "feedback" ? "Feedback" : "Pre-read"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {item.course_code} • {item.course_name} • {item.section_title}
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  {isCompleted
                    ? "Completed. This item will disappear from to-do."
                    : `Due by: ${new Date(item.due_at).toLocaleString()}`}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      openTodoItem(item);
                    }}
                    className="px-2.5 py-1.5 border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-white"
                  >
                    {item.task_type === "feedback" ? "Open feedback" : "Open pre-read"}
                  </button>
                  {item.task_type === "pre_read" ? (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        markPreReadCompleted(item.item_id);
                      }}
                      disabled={isCompleted || completingPreReadId === item.item_id}
                      className="px-2.5 py-1.5 bg-slate-900 text-white rounded text-xs font-bold disabled:opacity-70"
                    >
                      {isCompleted
                        ? "Completed"
                        : completingPreReadId === item.item_id
                          ? "Saving..."
                          : "Mark completed"}
                    </button>
                  ) : null}
                </div>
              </div>
            )})}
          </div>
        )}
      </div>

      {courses.length === 0 ? (
        <div className="moodle-card p-10 text-center">
          <BookOpen size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">No courses available yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courses.map((course) => (
            <button
              key={course.id}
              onClick={() => onOpenCourse?.(course.id)}
              className="moodle-card text-left overflow-hidden hover:shadow-lg transition-all duration-300 group"
            >
              <div className="h-36 bg-slate-100 relative">
                {course.image_url ? (
                  <img src={course.image_url} alt={course.name} className="w-full h-full object-cover" />
                ) : (
                  <img
                    src={`https://picsum.photos/seed/course-${course.id}/600/300`}
                    alt={course.name}
                    className="w-full h-full object-cover opacity-85 group-hover:opacity-100 transition-opacity"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
              <div className="p-5">
                <p className="text-[10px] font-bold text-moodle-blue uppercase tracking-widest mb-1">
                  {course.code}
                </p>
                <h3 className="text-lg font-bold text-slate-800 group-hover:text-moodle-blue transition-colors">
                  {course.name}
                </h3>
                <p className="text-sm text-slate-500 mt-1 line-clamp-2">{course.instructor}</p>

                <div className="mt-4">
                  <div className="text-xs text-slate-500 mb-1">{course.progress ?? 0}% complete</div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-moodle-blue rounded-full"
                      style={{ width: `${course.progress ?? 0}%` }}
                    />
                  </div>
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

      {availableCourses.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-xl font-bold text-slate-800">Available Courses</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableCourses.map((course) => (
              <div key={course.id} className="moodle-card p-5">
                <p className="text-[10px] font-bold text-moodle-blue uppercase tracking-widest mb-1">
                  {course.code}
                </p>
                <h4 className="text-lg font-bold text-slate-800">{course.name}</h4>
                <p className="text-sm text-slate-500 mt-1">{course.instructor}</p>
                <div className="mt-3 border-t border-slate-100 pt-3">
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
                <button
                  onClick={() => enrollInCourse(course.id)}
                  disabled={enrollingCourseId === course.id}
                  className="mt-4 px-3 py-2 bg-slate-900 text-white rounded text-xs font-bold hover:bg-black disabled:opacity-70"
                >
                  {enrollingCourseId === course.id ? "Enrolling..." : "Enroll in Course"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {feedbackForm && !feedbackForm.already_submitted && (
        <div className="moodle-card p-6 border border-amber-200 bg-amber-50/40">
          <div className="flex items-start gap-3 mb-4">
            <MessageSquareText className="text-amber-600 mt-0.5" size={20} />
            <div>
              <h3 className="text-lg font-bold text-slate-800">Anonymous Mid-Course Feedback</h3>
              <p className="text-sm text-slate-600">
                Please submit this feedback within 2 days. Faculty will only see aggregated insights.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {feedbackForm.questions.map((question) => (
              <div key={question.id} className="bg-white border border-slate-200 rounded p-4">
                <p className="text-sm font-semibold text-slate-800 mb-2">{question.question_order}. {question.question_text}</p>
                {question.question_type === "mcq" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {(question.options || []).map((option, idx) => (
                      <label key={idx} className="text-sm flex items-center gap-2 text-slate-700">
                        <input
                          type="radio"
                          name={`q-${question.id}`}
                          checked={feedbackAnswers[question.id] === String(idx + 1)}
                          onChange={() =>
                            setFeedbackAnswers((prev) => ({ ...prev, [question.id]: String(idx + 1) }))
                          }
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                ) : (
                  <textarea
                    rows={3}
                    className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                    placeholder="Share your feedback"
                    value={feedbackAnswers[question.id] || ""}
                    onChange={(e) =>
                      setFeedbackAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))
                    }
                  />
                )}
              </div>
            ))}

            <button
              onClick={submitFeedback}
              disabled={submittingFeedback}
              className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-black disabled:opacity-70"
            >
              {submittingFeedback ? "Submitting..." : "Submit Anonymous Feedback"}
            </button>
          </div>
        </div>
      )}

      {feedbackForm && feedbackForm.already_submitted ? (
        <div className="moodle-card p-4 text-sm text-emerald-700 border border-emerald-200 bg-emerald-50">
          Feedback submitted. Thank you.
        </div>
      ) : null}
    </div>
  );
};

export default Dashboard;
