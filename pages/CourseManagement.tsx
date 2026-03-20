import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Loader2, MessageSquareText, Plus, Save, Sparkles, Trash2, UploadCloud, UserCheck, Users } from "lucide-react";
import ParticipantEnrollmentPanel, {
  ParticipantUser,
} from "../components/ParticipantEnrollmentPanel";
import {
  ActiveFeedbackForm,
  Course,
  CourseDetail,
  CourseMaterial,
  CourseSection,
  CourseSession,
  EvaluationComponent,
  UserRole,
} from "../types";

interface CourseManagementProps {
  courseId: number;
  role: UserRole;
  initialTab?: "course" | "feedback" | "analytics";
  onBack: () => void;
}

type CourseManagementTab = "course" | "materials" | "participants" | "analytics" | "attendance" | "feedback" | "sessions";

type QuizQuestion = { id: number; order: number; question: string; options: string[] };

const createEmptyEvaluationRow = (srNo: number): EvaluationComponent => ({
  sr_no: srNo,
  component: "",
  code: "",
  weightage_percent: 0,
  timeline: "",
  scheduled_date: "",
  clos_mapped: "",
});

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const formatDueDate = (value?: string) => {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleString();
};

const CourseManagement: React.FC<CourseManagementProps> = ({ courseId, role, initialTab = "course", onBack }) => {
  const [course, setCourse] = useState<Course | null>(null);
  const [details, setDetails] = useState<CourseDetail>({});
  const [sections, setSections] = useState<CourseSection[]>([]);
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [participants, setParticipants] = useState<ParticipantUser[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [quizAnalytics, setQuizAnalytics] = useState<any | null>(null);
  const [allStudents, setAllStudents] = useState<ParticipantUser[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<CourseManagementTab>(
    "course"
  );

  // Pre-read analytics (faculty)
  type PreReadStudentRow = {
    student_id: number; student_name: string; student_email: string;
    assigned_readings: number; opened_readings: number; read_readings: number;
    quiz_completed_readings: number; avg_quiz_percent: number | null;
  };
  type PreReadAnalytics = {
    summary: { total_students: number; opened_any: number; completed_any_quiz: number };
    students: PreReadStudentRow[];
  };
  const [preReadAnalytics, setPreReadAnalytics] = useState<PreReadAnalytics | null>(null);
  const [preReadAnalyticsLoading, setPreReadAnalyticsLoading] = useState(false);

  const [savingDetails, setSavingDetails] = useState(false);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<string>("");
  const [enrollingId, setEnrollingId] = useState<number | null>(null);
  const [bulkEnrolling, setBulkEnrolling] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [enrolNotice, setEnrolNotice] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const [assigningMaterialId, setAssigningMaterialId] = useState<number | null>(null);
  const [deletingMaterialId, setDeletingMaterialId] = useState<number | null>(null);
  const [regeneratingMaterialId, setRegeneratingMaterialId] = useState<number | null>(null);
  const [savingSessionId, setSavingSessionId] = useState<number | null>(null);
  const [sessionNotice, setSessionNotice] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const [savingCourseMeta, setSavingCourseMeta] = useState(false);
  const [deletingCourse, setDeletingCourse] = useState(false);
  const [courseActionNotice, setCourseActionNotice] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const [feedbackForm, setFeedbackForm] = useState<ActiveFeedbackForm | null>(null);
  const [feedbackAnswers, setFeedbackAnswers] = useState<Record<number, string>>({});
  const [feedbackStatus, setFeedbackStatus] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const [feedbackSubmitAcknowledged, setFeedbackSubmitAcknowledged] = useState(false);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // Feedback text-response summarizer (faculty, Reports tab)
  type TextResponseQuestion = {
    question_id: number;
    question_order: number;
    question_text: string;
    form_type: 'early_course' | 'end_course';
    responses: { answer_text: string }[];
  };
  type QuestionSummary = { loading: boolean; summary: string | null; keyTakeaways: string[] };
  const [textFeedbackData, setTextFeedbackData] = useState<TextResponseQuestion[]>([]);
  const [textFeedbackLoading, setTextFeedbackLoading] = useState(false);
  const [feedbackSummaries, setFeedbackSummaries] = useState<Record<string | number, QuestionSummary>>({});
  const [expandedResponses, setExpandedResponses] = useState<Record<string | number, boolean>>({});
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null);

  // Feedback analytics (faculty) — MCQ averages + submission counts
  type FeedbackFormAnalytics = {
    form_id: number;
    form_type?: string;
    trigger_session_number: number;
    open_at: string;
    due_at: string;
    submissions: number;
    metrics: {
      question_id: number;
      question_text: string;
      question_type: 'mcq' | 'text';
      options?: string[];
      average?: number;
      responses?: number;
      comments?: { student_name?: string; answer_text: string }[];
    }[];
  };
  const [feedbackAnalytics, setFeedbackAnalytics] = useState<FeedbackFormAnalytics[]>([]);
  const [feedbackAnalyticsLoading, setFeedbackAnalyticsLoading] = useState(false);

  // Attendance state (faculty)
  type AttendanceSummaryRow = {
    session_id: number; session_number: number; session_title: string;
    session_date: string; session_status: string;
    marked_count: number; present_count: number; absent_count: number;
    late_count: number; excused_count: number;
  };
  type AttendanceStudent = {
    student_id: number; name: string; email: string;
    status: "present" | "absent" | "late" | "excused"; note?: string; marked_at?: string;
  };
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummaryRow[]>([]);
  const [totalEnrolled, setTotalEnrolled] = useState(0);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [selectedAttendanceSession, setSelectedAttendanceSession] = useState<AttendanceSummaryRow | null>(null);
  const [sessionStudents, setSessionStudents] = useState<AttendanceStudent[]>([]);
  const [sessionStudentsLoading, setSessionStudentsLoading] = useState(false);
  const [attendanceEdits, setAttendanceEdits] = useState<Record<number, { status: string; note: string }>>({});
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [attendanceNotice, setAttendanceNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [materialForm, setMaterialForm] = useState({
    section_id: "",
    title: "",
    source_type: "pdf",
    source_url: "",
    source_file_name: "",
    source_file_base64: "",
    content: "",
    due_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });

  const isLinkMaterial = materialForm.source_type === "link";
  const canSubmitMaterial =
    Boolean(materialForm.section_id) &&
    Boolean(materialForm.title.trim()) &&
    Boolean(materialForm.due_at) &&
    (
      isLinkMaterial
        ? Boolean(materialForm.source_url.trim())
        : Boolean(materialForm.source_file_base64.trim())
    );

  const [quizModal, setQuizModal] = useState<{
    materialId: number;
    title: string;
    questions: QuizQuestion[];
    answers: number[];
    submitting: boolean;
    result: { score: number; total: number } | null;
  } | null>(null);
  const [courseForm, setCourseForm] = useState({
    name: "",
    code: "",
    instructor: "",
    description: "",
    image_url: "",
    start_date: "",
    end_date: "",
    visibility: "show" as "show" | "hide",
  });

  const outcomesText = useMemo(
    () => (details.learning_outcomes || []).join("\n"),
    [details.learning_outcomes]
  );

  const evaluationTotal = useMemo(
    () =>
      (details.evaluation_components || []).reduce(
        (sum, row) => sum + (Number(row.weightage_percent) || 0),
        0
      ),
    [details.evaluation_components]
  );

  const expectedSessionCount = useMemo(() => {
    const credits = Number(course?.credits || details.credits || 1);
    const normalized = credits <= 1 ? 1 : credits >= 3 ? 3 : Math.round(credits);
    return normalized * 9;
  }, [course?.credits, details.credits]);

  const getNowOverrideHeaders = () => {
    const override = localStorage.getItem("wisenet_time_override");
    if (!override) return {};
    return { "x-now-override": override };
  };

  const fetchActiveFeedback = async () => {
    if (role !== "student") return;
    setLoadingFeedback(true);
    setFeedbackStatus((prev) => (prev?.type === "error" ? null : prev));
    try {
      const response = await fetch(`/api/courses/${courseId}/feedback/active`, {
        headers: getNowOverrideHeaders(),
      });
      if (!response.ok) {
        setFeedbackForm(null);
        setFeedbackStatus({ type: "error", text: "Couldn't load the feedback form. Please try again." });
        return;
      }
      const payload = await response.json();
      setFeedbackForm(payload);
      setFeedbackStatus((prev) => (prev?.type === "error" ? null : prev));
      setFeedbackAnswers({});
    } catch {
      setFeedbackForm(null);
      setFeedbackStatus({ type: "error", text: "Couldn't load the feedback form. Please try again." });
    } finally {
      setLoadingFeedback(false);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    setError("");
    try {
      const detailsRes = await fetch(`/api/course-details/${courseId}`);
      if (!detailsRes.ok) {
        const payload = await detailsRes.json().catch(() => ({ error: "Something went wrong loading this course. Please try again." }));
        setError(payload.error || "Something went wrong loading this course. Please try again.");
        return;
      }
      const data = await detailsRes.json();
      setCourse(data.course);
      setCourseForm({
        name: String(data.course?.name || ""),
        code: String(data.course?.code || ""),
        instructor: String(data.course?.instructor || ""),
        description: String(data.course?.description || ""),
        image_url: String(data.course?.image_url || ""),
        start_date: String(data.course?.start_date || "").slice(0, 10),
        end_date: String(data.course?.end_date || "").slice(0, 10),
        visibility: data.course?.visibility === "hide" ? "hide" : "show",
      });
      setDetails(data.details || {});
      setSections(data.sections || []);
      setMaterials(data.materials || []);
      const sessionsRes = await fetch(`/api/courses/${courseId}/sessions`);
      if (sessionsRes.ok) {
        setSessions(await sessionsRes.json());
      }

      if (role === "faculty") {
        const [participantsRes, studentsRes, reportsRes, quizAnalyticsRes] = await Promise.all([
          fetch(`/api/courses/${courseId}/participants`),
          fetch("/api/students"),
          fetch(`/api/courses/${courseId}/quiz-reports`),
          fetch(`/api/courses/${courseId}/quiz-analytics`),
        ]);
        if (participantsRes.ok) setParticipants(await participantsRes.json());
        if (studentsRes.ok) setAllStudents(await studentsRes.json());
        if (reportsRes.ok) setReports(await reportsRes.json());
        if (quizAnalyticsRes.ok) setQuizAnalytics(await quizAnalyticsRes.json());
        setSelectedCandidateIds([]);
      } else {
        await fetchActiveFeedback();
      }
    } catch (error) {
      console.error("Failed to fetch course data", error);
      setError("Something went wrong loading this course. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const fetchMaterialsOnly = async () => {
    try {
      const response = await fetch(`/api/courses/${courseId}/materials`);
      if (response.ok) {
        setMaterials(await response.json());
      }
    } catch (error) {
      console.error("Failed to fetch materials", error);
    }
  };

  useEffect(() => {
    fetchAll();
    setFeedbackSubmitAcknowledged(false);
  }, [courseId, role]);

  useEffect(() => {
    let nextTab: CourseManagementTab = "course";
    if (role === "student" && initialTab === "feedback") nextTab = "feedback";
    if (role === "faculty" && (initialTab === "analytics" || initialTab as string === "feedback")) nextTab = initialTab as CourseManagementTab;
    setActiveTab(nextTab);
  }, [courseId, initialTab, role]);

  useEffect(() => {
    if (role !== "student") return;
    const onTimeOverrideUpdated = () => {
      fetchActiveFeedback();
    };
    window.addEventListener("wisenet-time-override-updated", onTimeOverrideUpdated);
    return () => window.removeEventListener("wisenet-time-override-updated", onTimeOverrideUpdated);
  }, [courseId, role]);

  useEffect(() => {
    if (!feedbackSubmitAcknowledged) return;
    const timer = window.setTimeout(() => {
      setFeedbackSubmitAcknowledged(false);
      setFeedbackStatus(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [feedbackSubmitAcknowledged]);

  // Lazy-load pre-read analytics when faculty opens Analytics tab
  useEffect(() => {
    if (role !== "faculty" || activeTab !== "analytics" || preReadAnalytics || preReadAnalyticsLoading) return;
    setPreReadAnalyticsLoading(true);
    fetch(`/api/courses/${courseId}/pre-read-analytics`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((data: PreReadAnalytics | null) => { if (data) setPreReadAnalytics(data); })
      .catch(() => {})
      .finally(() => setPreReadAnalyticsLoading(false));
  }, [activeTab, role, courseId, preReadAnalytics, preReadAnalyticsLoading]);

  // Lazy-load attendance summary when faculty opens Attendance tab
  useEffect(() => {
    if (role !== "faculty" || activeTab !== "attendance" || attendanceSummary.length > 0 || attendanceLoading) return;
    setAttendanceLoading(true);
    fetch(`/api/courses/${courseId}/attendance/summary`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { sessions: [], total_enrolled: 0 })
      .then((data: { sessions: AttendanceSummaryRow[]; total_enrolled: number }) => {
        setAttendanceSummary(data.sessions || []);
        setTotalEnrolled(data.total_enrolled || 0);
      })
      .catch(() => {})
      .finally(() => setAttendanceLoading(false));
  }, [activeTab, role, courseId, attendanceSummary.length, attendanceLoading]);

  const openAttendanceSession = (row: AttendanceSummaryRow) => {
    setSelectedAttendanceSession(row);
    setAttendanceEdits({});
    setAttendanceNotice(null);
    setSessionStudentsLoading(true);
    fetch(`/api/sessions/${row.session_id}/attendance`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { students: [] })
      .then((data: { students: AttendanceStudent[] }) => {
        setSessionStudents(data.students || []);
        // Initialise edits from current status
        const edits: Record<number, { status: string; note: string }> = {};
        for (const s of data.students || []) {
          edits[s.student_id] = { status: s.status || "present", note: s.note || "" };
        }
        setAttendanceEdits(edits);
      })
      .catch(() => {})
      .finally(() => setSessionStudentsLoading(false));
  };

  const saveAttendance = async () => {
    if (!selectedAttendanceSession) return;
    setSavingAttendance(true);
    setAttendanceNotice(null);
    try {
      const records = Object.entries(attendanceEdits).map(([sid, val]) => ({
        student_id: Number(sid),
        status: (val as { status: string; note: string }).status,
        note: (val as { status: string; note: string }).note || undefined,
      }));
      const r = await fetch(`/api/sessions/${selectedAttendanceSession.session_id}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ records }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setAttendanceNotice({ type: "success", text: `Attendance saved for ${records.length} students.` });
      // Refresh summary row counts
      setAttendanceSummary([]);
    } catch (e: any) {
      setAttendanceNotice({ type: "error", text: e.message || "Failed to save attendance." });
    } finally {
      setSavingAttendance(false);
    }
  };

  // Lazy-load feedback data (analytics + text responses) when faculty opens Feedback tab
  useEffect(() => {
    if (role !== "faculty" || activeTab !== "feedback") return;
    if (feedbackAnalytics.length === 0 && !feedbackAnalyticsLoading) {
      setFeedbackAnalyticsLoading(true);
      fetch(`/api/courses/${courseId}/feedback/analytics`, { credentials: "include" })
        .then(r => r.ok ? r.json() : { forms: [] })
        .then((data: { forms: FeedbackFormAnalytics[] }) => setFeedbackAnalytics(data.forms || []))
        .catch(() => {})
        .finally(() => setFeedbackAnalyticsLoading(false));
    }
    if (textFeedbackData.length === 0 && !textFeedbackLoading) {
      setTextFeedbackLoading(true);
      fetch(`/api/courses/${courseId}/feedback/text-responses`, { credentials: "include" })
        .then(r => r.ok ? r.json() : [])
        .then((data: TextResponseQuestion[]) => setTextFeedbackData(data))
        .catch(() => {})
        .finally(() => setTextFeedbackLoading(false));
    }
  }, [activeTab, role, courseId]);

  const generateFeedbackSummary = async (q: TextResponseQuestion) => {
    setFeedbackSummaries(prev => ({ ...prev, [q.question_id]: { loading: true, summary: null, keyTakeaways: [] } }));
    try {
      const r = await fetch("/api/ai/feedback-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionText: q.question_text, answers: q.responses.map(r => r.answer_text) }),
      });
      const data = await r.json();
      setFeedbackSummaries(prev => ({
        ...prev,
        [q.question_id]: { loading: false, summary: data.summary || null, keyTakeaways: data.keyTakeaways || [] },
      }));
    } catch {
      setFeedbackSummaries(prev => ({
        ...prev,
        [q.question_id]: { loading: false, summary: "Failed to generate summary. Please try again.", keyTakeaways: [] },
      }));
    }
  };

  // Generate a single combined summary across ALL open-ended questions for a form
  const generateCombinedFormSummary = async (formId: number, questions: TextResponseQuestion[]) => {
    const key = `form_${formId}`;
    setFeedbackSummaries(prev => ({ ...prev, [key]: { loading: true, summary: null, keyTakeaways: [] } }));
    try {
      // Combine all responses with their question context
      const allAnswers = questions.flatMap(q =>
        q.responses.map(r => `[${q.question_text}] ${r.answer_text}`)
      );
      const combinedQuestion = questions.map(q => q.question_text).join(' / ');
      const r = await fetch("/api/ai/feedback-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionText: combinedQuestion, answers: allAnswers }),
      });
      const data = await r.json();
      setFeedbackSummaries(prev => ({
        ...prev,
        [key]: { loading: false, summary: data.summary || null, keyTakeaways: data.keyTakeaways || [] },
      }));
    } catch {
      setFeedbackSummaries(prev => ({
        ...prev,
        [key]: { loading: false, summary: "Failed to generate summary. Please try again.", keyTakeaways: [] },
      }));
    }
  };

  const updateEvaluationRow = (index: number, key: keyof EvaluationComponent, value: string | number) => {
    setDetails((prev) => {
      const rows = [...(prev.evaluation_components || [])];
      const current = rows[index] || createEmptyEvaluationRow(index + 1);
      rows[index] = {
        ...current,
        sr_no: index + 1,
        [key]: key === "weightage_percent" ? Number(value) || 0 : String(value),
      } as EvaluationComponent;
      return { ...prev, evaluation_components: rows };
    });
  };

  const updateSessionRow = (
    sessionId: number,
    key: "title" | "session_date" | "start_time" | "end_time" | "mode",
    value: string
  ) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              [key]: value,
            }
          : session
      )
    );
    setSessionNotice(null);
  };

  const saveSession = async (sessionId: number) => {
    const row = sessions.find((session) => session.id === sessionId);
    if (!row) return;
    setSavingSessionId(sessionId);
    setSessionNotice(null);
    try {
      const response = await fetch(`/api/courses/${courseId}/sessions/${sessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: row.title,
          session_date: String(row.session_date).slice(0, 10),
          start_time: row.start_time || null,
          end_time: row.end_time || null,
          mode: row.mode || "classroom",
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Couldn't save the session. Please try again." }));
        setSessionNotice({ type: "error", text: payload.error || "Couldn't save the session. Please try again." });
        return;
      }
      setSessionNotice({ type: "success", text: `Session S${row.session_number} updated.` });
      await fetchAll();
    } catch {
      setSessionNotice({ type: "error", text: "Couldn't save the session. Please try again." });
    } finally {
      setSavingSessionId(null);
    }
  };

  const addEvaluationRow = () => {
    setDetails((prev) => {
      const rows = [...(prev.evaluation_components || [])];
      rows.push(createEmptyEvaluationRow(rows.length + 1));
      return { ...prev, evaluation_components: rows };
    });
  };

  const removeEvaluationRow = (index: number) => {
    setDetails((prev) => {
      const rows = [...(prev.evaluation_components || [])].filter((_, i) => i !== index);
      return {
        ...prev,
        evaluation_components: rows.map((row, idx) => ({ ...row, sr_no: idx + 1 })),
      };
    });
  };

  const handleSaveDetails = async () => {
    const normalizedRows = (details.evaluation_components || []).map((row, idx) => ({
      ...row,
      sr_no: idx + 1,
      weightage_percent: Number(row.weightage_percent) || 0,
    }));
    const totalWeight = normalizedRows.reduce(
      (sum, row) => sum + (Number(row.weightage_percent) || 0),
      0
    );
    if (normalizedRows.length > 0 && totalWeight !== 100) {
      const message = `Evaluation weightages currently total ${totalWeight}%. Please make it 100% before saving.`;
      setError(message);
      window.alert(message);
      return;
    }

    setSavingDetails(true);
    try {
      const payload = {
        ...details,
        evaluation_components: normalizedRows,
      };

      const response = await fetch(`/api/course-details/${courseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) await fetchAll();
    } finally {
      setSavingDetails(false);
    }
  };

  const PDF_MAX_BYTES = 15 * 1024 * 1024; // 15 MB

  const handlePdfSelected = async (file: File | null) => {
    if (!file) return;

    if (file.size > PDF_MAX_BYTES) {
      setPdfStatus(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 15 MB.`);
      return;
    }

    setPdfStatus("");
    try {
      const buffer = await file.arrayBuffer();
      const sourceFileBase64 = arrayBufferToBase64(buffer);

      setMaterialForm((prev) => ({
        ...prev,
        source_type: "pdf",
        source_file_name: file.name,
        source_file_base64: sourceFileBase64,
        source_url: "",
        content: "",
      }));
    } finally {
      // no-op
    }
  };

  const handleUploadMaterial = async () => {
    if (!materialForm.section_id || !materialForm.title) {
      return;
    }

    if (materialForm.source_type === "link" && !materialForm.source_url.trim()) {
      return;
    }

    if (materialForm.source_type === "pdf" && !materialForm.source_file_base64.trim()) {
      return;
    }

    setUploadingMaterial(true);
    setPdfStatus(materialForm.source_type === "pdf" ? "Uploading PDF..." : "Submitting web link...");
    try {
      const response = await fetch(`/api/courses/${courseId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_id: Number(materialForm.section_id),
          title: materialForm.title,
          source_type: materialForm.source_type,
          source_url: materialForm.source_url || null,
          source_file_name: materialForm.source_file_name || null,
          source_file_base64: materialForm.source_file_base64 || null,
          content: materialForm.content,
          due_at: materialForm.due_at || null,
          is_assigned: true,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Upload failed. Please try again." }));
        setPdfStatus(error.error || "Upload failed. Please try again.");
        return;
      }

      setUploadingMaterial(false);
      setMaterialForm({
        section_id: "",
        title: "",
        source_type: "pdf",
        source_url: "",
        source_file_name: "",
        source_file_base64: "",
        content: "",
        due_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      });
      setPdfStatus(materialForm.source_type === "pdf" ? "PDF uploaded successfully!" : "Web link added successfully!");
      await fetchMaterialsOnly();
      setTimeout(() => setPdfStatus(""), 3000);
    } finally {
      setUploadingMaterial(false);
    }
  };

  const handleToggleAssign = async (materialId: number, assigned: boolean) => {
    setAssigningMaterialId(materialId);
    try {
      await fetch(`/api/materials/${materialId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned }),
      });
      await fetchAll();
    } finally {
      setAssigningMaterialId(null);
    }
  };

  const handleDeleteMaterial = async (materialId: number) => {
    setDeletingMaterialId(materialId);
    try {
      await fetch(`/api/materials/${materialId}`, {
        method: "DELETE",
      });
      await fetchAll();
    } finally {
      setDeletingMaterialId(null);
    }
  };

  const handleRegenerateQuiz = async (materialId: number) => {
    const confirmed = window.confirm(
      "This will permanently overwrite the existing quiz for this material. Students who haven't taken it yet will see the new version. Continue?"
    );
    if (!confirmed) return;

    setRegeneratingMaterialId(materialId);
    try {
      await fetch(`/api/materials/${materialId}/quiz/regenerate`, {
        method: "POST",
      });
      await fetchAll();
    } finally {
      setRegeneratingMaterialId(null);
    }
  };

  const openPdfMaterial = async (materialId: number) => {
    const response = await fetch(`/api/materials/${materialId}/file`);
    if (!response.ok) return;

    const payload = await response.json();
    const byteChars = atob(payload.file_base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i += 1) {
      bytes[i] = byteChars.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: payload.mime_type || "application/pdf" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const handleEnrol = async (userId: number) => {
    setEnrollingId(userId);
    setEnrolNotice(null);
    try {
      const response = await fetch(`/api/courses/${courseId}/enrol`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Couldn't enroll this student. Please try again." }));
        setEnrolNotice({ type: "error", text: payload.error || "Couldn't enroll this student. Please try again." });
        return;
      }
      setEnrolNotice({ type: "success", text: "Student enrolled successfully." });
      await fetchAll();
    } finally {
      setEnrollingId(null);
    }
  };

  const toggleCandidateSelection = (userId: number) => {
    setSelectedCandidateIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const selectAllCandidates = (checked: boolean) => {
    if (!checked) {
      setSelectedCandidateIds([]);
      return;
    }
    const participantIds = new Set(participants.map((participant) => Number(participant.id)));
    const ids = allStudents
      .map((student) => Number(student.id))
      .filter((studentId) => !participantIds.has(studentId));
    setSelectedCandidateIds(ids);
  };

  const handleBulkEnrol = async () => {
    if (selectedCandidateIds.length === 0) return;
    setBulkEnrolling(true);
    setEnrolNotice(null);
    try {
      const response = await fetch(`/api/courses/${courseId}/enrol-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_ids: selectedCandidateIds }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Couldn't enroll the selected students. Please try again." }));
        setEnrolNotice({ type: "error", text: payload.error || "Couldn't enroll the selected students. Please try again." });
        return;
      }
      const payload = await response.json().catch(() => ({}));
      const enrolledCount = Number(payload.enrolled_count || selectedCandidateIds.length);
      setEnrolNotice({ type: "success", text: `${enrolledCount} student(s) enrolled successfully.` });
      setSelectedCandidateIds([]);
      await fetchAll();
    } finally {
      setBulkEnrolling(false);
    }
  };

  const startQuiz = async (materialId: number, title: string) => {
    const response = await fetch(`/api/materials/${materialId}/quiz`);
    if (!response.ok) return;
    const questions = (await response.json()) as QuizQuestion[];
    setQuizModal({
      materialId,
      title,
      questions,
      answers: Array(questions.length).fill(-1),
      submitting: false,
      result: null,
    });
  };

  const submitQuiz = async () => {
    if (!quizModal) return;
    setQuizModal({ ...quizModal, submitting: true });
    const response = await fetch(`/api/materials/${quizModal.materialId}/quiz/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: quizModal.answers }),
    });
    const result = response.ok ? await response.json() : null;
    setQuizModal((prev) =>
      prev ? { ...prev, submitting: false, result: result || { score: 0, total: prev.questions.length } } : prev
    );
    await fetchAll();
  };

  const handleSaveCourseMeta = async () => {
    if (role !== "faculty") return;
    setSavingCourseMeta(true);
    setCourseActionNotice(null);
    try {
      const response = await fetch(`/api/courses/${courseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: courseForm.name,
          code: courseForm.code,
          instructor: courseForm.instructor,
          description: courseForm.description,
          image_url: courseForm.image_url || null,
          start_date: courseForm.start_date,
          end_date: courseForm.end_date,
          visibility: courseForm.visibility,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Couldn't save course settings. Please try again." }));
        setCourseActionNotice({ type: "error", text: payload.error || "Couldn't save course settings. Please try again." });
        return;
      }
      setCourseActionNotice({ type: "success", text: "Course settings updated successfully." });
      await fetchAll();
    } catch {
      setCourseActionNotice({ type: "error", text: "Couldn't save course settings. Please try again." });
    } finally {
      setSavingCourseMeta(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (role !== "faculty") return;
    const confirmed = window.confirm(
      "Delete this course permanently? This will remove sessions, materials, enrollments, quizzes and feedback records for this course."
    );
    if (!confirmed) return;
    setDeletingCourse(true);
    setCourseActionNotice(null);
    try {
      const response = await fetch(`/api/courses/${courseId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Couldn't delete this course. Please try again." }));
        setCourseActionNotice({ type: "error", text: payload.error || "Couldn't delete this course. Please try again." });
        return;
      }
      onBack();
    } catch {
      setCourseActionNotice({ type: "error", text: "Couldn't delete this course. Please try again." });
    } finally {
      setDeletingCourse(false);
    }
  };

  const submitFeedback = async () => {
    if (!feedbackForm) return;
    const answers = feedbackForm.questions
      .map((question) => {
        const value = String(feedbackAnswers[question.id] || "").trim();
        if (!value) return null;
        if (question.question_type === "mcq") {
          return {
            question_id: question.id,
            choice_value: Number(value),
            answer_text: "",
          };
        }
        return {
          question_id: question.id,
          choice_value: null,
          answer_text: value,
        };
      })
      .filter(Boolean);

    const requiredCount = feedbackForm.questions.filter((q) => q.required !== false).length;
    if (answers.length < requiredCount) {
      setFeedbackStatus({ type: "error", text: "Please answer all required feedback questions." });
      return;
    }

    setSubmittingFeedback(true);
    setFeedbackStatus(null);
    try {
      const response = await fetch(`/api/courses/${courseId}/feedback/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getNowOverrideHeaders() },
        body: JSON.stringify({
          form_id: feedbackForm.form_id,
          answers,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Couldn't submit your feedback. Please try again." }));
        setFeedbackStatus({ type: "error", text: payload.error || "Couldn't submit your feedback. Please try again." });
        return;
      }
      setFeedbackAnswers({});
      await fetchActiveFeedback();
      window.dispatchEvent(new Event("wisenet-feedback-updated"));
      setFeedbackSubmitAcknowledged(true);
      setFeedbackStatus({ type: "success", text: "Feedback submitted. This task is now complete." });
    } catch {
      setFeedbackStatus({ type: "error", text: "Couldn't submit your feedback. Please try again." });
    } finally {
      setSubmittingFeedback(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 size={30} className="animate-spin text-moodle-blue" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-4">
        <div className="moodle-card p-4 border border-rose-200 bg-rose-50 text-sm text-rose-700">
          {error}
        </div>
        <button
          onClick={fetchAll}
          className="px-3 py-2 rounded border border-slate-300 text-sm font-bold hover:bg-slate-50"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!course) return <div>Course not found.</div>;

  const materialsBySection = sections.map((s) => ({
    ...s,
    items: materials.filter((m) => m.section_id === s.id),
  }));

  const renderStudentMaterials = () => (
    <div className="space-y-6">
      {materialsBySection.map((section) => (
        <div key={section.id} className="moodle-card p-6 space-y-4">
          <h3 className="text-xl font-bold text-slate-800">{section.title}</h3>
          {section.items.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No assigned reading materials in this section yet.</p>
          ) : (
            section.items.map((material) => (
              <div key={material.id} className="border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="font-bold text-slate-800">{material.title}</h4>
                    <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mt-1">
                      {material.source_type === "pdf" ? "PDF" : "Web Link"} resource
                    </p>
                    <p className="text-xs text-slate-500 mt-1">Due: {formatDueDate(material.due_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {material.source_type === "link" && material.source_url ? (
                      <a
                        href={material.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 border border-slate-300 rounded text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Explore Source
                      </a>
                    ) : null}

                    {material.source_type === "pdf" ? (
                      <button
                        onClick={() => openPdfMaterial(material.id)}
                        className="px-3 py-1.5 border border-slate-300 rounded text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Explore PDF
                      </button>
                    ) : null}

                    <button
                      onClick={() => startQuiz(material.id, material.title)}
                      className="px-3 py-1.5 bg-moodle-blue text-white rounded text-xs font-bold hover:bg-blue-700"
                    >
                      Take 5Q Quiz
                    </button>
                  </div>
                </div>

                {material.latest_total ? (
                  <p className="text-xs font-bold text-emerald-600">
                    Last quiz score: {material.latest_score}/{material.latest_total}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );

  const renderStudentFeedback = () => {
    const feedbackCompleted = Boolean(feedbackForm?.already_submitted || feedbackSubmitAcknowledged);

    return (
      <div className="space-y-6">
        {loadingFeedback ? (
          <div className="moodle-card p-4 border border-amber-200 bg-amber-50/50 flex items-center gap-2 text-sm text-amber-700">
            <Loader2 size={16} className="animate-spin" />
            Checking if feedback is active for this course...
          </div>
        ) : null}

        {feedbackStatus ? (
          <div
            className={`rounded border px-3 py-2 text-sm ${
              feedbackStatus.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {feedbackStatus.text}
          </div>
        ) : null}

        {feedbackForm && !feedbackForm.already_submitted ? (
          <div className="moodle-card p-6 border border-amber-200 bg-amber-50/40 space-y-4">
            <div className="flex items-start gap-3">
              <MessageSquareText size={20} className="text-amber-600 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold text-slate-800">
                  {feedbackForm.form_type === 'end_course' ? 'End Course Feedback' : 'Early Course Feedback'}
                </h3>
                <p className="text-sm text-slate-600">
                  Please submit by {new Date(feedbackForm.due_at).toLocaleString()}.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {feedbackForm.questions.map((question) => (
                <div key={question.id} className="rounded border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-800 mb-2">
                    {question.question_order}. {question.question_text}
                  </p>
                  {question.question_type === "mcq" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {(question.options || []).map((option, optionIdx) => (
                        <label key={optionIdx} className="text-sm text-slate-700 flex items-center gap-2">
                          <input
                            type="radio"
                            name={`feedback-${question.id}`}
                            checked={feedbackAnswers[question.id] === String(optionIdx + 1)}
                            onChange={() =>
                              setFeedbackAnswers((prev) => ({
                                ...prev,
                                [question.id]: String(optionIdx + 1),
                              }))
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
                      placeholder="Type your response"
                      value={feedbackAnswers[question.id] || ""}
                      onChange={(e) =>
                        setFeedbackAnswers((prev) => ({
                          ...prev,
                          [question.id]: e.target.value,
                        }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600">All questions are compulsory.</p>
              <button
                onClick={submitFeedback}
                disabled={submittingFeedback}
                className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-black disabled:opacity-70"
              >
                {submittingFeedback ? "Submitting..." : "Submit Feedback"}
              </button>
            </div>
          </div>
        ) : null}

        {feedbackCompleted ? (
          <div className="moodle-card p-6 border border-emerald-200 bg-emerald-50/70">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={20} className="text-emerald-600 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold text-emerald-800">Feedback completed</h3>
                <p className="text-sm text-emerald-700 mt-1">
                  Your feedback for this course has been recorded successfully.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {!loadingFeedback && !feedbackForm && !feedbackCompleted ? (
          <div className="moodle-card p-6 border border-slate-200 bg-slate-50/70">
            <h3 className="text-lg font-bold text-slate-800">No active feedback right now</h3>
            <p className="text-sm text-slate-600 mt-2">
              When feedback opens for this course, you will be able to complete it from this tab.
            </p>
          </div>
        ) : null}
      </div>
    );
  };

  const renderStudentCourse = () => (
    <div className="space-y-8">
      <div className="flex border-b border-slate-200 overflow-x-auto">
        {[
          { id: "course", label: "Course" },
          { id: "materials", label: "Reading Materials" },
          { id: "sessions", label: "Sessions" },
          {
            id: "feedback",
            label:
              feedbackForm && !feedbackForm.already_submitted
                ? "Feedback (Required)"
                : "Feedback",
          },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as CourseManagementTab)}
            className={`px-5 py-3 text-sm font-bold whitespace-nowrap ${
              activeTab === tab.id
                ? "text-moodle-blue border-b-2 border-moodle-blue"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "course" && (
        <div className="space-y-8">
          <div className="moodle-card p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-4">Course Information</h3>
            <p className="text-sm text-slate-700 mb-2">
              <span className="font-bold">Faculty:</span> {details.faculty_info || course.instructor}
              {details.teaching_assistant ? ` | Teaching Assistant: ${details.teaching_assistant}` : ""}
              {details.credits ? ` | Cr: ${details.credits}` : ""}
            </p>
            <h4 className="font-bold text-slate-800 mt-5 mb-2">Course Learning Outcomes</h4>
            <ol className="list-decimal pl-5 text-slate-700 text-sm space-y-1">
              {(details.learning_outcomes || []).map((outcome, idx) => (
                <li key={idx}>{outcome}</li>
              ))}
            </ol>
          </div>

          {(details.evaluation_components || []).length > 0 && (
            <div className="moodle-card p-6 overflow-x-auto">
              <h3 className="text-lg font-bold mb-4 text-slate-800">Evaluations and Submissions</h3>
              <table className="min-w-full text-sm border border-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 border">Sr. No.</th>
                    <th className="px-3 py-2 border">Component</th>
                    <th className="px-3 py-2 border">Code</th>
                    <th className="px-3 py-2 border">Weightage</th>
                    <th className="px-3 py-2 border">Timeline</th>
                    <th className="px-3 py-2 border">Scheduled</th>
                    <th className="px-3 py-2 border">CLOs</th>
                  </tr>
                </thead>
                <tbody>
                  {(details.evaluation_components || []).map((row, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 border">{row.sr_no}</td>
                      <td className="px-3 py-2 border">{row.component}</td>
                      <td className="px-3 py-2 border text-moodle-blue">{row.code}</td>
                      <td className="px-3 py-2 border">{row.weightage_percent}%</td>
                      <td className="px-3 py-2 border">{row.timeline}</td>
                      <td className="px-3 py-2 border">{row.scheduled_date}</td>
                      <td className="px-3 py-2 border">{row.clos_mapped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "materials" && renderStudentMaterials()}
      {activeTab === "sessions" && (
        <div className="moodle-card p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-4">Session Schedule</h3>
          {sessions.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No sessions scheduled yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border border-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 border text-left font-semibold text-slate-600">#</th>
                    <th className="px-3 py-2 border text-left font-semibold text-slate-600">Title</th>
                    <th className="px-3 py-2 border text-left font-semibold text-slate-600">Date</th>
                    <th className="px-3 py-2 border text-left font-semibold text-slate-600">Time</th>
                    <th className="px-3 py-2 border text-left font-semibold text-slate-600">Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 border font-semibold text-slate-500">S{session.session_number}</td>
                      <td className="px-3 py-2 border text-slate-800">{session.title}</td>
                      <td className="px-3 py-2 border text-slate-700">
                        {session.session_date
                          ? new Date(String(session.session_date).slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                          : "—"}
                      </td>
                      <td className="px-3 py-2 border text-slate-700">
                        {session.start_time && session.end_time
                          ? `${session.start_time} – ${session.end_time}`
                          : session.start_time || "—"}
                      </td>
                      <td className="px-3 py-2 border capitalize text-slate-700">{session.mode || "Classroom"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {activeTab === "feedback" && renderStudentFeedback()}
    </div>
  );

  const renderFacultyCourse = () => (
    <div className="space-y-8">
      <div className="flex border-b border-slate-200 overflow-x-auto">
        {[
          { id: "course", label: "Course" },
          { id: "materials", label: "Reading Materials" },
          { id: "participants", label: "Participants" },
          ...(role === "faculty" ? [{ id: "analytics", label: "Analytics" }] : []),
          ...(role === "faculty" ? [{ id: "feedback", label: "Feedback" }] : []),
          ...(role === "faculty" ? [{ id: "attendance", label: "Attendance" }] : []),
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-5 py-3 text-sm font-bold whitespace-nowrap ${
              activeTab === tab.id
                ? "text-moodle-blue border-b-2 border-moodle-blue"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "course" && (
        <div className="moodle-card p-6 space-y-5">
          <h3 className="text-lg font-bold">Course Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm font-medium text-slate-700">
              Course Name
              <input
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={courseForm.name}
                onChange={(e) => setCourseForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Course Code
              <input
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={courseForm.code}
                onChange={(e) => setCourseForm((prev) => ({ ...prev, code: e.target.value }))}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Instructor Name
              <input
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={courseForm.instructor}
                onChange={(e) => setCourseForm((prev) => ({ ...prev, instructor: e.target.value }))}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Visibility
              <select
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={courseForm.visibility}
                onChange={(e) =>
                  setCourseForm((prev) => ({
                    ...prev,
                    visibility: e.target.value === "hide" ? "hide" : "show",
                  }))
                }
              >
                <option value="show">Show</option>
                <option value="hide">Hide</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Start Date
              <input
                type="date"
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={courseForm.start_date}
                onChange={(e) => setCourseForm((prev) => ({ ...prev, start_date: e.target.value }))}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              End Date
              <input
                type="date"
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={courseForm.end_date}
                onChange={(e) => setCourseForm((prev) => ({ ...prev, end_date: e.target.value }))}
              />
            </label>
            <label className="text-sm font-medium text-slate-700 md:col-span-2">
              Image URL
              <input
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={courseForm.image_url}
                onChange={(e) => setCourseForm((prev) => ({ ...prev, image_url: e.target.value }))}
              />
            </label>
            <label className="text-sm font-medium text-slate-700 md:col-span-2">
              Description
              <textarea
                rows={3}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={courseForm.description}
                onChange={(e) => setCourseForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </label>
          </div>

          {courseActionNotice ? (
            <div
              className={`rounded border px-3 py-2 text-sm ${
                courseActionNotice.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {courseActionNotice.text}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveCourseMeta}
              disabled={savingCourseMeta}
              className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-black disabled:opacity-70"
            >
              {savingCourseMeta ? "Saving..." : "Save Course Settings"}
            </button>
            <button
              onClick={handleDeleteCourse}
              disabled={deletingCourse}
              className="px-4 py-2 border border-rose-300 text-rose-700 rounded text-sm font-bold hover:bg-rose-50 disabled:opacity-70"
            >
              {deletingCourse ? "Deleting..." : "Delete Course"}
            </button>
          </div>

          <div className="border-t border-slate-200 pt-5 space-y-5">
            <h3 className="text-lg font-bold">Course Details (DB-backed)</h3>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <label className="text-sm font-medium text-slate-700">
              Faculty Info
              <input
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={details.faculty_info || ""}
                onChange={(e) => setDetails((prev) => ({ ...prev, faculty_info: e.target.value }))}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Teaching Assistant
              <input
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={details.teaching_assistant || ""}
                onChange={(e) =>
                  setDetails((prev) => ({ ...prev, teaching_assistant: e.target.value }))
                }
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Credits
              <input
                type="number"
                min={1}
                max={3}
                className="mt-1 w-40 border border-slate-300 rounded px-3 py-2 text-sm"
                value={details.credits || 1}
                onChange={(e) => setDetails((prev) => ({ ...prev, credits: Number(e.target.value) }))}
              />
              <p className="text-xs text-slate-500 mt-1">
                Planned sessions based on credits: {expectedSessionCount}
              </p>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Learning Outcomes (one per line)
              <textarea
                rows={5}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={outcomesText}
                onChange={(e) =>
                  setDetails((prev) => ({
                    ...prev,
                    learning_outcomes: e.target.value
                      .split("\n")
                      .map((l) => l.trim())
                      .filter(Boolean),
                  }))
                }
              />
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-800">Evaluation Components</h4>
              <span
                className={`text-xs font-bold ${
                  evaluationTotal === 100 ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                Total Weight: {evaluationTotal}%
              </span>
            </div>

            {(details.evaluation_components || []).map((row, idx) => (
              <div key={idx} className="border border-slate-200 rounded p-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="text-xs font-medium text-slate-600">
                    Component
                    <input
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                      value={row.component}
                      onChange={(e) => updateEvaluationRow(idx, "component", e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Code
                    <input
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                      value={row.code}
                      onChange={(e) => updateEvaluationRow(idx, "code", e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Weight %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                      value={row.weightage_percent}
                      onChange={(e) => updateEvaluationRow(idx, "weightage_percent", Number(e.target.value))}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Timeline
                    <input
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                      value={row.timeline}
                      onChange={(e) => updateEvaluationRow(idx, "timeline", e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Scheduled Date / Slot
                    <input
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                      value={row.scheduled_date}
                      onChange={(e) => updateEvaluationRow(idx, "scheduled_date", e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    CLOs Mapped
                    <input
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                      value={row.clos_mapped}
                      onChange={(e) => updateEvaluationRow(idx, "clos_mapped", e.target.value)}
                    />
                  </label>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-500">Evaluation #{idx + 1}</span>
                  <button
                    onClick={() => removeEvaluationRow(idx)}
                    className="text-xs font-bold text-red-600 hover:text-red-700 inline-flex items-center gap-1"
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
              </div>
            ))}

            <button
              onClick={addEvaluationRow}
              className="px-3 py-1.5 border border-slate-300 rounded text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              + Add Evaluation Component
            </button>
            <button
              onClick={handleSaveDetails}
              disabled={savingDetails}
              className="ml-2 px-3 py-1.5 bg-slate-900 text-white border border-slate-900 rounded text-xs font-bold hover:bg-black disabled:opacity-70 inline-flex items-center gap-1"
            >
              {savingDetails ? <Loader2 size={14} className="animate-spin" /> : null}
              {savingDetails ? "Saving..." : "Save Evaluation Criteria"}
            </button>
          </div>

          <button
            onClick={handleSaveDetails}
            disabled={savingDetails}
            className="px-4 py-2 bg-moodle-blue text-white rounded font-bold text-sm disabled:opacity-70 flex items-center gap-2"
          >
            {savingDetails && <Loader2 size={16} className="animate-spin" />}
            Save Course Details
          </button>

          <div className="border-t border-slate-200 pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-800">Session Calendar and Timetable</h4>
              <span className="text-xs text-slate-500">
                Edit session dates here. Changes are reflected on student dashboards.
              </span>
            </div>
            {sessionNotice ? (
              <div
                className={`rounded border px-3 py-2 text-sm ${
                  sessionNotice.type === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                {sessionNotice.text}
              </div>
            ) : null}
            {sessions.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No sessions configured yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 border text-left">Session</th>
                      <th className="px-3 py-2 border text-left">Title</th>
                      <th className="px-3 py-2 border text-left">Date</th>
                      <th className="px-3 py-2 border text-left">Start</th>
                      <th className="px-3 py-2 border text-left">End</th>
                      <th className="px-3 py-2 border text-left">Mode</th>
                      <th className="px-3 py-2 border text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => (
                      <tr key={session.id}>
                        <td className="px-3 py-2 border font-semibold">S{session.session_number}</td>
                        <td className="px-3 py-2 border">
                          <input
                            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                            value={session.title}
                            onChange={(e) => updateSessionRow(session.id, "title", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2 border">
                          <input
                            type="date"
                            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                            value={String(session.session_date).slice(0, 10)}
                            onChange={(e) => updateSessionRow(session.id, "session_date", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2 border">
                          <input
                            type="time"
                            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                            value={session.start_time || ""}
                            onChange={(e) => updateSessionRow(session.id, "start_time", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2 border">
                          <input
                            type="time"
                            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                            value={session.end_time || ""}
                            onChange={(e) => updateSessionRow(session.id, "end_time", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2 border">
                          <select
                            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                            value={session.mode || "classroom"}
                            onChange={(e) => updateSessionRow(session.id, "mode", e.target.value)}
                          >
                            <option value="classroom">Classroom</option>
                            <option value="online">Online</option>
                            <option value="hybrid">Hybrid</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 border">
                          <button
                            onClick={() => saveSession(session.id)}
                            disabled={savingSessionId === session.id}
                            className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-bold disabled:opacity-70"
                          >
                            {savingSessionId === session.id ? "Saving..." : "Save"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-800">Assigned Pre-reads by Section</h4>
              <span className="text-xs text-slate-500">
                These are fetched from DB by section mapping.
              </span>
            </div>
            {materialsBySection.every((section) => section.items.filter((item) => item.is_assigned).length === 0) ? (
              <p className="text-sm text-slate-500 italic">No assigned pre-reads yet.</p>
            ) : (
              <div className="space-y-3">
                {materialsBySection.map((section) => {
                  const assignedItems = section.items.filter((item) => item.is_assigned);
                  return (
                    <div key={section.id} className="border border-slate-200 rounded p-3">
                      <p className="text-sm font-bold text-slate-800 mb-2">{section.title}</p>
                      {assignedItems.length === 0 ? (
                        <p className="text-xs text-slate-500 italic">No assigned material in this section.</p>
                      ) : (
                        <div className="space-y-2">
                          {assignedItems.map((item) => (
                            <div key={item.id} className="text-sm text-slate-700 flex items-center justify-between gap-3">
                              <span className="font-semibold">{item.title}</span>
                              <span className="text-xs text-slate-500">Due: {formatDueDate(item.due_at)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "materials" && (
        <div className="space-y-6">
          <div className="moodle-card p-6 space-y-4">
            <h3 className="text-lg font-bold">Add Reading Material + Assign to Students</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <select
                className="border border-slate-300 rounded px-3 py-2 text-sm"
                value={materialForm.section_id}
                onChange={(e) => setMaterialForm((prev) => ({ ...prev, section_id: e.target.value }))}
              >
                <option value="">Select section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>

              <input
                placeholder="Material title"
                className="border border-slate-300 rounded px-3 py-2 text-sm"
                value={materialForm.title}
                onChange={(e) => setMaterialForm((prev) => ({ ...prev, title: e.target.value }))}
              />

              <select
                className="border border-slate-300 rounded px-3 py-2 text-sm"
                value={materialForm.source_type}
                onChange={(e) =>
                  setMaterialForm((prev) => ({
                    ...prev,
                    source_type: e.target.value,
                    source_url: "",
                    source_file_name: "",
                    source_file_base64: "",
                    content: "",
                  }))
                }
              >
                <option value="pdf">PDF Upload</option>
                <option value="link">Web Link</option>
              </select>

              <label className="text-xs font-semibold text-slate-600 flex flex-col gap-1">
                Due date for students
                <input
                  type="date"
                  className="border border-slate-300 rounded px-3 py-2 text-sm font-normal"
                  value={materialForm.due_at}
                  onChange={(e) => setMaterialForm((prev) => ({ ...prev, due_at: e.target.value }))}
                />
              </label>
            </div>

            {materialForm.source_type === "pdf" && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Upload PDF</p>
                <label className="inline-flex items-center gap-2 cursor-pointer bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  <UploadCloud size={16} />
                  <span>Choose PDF file</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => handlePdfSelected(e.target.files?.[0] || null)}
                  />
                </label>
                {materialForm.source_file_name && (
                  <p className="text-xs text-slate-500 truncate">Selected file: {materialForm.source_file_name}</p>
                )}
              </div>
            )}

            {materialForm.source_type === "link" && (
              <label className="text-sm font-medium text-slate-700 flex flex-col gap-2">
                Web link
                <input
                  type="url"
                  required
                  placeholder="Paste the article or web page URL"
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                  value={materialForm.source_url}
                  onChange={(e) => setMaterialForm((prev) => ({ ...prev, source_url: e.target.value }))}
                />
                <span className="text-xs text-slate-500">
                  This field is required when Web Link is selected.
                </span>
              </label>
            )}

            {pdfStatus && (
              <div className={`flex items-start gap-2 px-3 py-2 rounded text-sm ${
                pdfStatus.toLowerCase().includes("error") ||
                pdfStatus.toLowerCase().includes("could not") ||
                pdfStatus.toLowerCase().includes("failed")
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : pdfStatus.toLowerCase().includes("uploaded successfully") || pdfStatus.toLowerCase().includes("added successfully")
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-blue-50 text-blue-700 border border-blue-200"
              }`}>
                {pdfStatus.toLowerCase().includes("error") || pdfStatus.toLowerCase().includes("could not") || pdfStatus.toLowerCase().includes("failed")
                  ? <AlertCircle size={15} className="shrink-0 mt-0.5" />
                  : pdfStatus.toLowerCase().includes("uploaded successfully") || pdfStatus.toLowerCase().includes("added successfully")
                  ? <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
                  : <Loader2 size={15} className="shrink-0 mt-0.5 animate-spin" />}
                {pdfStatus}
              </div>
            )}

            <div className="mt-2 p-3 border border-slate-200 rounded bg-slate-50 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600">
                Submit saves the material, assigns it to students, and refreshes the reading list.
              </p>
              <button
                onClick={handleUploadMaterial}
                disabled={uploadingMaterial || !canSubmitMaterial}
                className="px-4 py-2 bg-slate-900 border border-slate-900 text-white rounded font-bold text-sm hover:bg-black disabled:opacity-70 flex items-center gap-2 shrink-0"
              >
                {uploadingMaterial ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {materialForm.source_type === "link" ? "Submit Web Link & Assign" : "Submit PDF & Assign"}
              </button>
            </div>
          </div>

          <div className="moodle-card p-6">
            <h3 className="text-lg font-bold mb-4">Existing Materials (Section-wise)</h3>
            <div className="space-y-4">
              {materials.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No materials uploaded yet.</p>
              ) : (
                materialsBySection.map((section) => (
                  <div key={section.id} className="border border-slate-200 rounded p-4">
                    <h4 className="text-sm font-bold text-slate-800 mb-3">{section.title}</h4>
                    {section.items.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No materials in this section yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {section.items.map((m) => (
                          <div key={m.id} className="border border-slate-200 rounded p-3">
                            <div className="flex justify-between items-center gap-3 flex-wrap">
                              <div>
                                <p className="font-bold text-slate-800">{m.title}</p>
                                <p className="text-xs text-slate-500">
                                  {m.source_type} • {m.quiz_count || 0} questions • Due: {formatDueDate(m.due_at)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`text-xs px-2 py-1 rounded-full font-bold ${
                                    m.is_assigned
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-amber-100 text-amber-700"
                                  }`}
                                >
                                  {m.is_assigned ? "Assigned" : "Draft"}
                                </span>
                                <button
                                  onClick={() => handleToggleAssign(m.id, !m.is_assigned)}
                                  disabled={assigningMaterialId === m.id}
                                  className="px-3 py-1.5 border border-slate-300 rounded text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-70"
                                >
                                  {assigningMaterialId === m.id
                                    ? "Saving..."
                                    : m.is_assigned
                                      ? "Unassign"
                                      : "Assign"}
                                </button>
                                <button
                                  onClick={() => handleDeleteMaterial(m.id)}
                                  disabled={deletingMaterialId === m.id}
                                  className="px-3 py-1.5 border border-red-200 rounded text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-70"
                                >
                                  {deletingMaterialId === m.id ? "Deleting..." : "Delete"}
                                </button>
                                <button
                                  onClick={() => handleRegenerateQuiz(m.id)}
                                  disabled={regeneratingMaterialId === m.id}
                                  className="px-3 py-1.5 border border-slate-300 rounded text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-70"
                                >
                                  {regeneratingMaterialId === m.id ? "Regenerating..." : "Regenerate Quiz"}
                                </button>
                                {m.source_type === "pdf" ? (
                                  <button
                                    onClick={() => openPdfMaterial(m.id)}
                                    className="px-3 py-1.5 border border-slate-300 rounded text-xs font-bold text-slate-700 hover:bg-slate-50"
                                  >
                                    View PDF
                                  </button>
                                ) : null}
                                {m.source_type === "link" && m.source_url ? (
                                  <a
                                    href={m.source_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-3 py-1.5 border border-slate-300 rounded text-xs font-bold text-slate-700 hover:bg-slate-50"
                                  >
                                    Open Link
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "participants" && (
        <div className="moodle-card p-6">
          <ParticipantEnrollmentPanel
            title="Participants"
            participants={participants}
            allStudents={allStudents}
            notice={enrolNotice}
            onAddParticipant={handleEnrol}
            addingId={enrollingId}
            addLabel="Enrol"
            addingLabel="Enrolling..."
            selectionMode="multi"
            selectedCandidateIds={selectedCandidateIds}
            onToggleCandidate={toggleCandidateSelection}
            onSelectAllCandidates={selectAllCandidates}
            onSubmitSelected={handleBulkEnrol}
            submittingSelected={bulkEnrolling}
            submitSelectedLabel="Enroll selected students"
            submittingSelectedLabel="Enrolling..."
            candidatesSubtitle="Available students"
            participantsSubtitle="Enrolled students"
            emptyCandidatesText="All students are already enrolled."
            emptyParticipantsText="No participants yet."
          />
        </div>
      )}

      {activeTab === "analytics" && (() => {
        const perMaterial: any[] = quizAnalytics?.per_material || [];
        return (
        <div className="space-y-6">

          {/* ── Quiz Overview ── */}
          <div className="moodle-card p-6 space-y-5">
            <h3 className="text-lg font-bold text-slate-800">Quiz Performance Overview</h3>
            {(quizAnalytics?.attempts || 0) === 0 ? (
              <p className="text-sm text-slate-400 italic">No quiz attempts yet.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Total Attempts</p>
                  <p className="text-3xl font-black text-slate-800">{quizAnalytics?.attempts || 0}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Class Average</p>
                  <p className={`text-3xl font-black ${(quizAnalytics?.average_percentage || 0) >= 70 ? "text-emerald-600" : (quizAnalytics?.average_percentage || 0) >= 50 ? "text-amber-500" : "text-red-500"}`}>
                    {quizAnalytics?.average_percentage || 0}%
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Highest Score</p>
                  <p className="text-3xl font-black text-emerald-600">{quizAnalytics?.highest_percentage || 0}%</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Top Performer</p>
                  <p className="text-sm font-bold text-slate-800 mt-1 truncate">{quizAnalytics?.top_performer?.name || "—"}</p>
                  <p className="text-xs text-slate-400">{quizAnalytics?.top_performer?.average_percentage || 0}% avg</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Per Pre-read Breakdown ── */}
          {perMaterial.length > 0 && (() => {
            const activeMat = perMaterial.find((m: any) => m.material_id === selectedMaterialId) || perMaterial[0];
            return (
              <div className="moodle-card p-6 space-y-5">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">Pre-read Quiz Breakdown</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Question-level wrong-answer rate for the selected pre-read.</p>
                  </div>
                  {perMaterial.length > 1 && (
                    <select
                      value={selectedMaterialId ?? perMaterial[0].material_id}
                      onChange={(e) => setSelectedMaterialId(Number(e.target.value))}
                      className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-moodle-blue"
                    >
                      {perMaterial.map((m: any) => (
                        <option key={m.material_id} value={m.material_id}>{m.title}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Summary stats for selected pre-read */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 rounded-xl p-4 text-center">
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Students Attempted</p>
                    <p className="text-3xl font-black text-slate-800">{activeMat.student_attempts}</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 text-center">
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Avg Score</p>
                    <p className={`text-3xl font-black ${activeMat.avg_pct >= 70 ? "text-emerald-600" : activeMat.avg_pct >= 50 ? "text-amber-500" : "text-red-500"}`}>
                      {activeMat.avg_pct}%
                    </p>
                  </div>
                </div>

                {/* Question-by-question wrong answer rate */}
                {activeMat.questions.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">No question-level data yet.</p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Wrong answer rate per question</p>
                    {activeMat.questions.map((q: any) => (
                      <div key={q.question_id} className="space-y-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <span className={`text-[10px] font-black shrink-0 mt-0.5 ${q.wrong_pct >= 60 ? "text-red-600" : q.wrong_pct >= 35 ? "text-amber-600" : "text-slate-400"}`}>
                              Q{q.question_order}
                            </span>
                            <p className="text-xs text-slate-700 leading-snug">{q.question_text}</p>
                          </div>
                          <span className={`text-sm font-black shrink-0 ${q.wrong_pct >= 60 ? "text-red-600" : q.wrong_pct >= 35 ? "text-amber-600" : "text-emerald-600"}`}>
                            {q.wrong_pct}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden ml-5">
                          <div
                            className={`h-full rounded-full transition-all ${q.wrong_pct >= 60 ? "bg-red-500" : q.wrong_pct >= 35 ? "bg-amber-400" : "bg-emerald-400"}`}
                            style={{ width: `${q.wrong_pct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-slate-400 ml-5">{q.total_attempts} attempt{q.total_attempts !== 1 ? 's' : ''} · {q.wrong_count} wrong</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Pre-read Engagement ── */}
          <div className="moodle-card p-6 space-y-5">
            <h3 className="text-lg font-bold text-slate-800">Pre-read Engagement</h3>
            {preReadAnalyticsLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 size={28} className="animate-spin text-moodle-blue" />
              </div>
            ) : !preReadAnalytics ? (
              <p className="text-sm text-slate-400 italic">No pre-read data yet.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-50 rounded-xl p-4 text-center">
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Enrolled</p>
                    <p className="text-3xl font-black text-slate-800">{preReadAnalytics.summary.total_students}</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 text-center">
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Opened a Reading</p>
                    <p className="text-3xl font-black text-moodle-blue">{preReadAnalytics.summary.opened_any}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {preReadAnalytics.summary.total_students > 0 ? Math.round((preReadAnalytics.summary.opened_any / preReadAnalytics.summary.total_students) * 100) : 0}%
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 text-center">
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Took a Quiz</p>
                    <p className="text-3xl font-black text-emerald-600">{preReadAnalytics.summary.completed_any_quiz}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {preReadAnalytics.summary.total_students > 0 ? Math.round((preReadAnalytics.summary.completed_any_quiz / preReadAnalytics.summary.total_students) * 100) : 0}%
                    </p>
                  </div>
                </div>

                {(() => {
                  const notStarted = preReadAnalytics.students.filter((s) => Number(s.opened_readings) === 0);
                  if (notStarted.length === 0) return null;
                  return (
                    <div className="p-4 border border-amber-200 bg-amber-50 rounded-xl">
                      <p className="text-sm font-bold text-amber-700 mb-2">
                        {notStarted.length} student{notStarted.length > 1 ? 's' : ''} haven't opened any reading yet
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {notStarted.map((s) => (
                          <span key={s.student_id} className="bg-white border border-amber-200 text-amber-800 text-xs font-semibold px-2.5 py-1 rounded-full">
                            {s.student_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      <tr>
                        <th className="px-4 py-3 text-left">Student</th>
                        <th className="px-4 py-3 text-center">Assigned</th>
                        <th className="px-4 py-3 text-center">Opened</th>
                        <th className="px-4 py-3 text-center">Read</th>
                        <th className="px-4 py-3 text-center">Quiz Done</th>
                        <th className="px-4 py-3 text-center">Avg %</th>
                        <th className="px-4 py-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preReadAnalytics.students.map((s) => {
                        const assigned = Number(s.assigned_readings);
                        const quizDone = Number(s.quiz_completed_readings);
                        const pct = assigned > 0 ? Math.round((quizDone / assigned) * 100) : 0;
                        const statusColor = pct === 100 ? "text-emerald-600 bg-emerald-50" : pct >= 50 ? "text-amber-600 bg-amber-50" : "text-red-600 bg-red-50";
                        const statusLabel = pct === 100 ? "Complete" : pct > 0 ? "In Progress" : "Not Started";
                        return (
                          <tr key={s.student_id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3">
                              <p className="font-semibold text-slate-800">{s.student_name}</p>
                              <p className="text-xs text-slate-400">{s.student_email}</p>
                            </td>
                            <td className="px-4 py-3 text-center font-bold text-slate-700">{s.assigned_readings}</td>
                            <td className="px-4 py-3 text-center text-slate-600">{s.opened_readings}</td>
                            <td className="px-4 py-3 text-center text-slate-600">{s.read_readings}</td>
                            <td className="px-4 py-3 text-center font-bold text-moodle-blue">{s.quiz_completed_readings}</td>
                            <td className="px-4 py-3 text-center">
                              {s.avg_quiz_percent != null ? (
                                <span className={`font-bold ${Number(s.avg_quiz_percent) >= 70 ? "text-emerald-600" : Number(s.avg_quiz_percent) >= 50 ? "text-amber-600" : "text-red-500"}`}>
                                  {Number(s.avg_quiz_percent).toFixed(0)}%
                                </span>
                              ) : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${statusColor}`}>{statusLabel}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

        </div>
        );
      })()}

      {/* ── Feedback Tab (faculty only) ───────────────────────────────────── */}
      {activeTab === "feedback" && (
        <div className="space-y-6">
          {/* Loading state */}
          {(feedbackAnalyticsLoading || textFeedbackLoading) && (
            <div className="flex items-center gap-2 text-slate-400 py-10 justify-center">
              <Loader2 size={20} className="animate-spin" /> Loading feedback data…
            </div>
          )}

          {/* No data state */}
          {!feedbackAnalyticsLoading && !textFeedbackLoading && feedbackAnalytics.length === 0 && (
            <div className="moodle-card p-8 text-center text-slate-400">
              <MessageSquareText size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">No feedback forms have been triggered yet.</p>
              <p className="text-xs mt-1">Feedback forms are auto-created when students hit the configured session milestone.</p>
            </div>
          )}

          {/* One card per feedback form */}
          {feedbackAnalytics.map((form) => {
            const formLabel = form.form_type === 'end_course' ? 'End Course Feedback' : 'Early Course Feedback';
            const textQsForForm = textFeedbackData.filter(q => q.form_type === (form.form_type as any) || (!form.form_type && q.form_type === 'early_course'));

            return (
              <div key={form.form_id} className="moodle-card overflow-hidden">
                {/* Form header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-moodle-blue">{formLabel}</p>
                    <h3 className="text-base font-bold text-slate-800 mt-0.5">Session {form.trigger_session_number} Feedback</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Open: {new Date(form.open_at).toLocaleDateString()} · Due: {new Date(form.due_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2">
                    <Users size={14} className="text-slate-400" />
                    <span className="text-xl font-black text-slate-800">{form.submissions}</span>
                    <span className="text-xs text-slate-500 font-medium">submission{form.submissions !== 1 ? 's' : ''}</span>
                  </div>
                </div>

                {form.submissions === 0 ? (
                  <div className="px-6 py-8 text-center text-slate-400">
                    <p className="text-sm">No responses yet. Check back after the due date.</p>
                  </div>
                ) : (
                  <div className="p-6 space-y-6">
                    {/* MCQ questions */}
                    {form.metrics.filter(m => m.question_type === 'mcq').length > 0 && (
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Rating Questions</h4>
                        {form.metrics.filter(m => m.question_type === 'mcq').map((metric) => {
                          const pct = metric.options?.length
                            ? Math.round(((metric.average ?? 0) / metric.options.length) * 100)
                            : 0;
                          return (
                            <div key={metric.question_id} className="space-y-2">
                              <div className="flex items-start justify-between gap-4">
                                <p className="text-sm font-medium text-slate-700 flex-1">{metric.question_text}</p>
                                <div className="text-right shrink-0">
                                  <span className="text-lg font-black text-slate-800">{(metric.average ?? 0).toFixed(1)}</span>
                                  <span className="text-xs text-slate-400 ml-1">/ {metric.options?.length ?? 5}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${pct >= 70 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-400' : 'bg-red-400'}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-slate-500 w-16 text-right">{metric.responses ?? 0} response{(metric.responses ?? 0) !== 1 ? 's' : ''}</span>
                              </div>
                              {metric.options && (
                                <div className="flex justify-between text-[10px] text-slate-400 px-0.5">
                                  <span>{metric.options[0]}</span>
                                  <span>{metric.options[metric.options.length - 1]}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Text questions with single combined AI summary */}
                    {textQsForForm.length > 0 && (() => {
                      const combinedKey = `form_${form.form_id}`;
                      const combinedSummary = feedbackSummaries[combinedKey];
                      const hasAnyResponses = textQsForForm.some(q => q.responses.length > 0);
                      return (
                        <div className="space-y-4">
                          <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Open-ended Questions</h4>

                          {/* Single AI Summary box for all open-ended questions */}
                          <div className="rounded-xl border-2 border-violet-200 overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-3 bg-violet-600">
                              <div className="flex items-center gap-2 text-white">
                                <Sparkles size={15} />
                                <span className="text-sm font-bold">AI Summary</span>
                                <span className="text-violet-200 text-xs font-normal">— across all open-ended responses</span>
                              </div>
                              {hasAnyResponses && (
                                <button
                                  onClick={() => generateCombinedFormSummary(form.form_id, textQsForForm)}
                                  disabled={combinedSummary?.loading}
                                  className="flex items-center gap-1.5 px-4 py-1.5 bg-white text-violet-700 rounded-lg text-xs font-bold hover:bg-violet-50 disabled:opacity-60 shrink-0"
                                >
                                  {combinedSummary?.loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                  {combinedSummary?.loading ? "Generating…" : combinedSummary?.summary ? "Regenerate" : "Summarise with AI"}
                                </button>
                              )}
                            </div>
                            <div className="px-5 py-4 bg-violet-50 min-h-[72px]">
                              {combinedSummary?.loading ? (
                                <div className="flex items-center gap-2 text-violet-400 py-2">
                                  <Loader2 size={14} className="animate-spin" />
                                  <span className="text-sm">Analysing all student responses…</span>
                                </div>
                              ) : combinedSummary?.summary ? (
                                <div className="space-y-3">
                                  <p className="text-sm text-slate-800 leading-relaxed">{combinedSummary.summary}</p>
                                  {combinedSummary.keyTakeaways.length > 0 && (
                                    <div className="space-y-1.5">
                                      <p className="text-[10px] font-bold uppercase tracking-widest text-violet-500">Key Takeaways</p>
                                      {combinedSummary.keyTakeaways.map((kt, ki) => (
                                        <div key={ki} className="flex items-start gap-2 text-xs text-slate-700">
                                          <span className="w-4 h-4 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">{ki + 1}</span>
                                          <span>{kt}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-violet-400 italic py-1">Click "Summarise with AI" to generate a combined summary of all open-ended responses.</p>
                              )}
                            </div>
                          </div>

                          {/* Individual questions with their responses */}
                          {textQsForForm.map((q) => {
                            const showResponses = !!expandedResponses[q.question_id];
                            return (
                              <div key={q.question_id} className="border border-slate-200 rounded-xl overflow-hidden">
                                <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">{q.question_text}</p>
                                    <p className="text-xs text-slate-400 mt-0.5">{q.responses.length} response{q.responses.length !== 1 ? 's' : ''}</p>
                                  </div>
                                  {q.responses.length > 0 && (
                                    <button
                                      onClick={() => setExpandedResponses(prev => ({ ...prev, [q.question_id]: !prev[q.question_id] }))}
                                      className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 shrink-0"
                                    >
                                      {showResponses ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                      {showResponses ? "Hide" : "Show"} responses
                                    </button>
                                  )}
                                </div>
                                {showResponses && (
                                  <div className="px-5 py-3 space-y-2 max-h-64 overflow-y-auto">
                                    {q.responses.map((r, ri) => (
                                      <div key={ri} className="bg-slate-50 border border-slate-100 rounded-lg px-4 py-3">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Anonymous</p>
                                        <p className="text-sm text-slate-700 leading-relaxed">{r.answer_text}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Attendance Tab (faculty only) ─────────────────────────────────── */}
      {activeTab === "attendance" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <ClipboardList size={20} className="text-moodle-blue" />
            <h3 className="text-lg font-bold text-slate-800">Session Attendance</h3>
            <span className="ml-auto text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
              {totalEnrolled} students enrolled
            </span>
          </div>

          {attendanceLoading ? (
            <div className="flex items-center gap-2 text-slate-400 py-10 justify-center">
              <Loader2 size={20} className="animate-spin" /> Loading sessions…
            </div>
          ) : attendanceSummary.length === 0 ? (
            <div className="moodle-card p-8 text-center text-slate-400">
              No sessions found for this course.
            </div>
          ) : (
            <div className="moodle-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] uppercase tracking-widest text-slate-400">
                    <th className="text-left px-4 py-3 font-bold">Session</th>
                    <th className="text-left px-4 py-3 font-bold">Date</th>
                    <th className="text-center px-4 py-3 font-bold">Present</th>
                    <th className="text-center px-4 py-3 font-bold">Absent</th>
                    <th className="text-center px-4 py-3 font-bold">Late</th>
                    <th className="text-center px-4 py-3 font-bold">Marked</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {attendanceSummary.map((row) => (
                    <tr key={row.session_id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">
                        S{row.session_number}: {row.session_title}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(row.session_date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-emerald-600">{row.present_count ?? 0}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-red-500">{row.absent_count ?? 0}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-amber-500">{row.late_count ?? 0}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {Number(row.marked_count) > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                            <UserCheck size={10} /> Marked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openAttendanceSession(row)}
                          className="px-3 py-1.5 text-xs font-bold text-moodle-blue border border-moodle-blue/30 rounded-lg hover:bg-moodle-blue hover:text-white transition-colors"
                        >
                          {Number(row.marked_count) > 0 ? "Edit" : "Mark Attendance"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Session detail panel */}
          {selectedAttendanceSession && (
            <div className="moodle-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-800">
                    S{selectedAttendanceSession.session_number}: {selectedAttendanceSession.session_title}
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(selectedAttendanceSession.session_date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </div>
                <button onClick={() => setSelectedAttendanceSession(null)} className="text-slate-400 hover:text-slate-700">✕</button>
              </div>

              {attendanceNotice && (
                <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${attendanceNotice.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  {attendanceNotice.type === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  {attendanceNotice.text}
                </div>
              )}

              {sessionStudentsLoading ? (
                <div className="flex items-center gap-2 text-slate-400 py-6 justify-center">
                  <Loader2 size={18} className="animate-spin" /> Loading students…
                </div>
              ) : sessionStudents.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No students enrolled.</p>
              ) : (
                <div className="space-y-2">
                  {/* Quick-select row */}
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <span className="text-xs font-semibold text-slate-500 mr-1">Mark all:</span>
                    {["present", "absent", "late", "excused"].map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          const next: Record<number, { status: string; note: string }> = {};
                          for (const st of sessionStudents) {
                            next[st.student_id] = { status: s, note: attendanceEdits[st.student_id]?.note || "" };
                          }
                          setAttendanceEdits(next);
                        }}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-full border capitalize transition-colors
                          ${s === "present" ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          : s === "absent" ? "border-red-300 text-red-600 hover:bg-red-50"
                          : s === "late" ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                          : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>

                  {sessionStudents.map((st) => {
                    const edit = attendanceEdits[st.student_id] || { status: "present", note: "" };
                    const statusColour =
                      edit.status === "present" ? "border-l-emerald-500 bg-emerald-50/30"
                      : edit.status === "absent" ? "border-l-red-500 bg-red-50/30"
                      : edit.status === "late" ? "border-l-amber-500 bg-amber-50/30"
                      : "border-l-slate-400 bg-slate-50";

                    return (
                      <div key={st.student_id} className={`flex items-center gap-3 p-3 rounded-lg border-l-2 ${statusColour}`}>
                        <div className="w-8 h-8 rounded-full bg-moodle-blue/10 flex items-center justify-center">
                          <Users size={14} className="text-moodle-blue" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{st.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">{st.email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={edit.status}
                            onChange={(e) => setAttendanceEdits(prev => ({ ...prev, [st.student_id]: { ...edit, status: e.target.value } }))}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:ring-1 focus:ring-moodle-blue focus:outline-none font-medium"
                          >
                            <option value="present">Present</option>
                            <option value="absent">Absent</option>
                            <option value="late">Late</option>
                            <option value="excused">Excused</option>
                          </select>
                          <input
                            type="text"
                            value={edit.note}
                            onChange={(e) => setAttendanceEdits(prev => ({ ...prev, [st.student_id]: { ...edit, note: e.target.value } }))}
                            placeholder="Note (optional)"
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-32 bg-white focus:ring-1 focus:ring-moodle-blue focus:outline-none"
                          />
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={saveAttendance}
                      disabled={savingAttendance}
                      className="flex items-center gap-2 px-5 py-2 bg-moodle-blue text-white text-sm font-bold rounded-xl hover:bg-moodle-blue/90 disabled:opacity-60 transition-colors"
                    >
                      {savingAttendance ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {savingAttendance ? "Saving…" : "Save Attendance"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="animate-in fade-in duration-500 space-y-6">
      <div>
        <button onClick={onBack} className="text-sm text-moodle-blue hover:underline">
          Back
        </button>
        <h1 className="text-3xl font-bold text-slate-800 mt-1">{course.name}</h1>
        <p className="text-sm text-slate-500">{course.code}</p>
      </div>

      {role === "student" ? renderStudentCourse() : renderFacultyCourse()}

      {quizModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">{quizModal.title} - 5Q Quiz</h3>
              <button onClick={() => setQuizModal(null)} className="text-slate-500 hover:text-slate-800">
                Close
              </button>
            </div>

            {quizModal.questions.map((q, idx) => (
              <div key={q.id} className="border border-slate-200 rounded p-4">
                <p className="font-semibold text-slate-800 mb-3">
                  Q{idx + 1}. {q.question}
                </p>
                <div className="space-y-2">
                  {q.options.map((option, optionIdx) => (
                    <label key={optionIdx} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        checked={quizModal.answers[idx] === optionIdx}
                        onChange={() =>
                          setQuizModal((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  answers: prev.answers.map((a, i) => (i === idx ? optionIdx : a)),
                                }
                              : prev
                          )
                        }
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between">
              <button
                onClick={submitQuiz}
                disabled={quizModal.submitting}
                className="px-4 py-2 bg-moodle-blue text-white rounded font-bold text-sm disabled:opacity-70"
              >
                {quizModal.submitting ? "Submitting..." : "Submit Quiz"}
              </button>
              {quizModal.result && (
                <div className="text-sm font-bold text-emerald-600">
                  Score: {quizModal.result.score}/{quizModal.result.total}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CourseManagement;
