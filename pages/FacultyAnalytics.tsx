import React, { useEffect, useState } from "react";
import { Loader2, Trophy, Users, BarChart3, MessageSquareText } from "lucide-react";
import { Course } from "../types";

const FacultyAnalytics: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [quizReports, setQuizReports] = useState<any[]>([]);
  const [quizAnalytics, setQuizAnalytics] = useState<any | null>(null);
  const [preReadAnalytics, setPreReadAnalytics] = useState<any | null>(null);
  const [feedbackAnalytics, setFeedbackAnalytics] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchCourseAnalytics = async (courseId: number) => {
    const [reportsRes, quizAnalyticsRes, feedbackRes, preReadRes] = await Promise.all([
      fetch(`/api/courses/${courseId}/quiz-reports`),
      fetch(`/api/courses/${courseId}/quiz-analytics`),
      fetch(`/api/courses/${courseId}/feedback/analytics`),
      fetch(`/api/courses/${courseId}/pre-read-analytics`),
    ]);

    if (!reportsRes.ok || !quizAnalyticsRes.ok || !feedbackRes.ok || !preReadRes.ok) {
      throw new Error("Failed to load analytics.");
    }

    setQuizReports(await reportsRes.json());
    setQuizAnalytics(await quizAnalyticsRes.json());
    setFeedbackAnalytics(await feedbackRes.json());
    setPreReadAnalytics(await preReadRes.json());
  };

  useEffect(() => {
    const fetchData = async () => {
      setError("");
      try {
        const coursesRes = await fetch("/api/courses");
        if (!coursesRes.ok) {
          setError("Could not load your courses.");
          return;
        }
        const data = (await coursesRes.json()) as Course[];
        setCourses(data);
        if (data[0]?.id) {
          setSelectedCourseId(data[0].id);
          await fetchCourseAnalytics(data[0].id);
        }
      } catch (err) {
        console.error("Failed to fetch faculty analytics data", err);
        setError("Could not load analytics data.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const onSelectCourse = async (courseId: number) => {
    setSelectedCourseId(courseId);
    setLoading(true);
    setError("");
    try {
      await fetchCourseAnalytics(courseId);
    } catch {
      setError("Could not load analytics for this course.");
    } finally {
      setLoading(false);
    }
  };

  const latestFeedbackForm = feedbackAnalytics?.forms?.[0];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Faculty Analytics and Class Health</h2>
          <p className="text-slate-500 text-sm mt-1">
            Track quiz performance, pre-read completion, and anonymous feedback insights.
          </p>
        </div>
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

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 size={30} className="animate-spin text-moodle-blue" />
        </div>
      ) : error ? (
        <div className="moodle-card p-5 border border-rose-200 bg-rose-50 text-sm text-rose-700">
          {error}
        </div>
      ) : courses.length === 0 ? (
        <div className="moodle-card p-6 text-center text-sm text-slate-600">
          No courses found for your faculty account. Create one from My Courses first.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="moodle-card p-5">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Quiz Attempts</div>
              <div className="text-3xl font-black text-slate-800 mt-2">{quizAnalytics?.attempts || 0}</div>
            </div>
            <div className="moodle-card p-5">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Average Score %</div>
              <div className="text-3xl font-black text-moodle-blue mt-2">{quizAnalytics?.average_percentage || 0}%</div>
            </div>
            <div className="moodle-card p-5">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Highest Score %</div>
              <div className="text-3xl font-black text-emerald-600 mt-2">{quizAnalytics?.highest_percentage || 0}%</div>
            </div>
            <div className="moodle-card p-5">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Top Performer</div>
              <div className="text-sm font-bold text-slate-800 mt-2">{quizAnalytics?.top_performer?.name || "--"}</div>
              <div className="text-xs text-slate-500">{quizAnalytics?.top_performer?.average_percentage || 0}% avg</div>
            </div>
          </div>

          <div className="moodle-card p-4 text-sm text-slate-600">
            Session calendar and timetable are now shown inside each course card in <span className="font-bold">My Courses</span>.
            Edit session dates from that course page.
          </div>

          <div className="moodle-card p-6 overflow-x-auto">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Pre-read Completion Tracking</h3>
            <div className="text-xs text-slate-500 mb-3">
              Students opened: {preReadAnalytics?.summary?.opened_any || 0}/{preReadAnalytics?.summary?.total_students || 0} •
              Quiz completed: {preReadAnalytics?.summary?.completed_any_quiz || 0}/{preReadAnalytics?.summary?.total_students || 0}
            </div>
            {!preReadAnalytics?.students?.length ? (
              <p className="text-sm text-slate-500 italic">No student progress records yet.</p>
            ) : (
              <table className="min-w-full text-sm border border-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 border text-left">Student</th>
                    <th className="px-3 py-2 border text-left">Assigned</th>
                    <th className="px-3 py-2 border text-left">Opened</th>
                    <th className="px-3 py-2 border text-left">Read</th>
                    <th className="px-3 py-2 border text-left">Quiz Completed</th>
                    <th className="px-3 py-2 border text-left">Avg Quiz %</th>
                  </tr>
                </thead>
                <tbody>
                  {preReadAnalytics.students.map((student: any) => (
                    <tr key={student.student_id}>
                      <td className="px-3 py-2 border">
                        {student.student_name}
                        <div className="text-xs text-slate-500">{student.student_email}</div>
                      </td>
                      <td className="px-3 py-2 border">{student.assigned_readings}</td>
                      <td className="px-3 py-2 border">{student.opened_readings}</td>
                      <td className="px-3 py-2 border">{student.read_readings}</td>
                      <td className="px-3 py-2 border">{student.quiz_completed_readings}</td>
                      <td className="px-3 py-2 border">{student.avg_quiz_percent || 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="moodle-card p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Reading Quiz Report Feed</h3>
            {quizReports.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No quiz attempts have been submitted yet.</p>
            ) : (
              <div className="space-y-3">
                {quizReports.slice(0, 12).map((report) => (
                  <div key={report.id} className="flex items-center justify-between border border-slate-200 rounded p-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{report.student_name}</p>
                      <p className="text-xs text-slate-500">
                        {report.material_title} • {report.section_title}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-moodle-blue">
                        {report.score}/{report.total_questions}
                      </p>
                      <p className="text-[10px] text-slate-400 uppercase">
                        {new Date(report.submitted_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="moodle-card p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800">Anonymous Feedback Insights</h3>
            {!latestFeedbackForm ? (
              <p className="text-sm text-slate-500 italic">
                No feedback window triggered yet. A form opens after Session 4 and closes in 2 days.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-4 text-sm text-slate-700">
                  <span className="inline-flex items-center gap-1"><Users size={14} /> Responses: {latestFeedbackForm.submissions}</span>
                  <span className="inline-flex items-center gap-1"><BarChart3 size={14} /> Triggered at Session {latestFeedbackForm.trigger_session_number}</span>
                  <span className="inline-flex items-center gap-1"><Trophy size={14} /> Due: {new Date(latestFeedbackForm.due_at).toLocaleDateString()}</span>
                </div>

                <div className="space-y-3">
                  {latestFeedbackForm.metrics
                    .filter((m: any) => m.question_type === "mcq")
                    .map((metric: any) => (
                      <div key={metric.question_id} className="border border-slate-200 rounded p-3">
                        <div className="text-sm font-semibold text-slate-800">{metric.question_text}</div>
                        <div className="text-xs text-slate-500 mt-1">Average rating: {metric.average}/5 • Responses: {metric.responses}</div>
                      </div>
                    ))}
                </div>

                <div>
                  <h4 className="text-sm font-bold text-slate-800 mb-2 inline-flex items-center gap-2">
                    <MessageSquareText size={14} /> Anonymous Comments
                  </h4>
                  <div className="space-y-2">
                    {latestFeedbackForm.metrics
                      .filter((m: any) => m.question_type === "text")
                      .flatMap((m: any) => m.comments || [])
                      .slice(0, 12)
                      .map((comment: string, idx: number) => (
                        <div key={idx} className="text-sm text-slate-700 border border-slate-200 rounded p-2 bg-slate-50">
                          {comment}
                        </div>
                      ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default FacultyAnalytics;
