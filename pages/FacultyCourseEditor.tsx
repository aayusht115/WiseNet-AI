import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";
import ParticipantEnrollmentPanel, {
  ParticipantUser,
} from "../components/ParticipantEnrollmentPanel";
import { Course, CourseDetail, CourseSession, EvaluationComponent } from "../types";

interface FacultyCourseEditorProps {
  courseId?: number;
  onSave: () => void;
  onSaveAndDisplay?: (courseId: number) => void;
  onCancel: () => void;
}

interface EditableSession {
  id: number;
  session_number: number;
  title: string;
  session_date: string;
  start_time: string;
  end_time: string;
  mode: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
type CourseCodeValidationStatus = "idle" | "checking" | "available" | "taken" | "error";

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeCredits = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  if (parsed <= 1) return 1;
  if (parsed >= 3) return 3;
  return Math.round(parsed);
};

const sessionsFromCredits = (credits: number) => normalizeCredits(credits) * 9;

const normalizeDateOnly = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match?.[1]) return match[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const createEvaluationRow = (index: number): EvaluationComponent => ({
  sr_no: index,
  component: "",
  code: "",
  weightage_percent: 0,
  timeline: "",
  scheduled_date: "",
  clos_mapped: "",
});

const buildAutoSessionPlan = (startDate: string, endDate: string, credits: number): EditableSession[] => {
  const normalizedStart = normalizeDateOnly(startDate);
  const normalizedEnd = normalizeDateOnly(endDate);
  if (!normalizedStart || !normalizedEnd) return [];
  const start = new Date(`${normalizedStart}T00:00:00Z`);
  const end = new Date(`${normalizedEnd}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return [];
  }

  const totalSessions = sessionsFromCredits(credits);
  const totalDays = Math.max(0, Math.floor((end.getTime() - start.getTime()) / DAY_MS));
  const offsets: number[] = [];

  for (let i = 0; i < totalSessions; i += 1) {
    if (totalSessions === 1) {
      offsets.push(0);
      continue;
    }
    const remaining = totalSessions - i - 1;
    const minOffset = i === 0 ? 0 : offsets[i - 1] + 1;
    const maxOffset = totalDays - remaining;
    const target = Math.round((i * totalDays) / (totalSessions - 1));
    offsets.push(Math.min(maxOffset, Math.max(minOffset, target)));
  }

  return offsets.map((offset, idx) => {
    const date = new Date(start.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
    return {
      id: idx + 1,
      session_number: idx + 1,
      title: `Session ${idx + 1}`,
      session_date: date,
      start_time: "09:00",
      end_time: "10:30",
      mode: "classroom",
    };
  });
};

const FacultyCourseEditor: React.FC<FacultyCourseEditorProps> = ({
  courseId,
  onSave,
  onSaveAndDisplay,
  onCancel,
}) => {
  const today = formatDateInput(new Date());
  const defaultEndDate = (() => {
    const next = new Date();
    next.setDate(next.getDate() + 120);
    return formatDateInput(next);
  })();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const codeCheckRequestRef = useRef(0);

  const [formData, setFormData] = useState<Partial<Course>>({
    name: "",
    code: "",
    instructor: "",
    visibility: "show",
    credits: 1,
    start_date: today,
    end_date: defaultEndDate,
    description: "",
    image_url: "",
  });
  const [details, setDetails] = useState<CourseDetail>({
    faculty_info: "",
    teaching_assistant: "",
    credits: 1,
    feedback_trigger_session: 4,
    learning_outcomes: [],
    evaluation_components: [createEvaluationRow(1)],
  });
  const [sessions, setSessions] = useState<EditableSession[]>([]);
  const [allStudents, setAllStudents] = useState<ParticipantUser[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<ParticipantUser[]>([]);

  const [fetchingCourse, setFetchingCourse] = useState(false);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [codeValidation, setCodeValidation] = useState<{ status: CourseCodeValidationStatus; message: string }>({
    status: "idle",
    message: "",
  });
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [imageProcessing, setImageProcessing] = useState(false);

  // Pre-read upload state
  const prereadFileInputRef = useRef<HTMLInputElement | null>(null);
  const [courseSections, setCourseSections] = useState<{ id: number; title: string }[]>([]);
  const [prereadSectionId, setPrereadSectionId] = useState("");
  const [prereadTitle, setPrereadTitle] = useState("");
  const [prereadFile, setPrereadFile] = useState<File | null>(null);
  const [prereadUploading, setPrereadUploading] = useState(false);
  const [prereadSuccess, setPrereadSuccess] = useState("");
  const [courseMaterials, setCourseMaterials] = useState<{ id: number; title: string; section_id: number }[]>([]);

  const normalizedCredits = normalizeCredits(formData.credits);
  const expectedSessions = sessionsFromCredits(normalizedCredits);
  const evaluationTotal = useMemo(
    () =>
      (details.evaluation_components || []).reduce(
        (sum, row) => sum + (Number(row.weightage_percent) || 0),
        0
      ),
    [details.evaluation_components]
  );
  const outcomesText = useMemo(() => (details.learning_outcomes || []).join("\n"), [details.learning_outcomes]);

  const loadStudents = async () => {
    setLoadingStudents(true);
    try {
      const response = await fetch("/api/students");
      if (!response.ok) return;
      const students = await response.json();
      setAllStudents(Array.isArray(students) ? students : []);
    } catch {
      // Keep UI usable if this optional fetch fails.
    } finally {
      setLoadingStudents(false);
    }
  };

  const validateCourseCode = async (
    courseCode: string,
    options?: { showChecking?: boolean }
  ): Promise<CourseCodeValidationStatus> => {
    const trimmedCode = String(courseCode || "").trim();
    if (!trimmedCode) {
      setCodeValidation({ status: "idle", message: "" });
      return "idle";
    }

    const requestId = codeCheckRequestRef.current + 1;
    codeCheckRequestRef.current = requestId;
    if (options?.showChecking ?? true) {
      setCodeValidation({ status: "checking", message: "Checking Course ID..." });
    }

    const params = new URLSearchParams({ code: trimmedCode });
    if (courseId) params.set("exclude_course_id", String(courseId));
    try {
      const response = await fetch(`/api/courses/check-code?${params.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Could not validate Course ID." }));
        if (codeCheckRequestRef.current === requestId) {
          setCodeValidation({
            status: "error",
            message: payload.error || "Could not validate Course ID.",
          });
        }
        return "error";
      }
      const payload = await response.json();
      const status: CourseCodeValidationStatus = payload?.available ? "available" : "taken";
      if (codeCheckRequestRef.current === requestId) {
        setCodeValidation({
          status,
          message:
            payload?.message ||
            (payload?.available ? "Course ID is available." : "Course ID is already in use."),
        });
      }
      return status;
    } catch {
      if (codeCheckRequestRef.current === requestId) {
        setCodeValidation({
          status: "error",
          message: "Could not validate Course ID right now.",
        });
      }
      return "error";
    }
  };

  const regenerateSchedule = () => {
    const generated = buildAutoSessionPlan(
      String(formData.start_date || ""),
      String(formData.end_date || ""),
      normalizedCredits
    );
    setSessions(generated);
  };

  useEffect(() => {
    loadStudents();
  }, []);

  useEffect(() => {
    const nextCode = String(formData.code || "").trim();
    if (!nextCode) {
      setCodeValidation({ status: "idle", message: "" });
      return;
    }
    const timeout = window.setTimeout(() => {
      void validateCourseCode(nextCode, { showChecking: true });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [formData.code, courseId]);

  useEffect(() => {
    if (!courseId) {
      regenerateSchedule();
      return;
    }

    const fetchCourseData = async () => {
      setFetchingCourse(true);
      setError("");
      try {
        const [courseRes, detailsRes, sessionsRes, participantsRes, sectionsRes, materialsRes] = await Promise.all([
          fetch(`/api/courses/${courseId}`),
          fetch(`/api/course-details/${courseId}`),
          fetch(`/api/courses/${courseId}/sessions`),
          fetch(`/api/courses/${courseId}/participants`),
          fetch(`/api/courses/${courseId}/sections`),
          fetch(`/api/courses/${courseId}/materials`),
        ]);

        if (!courseRes.ok || !detailsRes.ok) {
          setError("Could not load course details.");
          return;
        }

        const courseData = await courseRes.json();
        const detailsData = await detailsRes.json();
        const sessionsData = sessionsRes.ok ? await sessionsRes.json() : [];
        const participantsData = participantsRes.ok ? await participantsRes.json() : [];

        setFormData({
          ...courseData,
          credits: normalizeCredits(courseData?.credits),
          start_date: normalizeDateOnly(courseData?.start_date),
          end_date: normalizeDateOnly(courseData?.end_date),
          visibility: courseData?.visibility === "hide" ? "hide" : "show",
        });

        const incomingDetails = detailsData?.details || {};
        const incomingEvaluation = Array.isArray(incomingDetails.evaluation_components)
          ? incomingDetails.evaluation_components
          : [];
        setDetails({
          faculty_info: incomingDetails.faculty_info || "",
          teaching_assistant: incomingDetails.teaching_assistant || "",
          credits: normalizeCredits(incomingDetails.credits || courseData?.credits || 1),
          feedback_trigger_session: Number(incomingDetails.feedback_trigger_session || 4),
          learning_outcomes: Array.isArray(incomingDetails.learning_outcomes)
            ? incomingDetails.learning_outcomes
            : [],
          evaluation_components:
            incomingEvaluation.length > 0
              ? incomingEvaluation.map((row: EvaluationComponent, idx: number) => ({
                  ...row,
                  sr_no: idx + 1,
                  weightage_percent: Number(row.weightage_percent) || 0,
                }))
              : [createEvaluationRow(1)],
        });

        const normalizedSessions = (Array.isArray(sessionsData) ? sessionsData : [])
          .map((session: CourseSession, idx: number) => ({
            id: Number(session.id || idx + 1),
            session_number: Number(session.session_number || idx + 1),
            title: String(session.title || `Session ${idx + 1}`),
            session_date: normalizeDateOnly(session.session_date),
            start_time: String(session.start_time || "09:00"),
            end_time: String(session.end_time || "10:30"),
            mode: String(session.mode || "classroom"),
          }))
          .sort((a: EditableSession, b: EditableSession) => {
            if (a.session_date === b.session_date) return a.session_number - b.session_number;
            return a.session_date.localeCompare(b.session_date);
          })
          .map((session: EditableSession, idx: number) => ({ ...session, session_number: idx + 1 }));
        setSessions(normalizedSessions);
        setSelectedParticipants(Array.isArray(participantsData) ? participantsData : []);

        const sectionsData = sectionsRes.ok ? await sectionsRes.json() : [];
        const materialsData = materialsRes.ok ? await materialsRes.json() : [];
        const secs = Array.isArray(sectionsData) ? sectionsData : [];
        setCourseSections(secs);
        if (secs.length > 0) setPrereadSectionId(String(secs[0].id));
        setCourseMaterials(Array.isArray(materialsData) ? materialsData : []);
      } catch {
        setError("Could not load course details.");
      } finally {
        setFetchingCourse(false);
      }
    };

    fetchCourseData();
  }, [courseId]);

  const updateEvaluationRow = (index: number, key: keyof EvaluationComponent, value: string | number) => {
    setDetails((prev) => {
      const rows = [...(prev.evaluation_components || [])];
      const current = rows[index] || createEvaluationRow(index + 1);
      rows[index] = {
        ...current,
        sr_no: index + 1,
        [key]: key === "weightage_percent" ? Number(value) || 0 : String(value),
      } as EvaluationComponent;
      return { ...prev, evaluation_components: rows };
    });
  };

  const addEvaluationRow = () => {
    setDetails((prev) => ({
      ...prev,
      evaluation_components: [...(prev.evaluation_components || []), createEvaluationRow((prev.evaluation_components || []).length + 1)],
    }));
  };

  const removeEvaluationRow = (index: number) => {
    setDetails((prev) => {
      const rows = [...(prev.evaluation_components || [])]
        .filter((_, idx) => idx !== index)
        .map((row, idx) => ({ ...row, sr_no: idx + 1 }));
      return { ...prev, evaluation_components: rows.length > 0 ? rows : [createEvaluationRow(1)] };
    });
  };

  const updateSession = (sessionId: number, key: keyof EditableSession, value: string) => {
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
  };

  const handlePickImage = () => {
    imageInputRef.current?.click();
  };

  const handleImageSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file for the course cover.");
      return;
    }

    setImageProcessing(true);
    try {
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read selected image."));
        reader.readAsDataURL(file);
      });
      setFormData((prev) => ({ ...prev, image_url: imageData }));
      setError("");
    } catch {
      setError("Could not read the selected image.");
    } finally {
      setImageProcessing(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const validateAndNormalizeSessions = () => {
    const startDate = normalizeDateOnly(formData.start_date);
    const endDate = normalizeDateOnly(formData.end_date);

    if (!startDate || !endDate) return { error: "Course start and end dates are required.", rows: [] as EditableSession[] };
    if (sessions.length !== expectedSessions) {
      return {
        error: `This course requires exactly ${expectedSessions} sessions for ${normalizedCredits} credit(s).`,
        rows: [] as EditableSession[],
      };
    }

    const normalizedRows = sessions
      .map((session, idx) => ({
        ...session,
        session_number: Number(session.session_number) || idx + 1,
        title: String(session.title || `Session ${idx + 1}`).trim() || `Session ${idx + 1}`,
        session_date: normalizeDateOnly(session.session_date),
        start_time: String(session.start_time || "09:00"),
        end_time: String(session.end_time || "10:30"),
        mode: String(session.mode || "classroom"),
      }))
      .sort((a, b) => {
        if (a.session_date === b.session_date) return a.session_number - b.session_number;
        return a.session_date.localeCompare(b.session_date);
      })
      .map((session, idx) => ({ ...session, session_number: idx + 1 }));

    if (normalizedRows.some((row) => !row.session_date)) {
      return { error: "Each session needs a valid date.", rows: [] as EditableSession[] };
    }
    if (normalizedRows.some((row) => row.session_date < startDate || row.session_date > endDate)) {
      return {
        error: "Session dates must be between the course start and end dates.",
        rows: [] as EditableSession[],
      };
    }
    if (normalizedRows[0]?.session_date !== startDate) {
      return {
        error: "First session date must match the course start date.",
        rows: [] as EditableSession[],
      };
    }
    if (normalizedRows[normalizedRows.length - 1]?.session_date !== endDate) {
      return {
        error: "Last session date must match the course end date.",
        rows: [] as EditableSession[],
      };
    }

    return { error: "", rows: normalizedRows };
  };

  const submitCourse = async (mode: "return" | "display") => {
    const nextName = String(formData.name || "").trim();
    const nextCode = String(formData.code || "").trim();
    const startDate = normalizeDateOnly(formData.start_date);
    const endDate = normalizeDateOnly(formData.end_date);

    if (!nextName || !nextCode) {
      setError("Course full name and short name are required.");
      return;
    }
    const codeState = await validateCourseCode(nextCode, { showChecking: false });
    if (codeState === "taken") {
      setError("Course ID must be unique. Please choose a different Course ID.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Course start and end dates are required.");
      return;
    }

    const startMs = Date.parse(`${startDate}T00:00:00Z`);
    const endMs = Date.parse(`${endDate}T00:00:00Z`);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
      setError("Course end date must be on or after start date.");
      return;
    }
    const requiredRangeDays = expectedSessions;
    const actualRangeDays = Math.floor((endMs - startMs) / DAY_MS) + 1;
    if (actualRangeDays < requiredRangeDays) {
      setError(
        `${normalizedCredits} credit(s) require ${requiredRangeDays} sessions. Expand date range to at least ${requiredRangeDays} days (inclusive).`
      );
      return;
    }

    const normalizedEvaluation = (details.evaluation_components || []).map((row, idx) => ({
      ...row,
      sr_no: idx + 1,
      weightage_percent: Number(row.weightage_percent) || 0,
    }));
    const totalEvaluationWeight = normalizedEvaluation.reduce(
      (sum, row) => sum + (Number(row.weightage_percent) || 0),
      0
    );
    if (normalizedEvaluation.length > 0 && totalEvaluationWeight !== 100) {
      const message = `Evaluation weightages currently total ${totalEvaluationWeight}%. Please update it to exactly 100%.`;
      setError(message);
      window.alert(message);
      return;
    }

    const sessionValidation = validateAndNormalizeSessions();
    if (sessionValidation.error) {
      setError(sessionValidation.error);
      window.alert(sessionValidation.error);
      return;
    }

    const normalizedFeedbackTrigger = Math.max(
      1,
      Math.min(Number(details.feedback_trigger_session || 4), expectedSessions)
    );

    const payload = {
      name: nextName,
      code: nextCode,
      description: String(formData.description || "").trim() || null,
      instructor: String(formData.instructor || "").trim() || null,
      visibility: formData.visibility === "hide" ? "hide" : "show",
      credits: normalizedCredits,
      start_date: startDate,
      end_date: endDate,
      image_url: String(formData.image_url || "").trim() || null,
      faculty_info: String(details.faculty_info || "").trim() || null,
      teaching_assistant: String(details.teaching_assistant || "").trim() || null,
      learning_outcomes: String(outcomesText || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      evaluation_components: normalizedEvaluation,
      feedback_trigger_session: normalizedFeedbackTrigger,
      sessions: sessionValidation.rows,
      enrolled_student_ids: selectedParticipants.map((student) => student.id),
    };

    setSaving(true);
    setError("");
    setNotice(null);
    try {
      const url = courseId ? `/api/courses/${courseId}` : "/api/courses";
      const method = courseId ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({ error: "Failed to save course." }));
        setError(responseBody.error || "Failed to save course.");
        return;
      }
      const responseBody = await response.json().catch(() => ({}));
      const savedCourseId = Number(courseId || responseBody.id || 0);
      if (!savedCourseId) {
        setError("Course saved but course id was not returned.");
        return;
      }
      setNotice({ type: "success", text: "Course saved successfully." });
      if (mode === "display" && onSaveAndDisplay) {
        onSaveAndDisplay(savedCourseId);
        return;
      }
      onSave();
    } catch {
      setError("Failed to save course.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndReturn = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitCourse("return");
  };

  const handleAddParticipant = (studentId: number) => {
    const student = allStudents.find((row) => row.id === studentId);
    if (!student) return;
    setSelectedParticipants((prev) => {
      if (prev.some((row) => row.id === student.id)) return prev;
      return [...prev, student];
    });
    setNotice(null);
  };

  const handleRemoveParticipant = (studentId: number) => {
    if (courseId) return;
    setSelectedParticipants((prev) => prev.filter((row) => row.id !== studentId));
    setNotice(null);
  };

  const handlePrereadUpload = async () => {
    if (!prereadFile || !prereadSectionId || !courseId) return;
    setPrereadUploading(true);
    setPrereadSuccess("");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(prereadFile);
      });
      const res = await fetch(`/api/courses/${courseId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_id: Number(prereadSectionId),
          title: prereadTitle || prereadFile.name.replace(/\.pdf$/i, ""),
          source_type: "pdf",
          source_file_name: prereadFile.name,
          source_file_base64: base64,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setPrereadSuccess(`"${created.title || prereadTitle || prereadFile.name}" uploaded successfully!`);
        setPrereadFile(null);
        setPrereadTitle("");
        if (prereadFileInputRef.current) prereadFileInputRef.current.value = "";
        const refreshed = await fetch(`/api/courses/${courseId}/materials`);
        if (refreshed.ok) setCourseMaterials(await refreshed.json());
      } else {
        const err = await res.json().catch(() => ({}));
        setPrereadSuccess(`Upload failed: ${err.error || res.statusText}`);
      }
    } catch {
      setPrereadSuccess("Upload failed. Please try again.");
    } finally {
      setPrereadUploading(false);
    }
  };

  return (
    <div className="animate-in fade-in duration-300">
      <h1 className="text-3xl font-bold text-slate-800 mb-2">{courseId ? "Edit Course" : "Add a new course"}</h1>
      <p className="text-sm text-slate-500 mb-6">
        Fill all sections below, then use the final save button at the bottom to create/update the course.
      </p>

      {fetchingCourse ? (
        <div className="py-10 flex justify-center">
          <Loader2 size={30} className="animate-spin text-moodle-blue" />
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          className={`mb-4 rounded border px-4 py-3 text-sm ${
            notice.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <form onSubmit={handleSaveAndReturn} className="moodle-card p-6 space-y-8">
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-800">General</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm font-medium text-slate-700">
              Course full name
              <input
                type="text"
                value={formData.name || ""}
                onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                required
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Course ID (unique short name)
              <input
                type="text"
                value={formData.code || ""}
                onChange={(event) => {
                  const nextCode = event.target.value;
                  setFormData((prev) => ({ ...prev, code: nextCode }));
                  setCodeValidation({ status: "idle", message: "" });
                }}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                required
                placeholder="e.g. DIG501"
              />
              {codeValidation.status !== "idle" ? (
                <p
                  className={`mt-1 text-xs inline-flex items-center gap-1 ${
                    codeValidation.status === "available"
                      ? "text-emerald-700"
                      : codeValidation.status === "taken"
                      ? "text-rose-700"
                      : codeValidation.status === "error"
                      ? "text-amber-700"
                      : "text-slate-500"
                  }`}
                >
                  {codeValidation.status === "checking" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : null}
                  {codeValidation.message}
                </p>
              ) : null}
            </label>
            <label className="text-sm font-medium text-slate-700">
              Instructor
              <input
                type="text"
                value={formData.instructor || ""}
                onChange={(event) => setFormData((prev) => ({ ...prev, instructor: event.target.value }))}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                placeholder="Faculty name"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Visibility
              <select
                value={formData.visibility || "show"}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, visibility: event.target.value as "show" | "hide" }))
                }
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
              >
                <option value="show">Show</option>
                <option value="hide">Hide</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Credits
              <select
                value={normalizedCredits}
                onChange={(event) => {
                  const nextCredits = normalizeCredits(event.target.value);
                  setFormData((prev) => ({ ...prev, credits: nextCredits }));
                  setDetails((prev) => ({
                    ...prev,
                    credits: nextCredits,
                    feedback_trigger_session: Math.min(
                      Number(prev.feedback_trigger_session || 4),
                      sessionsFromCredits(nextCredits)
                    ),
                  }));
                }}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
              >
                <option value={1}>1 Credit</option>
                <option value={2}>2 Credits</option>
                <option value={3}>3 Credits</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Feedback trigger session
              <input
                type="number"
                min={1}
                max={expectedSessions}
                value={Number(details.feedback_trigger_session || 4)}
                onChange={(event) =>
                  setDetails((prev) => ({
                    ...prev,
                    feedback_trigger_session: Math.max(
                      1,
                      Math.min(Number(event.target.value || 1), expectedSessions)
                    ),
                  }))
                }
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
              <p className="text-xs text-slate-500 mt-1">
                Student feedback form will open after this session and remain open for 2 days.
              </p>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Start date
              <input
                type="date"
                value={normalizeDateOnly(formData.start_date)}
                onChange={(event) => setFormData((prev) => ({ ...prev, start_date: event.target.value }))}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              End date
              <input
                type="date"
                value={normalizeDateOnly(formData.end_date)}
                onChange={(event) => setFormData((prev) => ({ ...prev, end_date: event.target.value }))}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
              <p className="text-xs text-slate-500 mt-1">
                {normalizedCredits} credit(s) require {expectedSessions} sessions within this date range.
              </p>
            </label>
          </div>
          <label className="text-sm font-medium text-slate-700 block">
            Description
            <textarea
              rows={4}
              value={formData.description || ""}
              onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
              className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
            />
          </label>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-slate-800">Course Image</h2>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelected}
            className="hidden"
          />
          <div className="border border-dashed border-slate-300 rounded-lg p-4 bg-slate-50 space-y-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePickImage}
                className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-bold inline-flex items-center gap-2"
              >
                {imageProcessing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Upload image
              </button>
              {formData.image_url ? (
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, image_url: "" }))}
                  className="px-3 py-2 border border-slate-300 rounded text-sm font-semibold text-slate-700"
                >
                  Remove image
                </button>
              ) : null}
            </div>
            {formData.image_url ? (
              <img
                src={formData.image_url}
                alt="Course cover"
                className="h-36 w-full max-w-sm object-cover rounded border border-slate-200"
              />
            ) : (
              <p className="text-sm text-slate-500">No image uploaded yet.</p>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-800">Course Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm font-medium text-slate-700">
              Faculty info
              <input
                type="text"
                value={details.faculty_info || ""}
                onChange={(event) => setDetails((prev) => ({ ...prev, faculty_info: event.target.value }))}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Teaching assistant
              <input
                type="text"
                value={details.teaching_assistant || ""}
                onChange={(event) =>
                  setDetails((prev) => ({ ...prev, teaching_assistant: event.target.value }))
                }
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="text-sm font-medium text-slate-700 block">
            Learning outcomes (one per line)
            <textarea
              rows={4}
              value={outcomesText}
              onChange={(event) =>
                setDetails((prev) => ({
                  ...prev,
                  learning_outcomes: event.target.value
                    .split("\n")
                    .map((row) => row.trim())
                    .filter(Boolean),
                }))
              }
              className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
            />
          </label>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-slate-800">Evaluation Criteria</h2>
            <span
              className={`text-sm font-bold ${
                evaluationTotal === 100 ? "text-emerald-600" : "text-amber-600"
              }`}
            >
              Total weight: {evaluationTotal}%
            </span>
          </div>
          {evaluationTotal !== 100 ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 inline-flex items-center gap-2">
              <AlertCircle size={16} />
              Evaluation weightages must add up to 100%.
            </div>
          ) : null}
          {(details.evaluation_components || []).map((row, idx) => (
            <div key={idx} className="border border-slate-200 rounded p-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  placeholder="Component"
                  value={row.component}
                  onChange={(event) => updateEvaluationRow(idx, "component", event.target.value)}
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                />
                <input
                  placeholder="Code"
                  value={row.code}
                  onChange={(event) => updateEvaluationRow(idx, "code", event.target.value)}
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="Weight %"
                  value={row.weightage_percent}
                  onChange={(event) =>
                    updateEvaluationRow(idx, "weightage_percent", Number(event.target.value))
                  }
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                />
                <input
                  placeholder="Timeline"
                  value={row.timeline}
                  onChange={(event) => updateEvaluationRow(idx, "timeline", event.target.value)}
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                />
                <input
                  placeholder="Scheduled date / slot"
                  value={row.scheduled_date}
                  onChange={(event) => updateEvaluationRow(idx, "scheduled_date", event.target.value)}
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                />
                <input
                  placeholder="CLOs mapped"
                  value={row.clos_mapped}
                  onChange={(event) => updateEvaluationRow(idx, "clos_mapped", event.target.value)}
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => removeEvaluationRow(idx)}
                  className="px-3 py-1.5 border border-red-200 rounded text-xs font-bold text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addEvaluationRow}
            className="px-3 py-1.5 border border-slate-300 rounded text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            + Add evaluation component
          </button>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-slate-800">Session Schedule</h2>
            <button
              type="button"
              onClick={regenerateSchedule}
              className="px-3 py-1.5 border border-slate-300 rounded text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Regenerate auto schedule
            </button>
          </div>
          <p className="text-sm text-slate-500">
            Schedule is auto-generated in ascending date order. You can edit dates/times before final save.
          </p>
          {sessions.length === 0 ? (
            <div className="text-sm text-slate-500 italic">No sessions generated yet.</div>
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
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id}>
                      <td className="px-3 py-2 border font-semibold">S{session.session_number}</td>
                      <td className="px-3 py-2 border">
                        <input
                          value={session.title}
                          onChange={(event) => updateSession(session.id, "title", event.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 border">
                        <input
                          type="date"
                          value={normalizeDateOnly(session.session_date)}
                          onChange={(event) => updateSession(session.id, "session_date", event.target.value)}
                          className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 border">
                        <input
                          type="time"
                          value={session.start_time}
                          onChange={(event) => updateSession(session.id, "start_time", event.target.value)}
                          className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 border">
                        <input
                          type="time"
                          value={session.end_time}
                          onChange={(event) => updateSession(session.id, "end_time", event.target.value)}
                          className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 border">
                        <select
                          value={session.mode}
                          onChange={(event) => updateSession(session.id, "mode", event.target.value)}
                          className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                        >
                          <option value="classroom">Classroom</option>
                          <option value="online">Online</option>
                          <option value="hybrid">Hybrid</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          {loadingStudents ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Loading students...
            </div>
          ) : (
            <ParticipantEnrollmentPanel
              title="Participants"
              participants={selectedParticipants}
              allStudents={allStudents}
              notice={null}
              onAddParticipant={handleAddParticipant}
              addLabel={courseId ? "Enrol" : "Select"}
              addingLabel={courseId ? "Enrolling..." : "Selecting..."}
              onRemoveParticipant={!courseId ? handleRemoveParticipant : undefined}
              removeLabel="Remove"
              candidatesSubtitle={courseId ? "Available students" : "Select students to enrol on save"}
              participantsSubtitle={courseId ? "Already enrolled students" : "Selected students"}
              emptyCandidatesText="No additional students available."
              emptyParticipantsText="No students selected yet."
            />
          )}
        </section>

        {/* Pre-read Resources — only shown when editing an existing course */}
        {courseId && (
          <section className="space-y-4 pt-4 border-t border-slate-200">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <FileText size={16} className="text-moodle-blue" />
              Pre-read Resources
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  ref={prereadFileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={e => setPrereadFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                  id="preread-pdf-input"
                />
                <label
                  htmlFor="preread-pdf-input"
                  className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded text-sm cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <Upload size={14} className="text-slate-500" />
                  {prereadFile ? prereadFile.name : "Choose PDF"}
                </label>
                {prereadFile && (
                  <button type="button" onClick={() => { setPrereadFile(null); if (prereadFileInputRef.current) prereadFileInputRef.current.value = ""; }}>
                    <X size={14} className="text-slate-400 hover:text-red-500" />
                  </button>
                )}
                <input
                  type="text"
                  placeholder="Title (optional)"
                  value={prereadTitle}
                  onChange={e => setPrereadTitle(e.target.value)}
                  className="border border-slate-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-moodle-blue outline-none w-52"
                />
                <select
                  value={prereadSectionId}
                  onChange={e => setPrereadSectionId(e.target.value)}
                  className="border border-slate-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-moodle-blue outline-none"
                >
                  {courseSections.length === 0 && <option value="">No sections</option>}
                  {courseSections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
                <button
                  type="button"
                  disabled={!prereadFile || !prereadSectionId || prereadUploading}
                  onClick={handlePrereadUpload}
                  className="px-4 py-2 bg-moodle-blue text-white rounded text-sm font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 transition-all"
                >
                  {prereadUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {prereadUploading ? "Uploading…" : "Upload"}
                </button>
              </div>
              {prereadSuccess && (
                <p className={`text-sm flex items-center gap-2 ${prereadSuccess.startsWith("Upload failed") ? "text-red-600" : "text-emerald-600"}`}>
                  <CheckCircle2 size={14} /> {prereadSuccess}
                </p>
              )}
              {courseMaterials.length > 0 && (
                <div className="space-y-2 mt-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Uploaded materials</p>
                  {courseMaterials.map(m => (
                    <div key={m.id} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded text-sm">
                      <FileText size={14} className="text-moodle-blue shrink-0" />
                      <span className="text-slate-700 font-medium">{m.title}</span>
                      <span className="text-xs text-slate-400 ml-auto">
                        {courseSections.find(s => s.id === m.section_id)?.title ?? ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving || fetchingCourse}
            className="px-5 py-2.5 bg-moodle-blue text-white rounded font-bold text-sm inline-flex items-center gap-2 disabled:opacity-70"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {saving ? "Saving..." : "Save and return"}
          </button>
          <button
            type="button"
            disabled={saving || fetchingCourse}
            onClick={() => submitCourse("display")}
            className="px-5 py-2.5 bg-slate-900 text-white rounded font-bold text-sm disabled:opacity-70"
          >
            Save and display
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="px-5 py-2.5 border border-slate-300 rounded font-bold text-sm text-slate-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default FacultyCourseEditor;
