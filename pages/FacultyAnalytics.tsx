import React, { useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquareText, BarChart3 } from "lucide-react";
import { Course } from "../types";

type FeedbackMetric = {
  question_id: number;
  question_text: string;
  question_type: "mcq" | "text";
  average?: number;
  responses?: number;
  comments?: string[];
};

type FeedbackFormAnalytics = {
  form_id: number;
  trigger_session_number: number;
  open_at: string;
  due_at: string;
  submissions: number;
  summary_text?: string;
  metrics: FeedbackMetric[];
};

type FeedbackAnalyticsResponse = {
  forms: FeedbackFormAnalytics[];
  overall?: {
    submissions: number;
    summary_text: string;
    mcq_metrics: Array<{
      question_text: string;
      average: number;
      responses: number;
    }>;
    comments_count: number;
  };
};

type QuizAnalytics = {
  attempts: number;
  average_score: number;
  average_percentage: number;
  highest_score: number;
  highest_percentage: number;
  top_performer: {
    student_id: number;
    name: string;
    email: string;
    average_percentage: number;
  } | null;
};

const FacultyAnalytics: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");

  const [quizAnalytics, setQuizAnalytics] = useState<QuizAnalytics | null>(null);
  const [feedbackAnalytics, setFeedbackAnalytics] = useState<FeedbackAnalyticsResponse>({ forms: [] });

  const selectedCourse = useMemo(
    () => courses.find((course) => Number(course.id) === Number(selectedCourseId)) || null,
    [courses, selectedCourseId]
  );

  const latestFeedback = useMemo(
    () => {
      const sorted = (feedbackAnalytics.forms || [])
        .slice()
        .sort((a, b) => Number(b.form_id) - Number(a.form_id));
      return sorted.find((form) => Number(form.submissions || 0) > 0) || sorted[0] || null;
    },
    [feedbackAnalytics.forms]
  );

  const fetchCourses = async () => {
    setLoadingCourses(true);
    setError("");
    try {
      const response = await fetch("/api/courses");
      if (!response.ok) {
        setError("Could not load your courses.");
        setCourses([]);
        setSelectedCourseId(null);
        return;
      }
      const payload = (await response.json()) as Course[];
      const list = Array.isArray(payload) ? payload : [];
      setCourses(list);
      setSelectedCourseId((prev) => prev ?? (list[0]?.id ? Number(list[0].id) : null));
    } catch {
      setError("Could not load your courses.");
      setCourses([]);
      setSelectedCourseId(null);
    } finally {
      setLoadingCourses(false);
    }
  };

  const fetchCourseAnalytics = async (courseId: number) => {
    setLoadingData(true);
    setError("");
    try {
      const [quizRes, feedbackRes] = await Promise.all([
        fetch(`/api/courses/${courseId}/quiz-analytics`),
        fetch(`/api/courses/${courseId}/feedback/analytics`),
      ]);

      if (!quizRes.ok || !feedbackRes.ok) {
        setError("Could not load course analytics.");
        return;
      }

      setQuizAnalytics((await quizRes.json()) as QuizAnalytics);
      setFeedbackAnalytics((await feedbackRes.json()) as FeedbackAnalyticsResponse);
    } catch {
      setError("Could not load course analytics.");
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  useEffect(() => {
    if (!selectedCourseId) {
      setQuizAnalytics(null);
      setFeedbackAnalytics({ forms: [] });
      return;
    }
    fetchCourseAnalytics(selectedCourseId);
  }, [selectedCourseId]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="moodle-card p-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Class Analytics</h2>
          <p className="text-sm text-slate-500 mt-1">
            Subject-wise analytics for courses created by this faculty.
          </p>
        </div>

        <div className="min-w-[280px]">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Select Subject</label>
          <select
            className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
            value={selectedCourseId || ""}
            onChange={(event) => setSelectedCourseId(Number(event.target.value) || null)}
            disabled={loadingCourses || courses.length === 0}
          >
            {loadingCourses ? <option>Loading...</option> : null}
            {!loadingCourses && courses.length === 0 ? <option value="">No courses found</option> : null}
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name} ({course.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="moodle-card p-4 border border-rose-200 bg-rose-50 text-sm text-rose-700">{error}</div>
      ) : null}

      {loadingData ? (
        <div className="moodle-card p-8 flex items-center justify-center gap-2 text-slate-600">
          <Loader2 size={18} className="animate-spin text-moodle-blue" />
          Loading analytics...
        </div>
      ) : null}

      {!loadingData && selectedCourse ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="moodle-card p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Subject</p>
              <p className="text-sm font-bold text-slate-800 mt-2">
                {selectedCourse.name} ({selectedCourse.code})
              </p>
            </div>
            <div className="moodle-card p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Quiz Attempts</p>
              <p className="text-2xl font-black text-slate-800 mt-1">{quizAnalytics?.attempts || 0}</p>
            </div>
            <div className="moodle-card p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Avg Quiz %</p>
              <p className="text-2xl font-black text-moodle-blue mt-1">
                {quizAnalytics?.average_percentage || 0}%
              </p>
            </div>
            <div className="moodle-card p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Highest Quiz %</p>
              <p className="text-2xl font-black text-emerald-600 mt-1">
                {quizAnalytics?.highest_percentage || 0}%
              </p>
            </div>
          </div>

          <div className="moodle-card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <MessageSquareText size={18} className="text-moodle-blue" />
              <h3 className="text-xl font-bold text-slate-800">Anonymous Feedback Insights</h3>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                Overall Course Summary (All Feedback Cycles)
              </p>
              <p className="text-xs text-slate-500 mb-2">
                Total responses: {Number(feedbackAnalytics.overall?.submissions || 0)} • Written comments:{" "}
                {Number(feedbackAnalytics.overall?.comments_count || 0)}
              </p>
              <p className="text-sm text-slate-700">
                {feedbackAnalytics.overall?.summary_text || "No feedback analytics available yet for this subject."}
              </p>
            </div>

            {!latestFeedback ? (
              <p className="text-sm text-slate-500 italic">No feedback analytics available yet for this subject.</p>
            ) : (
              <>
                <p className="text-xs text-slate-500">
                  Responses: {latestFeedback.submissions} | Triggered at Session {latestFeedback.trigger_session_number} | Due:{" "}
                  {new Date(latestFeedback.due_at).toLocaleDateString()}
                </p>

                {latestFeedback.summary_text ? (
                  <div className="rounded border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Overall Summary</p>
                    <p className="text-sm text-slate-700">{latestFeedback.summary_text}</p>
                  </div>
                ) : null}

                <div className="space-y-3">
                  {latestFeedback.metrics.map((metric) => (
                    <div key={metric.question_id} className="rounded border border-slate-200 p-3">
                      <p className="text-sm font-bold text-slate-800">{metric.question_text}</p>
                      {metric.question_type === "mcq" ? (
                        <p className="text-sm text-slate-600 mt-1">
                          Average rating: {Number(metric.average || 0).toFixed(2)}/5 • Responses: {metric.responses || 0}
                        </p>
                      ) : (
                        <div className="mt-2 space-y-1">
                          <p className="text-sm text-slate-600">Anonymous comments:</p>
                          {(metric.comments || []).length === 0 ? (
                            <p className="text-xs text-slate-500 italic">No comments yet.</p>
                          ) : (
                            (metric.comments || []).slice(0, 4).map((comment, idx) => (
                              <p key={idx} className="text-xs text-slate-700 bg-slate-50 border border-slate-100 rounded px-2 py-1.5">
                                "{comment}"
                              </p>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="moodle-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={18} className="text-slate-500" />
              <h3 className="text-lg font-bold text-slate-800">Quiz Performance Snapshot</h3>
            </div>
            {quizAnalytics?.attempts ? (
              <p className="text-sm text-slate-600">
                Attempts: <span className="font-bold">{quizAnalytics.attempts}</span> • Highest score:{" "}
                <span className="font-bold">{quizAnalytics.highest_score}</span> • Average score:{" "}
                <span className="font-bold">{quizAnalytics.average_score}</span>
              </p>
            ) : (
              <p className="text-sm text-slate-500 italic">No quiz attempts submitted yet for this subject.</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};

export default FacultyAnalytics;
