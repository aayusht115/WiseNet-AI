import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Loader2, MessageSquareText } from "lucide-react";
import { ActiveFeedbackForm, Course, CourseSession } from "../types";
import ScheduleBoard from "../components/ScheduleBoard";

interface DashboardProps {
  onOpenCourse?: (courseId: number) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onOpenCourse }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [availableCourses, setAvailableCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [feedbackForm, setFeedbackForm] = useState<ActiveFeedbackForm | null>(null);
  const [feedbackAnswers, setFeedbackAnswers] = useState<Record<number, string>>({});
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [enrollingCourseId, setEnrollingCourseId] = useState<number | null>(null);

  const fetchCourseScopedData = async (courseId: number) => {
    try {
      const [sessionsRes, feedbackRes] = await Promise.all([
        fetch(`/api/courses/${courseId}/sessions`),
        fetch(`/api/courses/${courseId}/feedback/active`),
      ]);
      if (!sessionsRes.ok || !feedbackRes.ok) {
        setError("Could not fetch session/feedback data for this course.");
        return;
      }
      setSessions(await sessionsRes.json());
      setFeedbackForm(await feedbackRes.json());
    } catch (error) {
      console.error("Failed to fetch course scoped dashboard data", error);
      setError("Could not fetch session/feedback data for this course.");
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
        setSessions([]);
        setFeedbackForm(null);
      }

      if (catalogRes.ok) {
        const catalog = (await catalogRes.json()) as Course[];
        setAvailableCourses(catalog.filter((course) => !course.is_enrolled));
      } else {
        setAvailableCourses([]);
      }
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

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) || null,
    [courses, selectedCourseId]
  );

  const onSelectCourse = async (courseId: number) => {
    setSelectedCourseId(courseId);
    await fetchCourseScopedData(courseId);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form_id: feedbackForm.form_id, answers }),
      });
      if (response.ok) {
        await fetchCourseScopedData(selectedCourseId);
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

      {courses.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-xl font-bold text-slate-800">Timetable and Calendar</h3>
            <select
              className="border border-slate-300 rounded px-3 py-2 text-sm"
              value={selectedCourseId || ""}
              onChange={(e) => onSelectCourse(Number(e.target.value))}
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </div>
          <ScheduleBoard sessions={sessions} title={selectedCourse?.name || "Course"} />
        </div>
      )}

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
