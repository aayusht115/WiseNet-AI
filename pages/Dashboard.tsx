import React, { useEffect, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { Course, CourseSession } from "../types";

interface DashboardProps {
  onOpenCourse?: (courseId: number) => void;
  onOpenPreRead?: (materialId: number) => void;
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

function formatSessionDate(value: string) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return raw;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString();
}

const Dashboard: React.FC<DashboardProps> = ({ onOpenCourse, onOpenPreRead }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [availableCourses, setAvailableCourses] = useState<Course[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTodos, setLoadingTodos] = useState(false);
  const [error, setError] = useState<string>("");
  const [enrollingCourseId, setEnrollingCourseId] = useState<number | null>(null);
  const [completingPreReadId, setCompletingPreReadId] = useState<number | null>(null);
  const [completedPreReadIds, setCompletedPreReadIds] = useState<number[]>([]);

  const getNowOverrideHeaders = () => {
    const override = localStorage.getItem("wisenet_time_override");
    if (!override) return {};
    return { "x-now-override": override };
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

      if (catalogRes.ok) {
        const catalog = (await catalogRes.json()) as Course[];
        setAvailableCourses(catalog.filter((course) => !course.is_enrolled));
      } else {
        setAvailableCourses([]);
      }
      await fetchTodos();
    } catch (fetchError) {
      console.error("Failed to fetch courses", fetchError);
      setError("Something went wrong loading your dashboard. Please try again.");
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
    };
    window.addEventListener("wisenet-time-override-updated", onTimeOverrideUpdated);
    return () => window.removeEventListener("wisenet-time-override-updated", onTimeOverrideUpdated);
  }, []);

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
    if (item.task_type === "pre_read") {
      onOpenPreRead?.(item.item_id);
      return;
    }
    if (item.task_type === "feedback") {
      onOpenCourse?.(item.course_id);
      return;
    }
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
                              {formatSessionDate(session.session_date)}
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
                              {formatSessionDate(session.session_date)}
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

    </div>
  );
};

export default Dashboard;
