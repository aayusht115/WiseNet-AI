import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  Course,
  CourseDetail,
  CourseMaterial,
  CourseSection,
  EvaluationComponent,
  UserRole,
} from "../types";

interface CourseManagementProps {
  courseId: number;
  role: UserRole;
  onBack: () => void;
}

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

const CourseManagement: React.FC<CourseManagementProps> = ({ courseId, role, onBack }) => {
  const [course, setCourse] = useState<Course | null>(null);
  const [details, setDetails] = useState<CourseDetail>({});
  const [sections, setSections] = useState<CourseSection[]>([]);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [quizAnalytics, setQuizAnalytics] = useState<any | null>(null);
  const [allStudents, setAllStudents] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"course" | "materials" | "participants" | "reports">(
    "course"
  );

  const [savingDetails, setSavingDetails] = useState(false);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<string>("");
  const [enrollingId, setEnrollingId] = useState<number | null>(null);
  const [enrolNotice, setEnrolNotice] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const [assigningMaterialId, setAssigningMaterialId] = useState<number | null>(null);
  const [deletingMaterialId, setDeletingMaterialId] = useState<number | null>(null);
  const [regeneratingMaterialId, setRegeneratingMaterialId] = useState<number | null>(null);

  const [materialForm, setMaterialForm] = useState({
    section_id: "",
    title: "",
    source_type: "pdf",
    source_url: "",
    source_file_name: "",
    source_file_base64: "",
    content: "",
  });

  const [quizModal, setQuizModal] = useState<{
    materialId: number;
    title: string;
    questions: QuizQuestion[];
    answers: number[];
    submitting: boolean;
    result: { score: number; total: number } | null;
  } | null>(null);

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

  const fetchAll = async () => {
    setLoading(true);
    setError("");
    try {
      const detailsRes = await fetch(`/api/course-details/${courseId}`);
      if (!detailsRes.ok) {
        const payload = await detailsRes.json().catch(() => ({ error: "Could not load course data." }));
        setError(payload.error || "Could not load course data.");
        return;
      }
      const data = await detailsRes.json();
      setCourse(data.course);
      setDetails(data.details || {});
      setSections(data.sections || []);
      setMaterials(data.materials || []);

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
      }
    } catch (error) {
      console.error("Failed to fetch course data", error);
      setError("Could not load course data.");
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
  }, [courseId, role]);

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
    setSavingDetails(true);
    try {
      const payload = {
        ...details,
        evaluation_components: (details.evaluation_components || []).map((row, idx) => ({
          ...row,
          sr_no: idx + 1,
          weightage_percent: Number(row.weightage_percent) || 0,
        })),
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

  const handlePdfSelected = async (file: File | null) => {
    if (!file) return;

    setPdfStatus("Preparing PDF for upload...");
    try {
      const buffer = await file.arrayBuffer();
      const sourceFileBase64 = arrayBufferToBase64(buffer);

      setMaterialForm((prev) => ({
        ...prev,
        source_type: "pdf",
        source_file_name: file.name,
        source_file_base64: sourceFileBase64,
        content: "",
      }));
      setPdfStatus("PDF selected. Summary will be auto-generated after upload.");
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

    if (
      materialForm.source_type === "pdf" &&
      !materialForm.source_file_base64.trim() &&
      !materialForm.source_url.trim()
    ) {
      return;
    }

    setUploadingMaterial(true);
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
          is_assigned: true,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Upload failed" }));
        setPdfStatus(error.error || "Upload failed");
        return;
      }

      setMaterialForm({
        section_id: "",
        title: "",
        source_type: "pdf",
        source_url: "",
        source_file_name: "",
        source_file_base64: "",
        content: "",
      });
      setPdfStatus("Submitted. Reading assigned and synced from DB.");
      await fetchMaterialsOnly();
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
        const payload = await response.json().catch(() => ({ error: "Failed to enroll student." }));
        setEnrolNotice({ type: "error", text: payload.error || "Failed to enroll student." });
        return;
      }
      setEnrolNotice({ type: "success", text: "Student enrolled successfully." });
      await fetchAll();
    } finally {
      setEnrollingId(null);
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

  const renderStudentCourse = () => (
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

                  {material.summary && (
                    <div className="bg-slate-50 border border-slate-100 rounded p-3 text-sm text-slate-700">
                      <div className="font-bold text-slate-800 mb-1">Generated Summary</div>
                      <p>{material.summary}</p>
                    </div>
                  )}

                  {(material.key_takeaways || []).length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                      {(material.key_takeaways || []).map((k, idx) => (
                        <li key={idx}>{k}</li>
                      ))}
                    </ul>
                  )}

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
    </div>
  );

  const renderFacultyCourse = () => (
    <div className="space-y-8">
      <div className="flex border-b border-slate-200 overflow-x-auto">
        {[
          { id: "course", label: "Course" },
          { id: "materials", label: "Reading Materials" },
          { id: "participants", label: "Participants" },
          { id: "reports", label: "Quiz Reports" },
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
          <h3 className="text-lg font-bold">Course Details (DB-backed)</h3>
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
                className="mt-1 w-40 border border-slate-300 rounded px-3 py-2 text-sm"
                value={details.credits || 2}
                onChange={(e) => setDetails((prev) => ({ ...prev, credits: Number(e.target.value) }))}
              />
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
          </div>

          <button
            onClick={handleSaveDetails}
            disabled={savingDetails}
            className="px-4 py-2 bg-moodle-blue text-white rounded font-bold text-sm disabled:opacity-70 flex items-center gap-2"
          >
            {savingDetails && <Loader2 size={16} className="animate-spin" />}
            Save Course Details
          </button>
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
                  }))
                }
              >
                <option value="pdf">PDF Upload</option>
                <option value="link">Web Link</option>
              </select>

              <input
                placeholder={materialForm.source_type === "pdf" ? "Optional PDF URL" : "Source URL"}
                className="border border-slate-300 rounded px-3 py-2 text-sm"
                value={materialForm.source_url}
                onChange={(e) => setMaterialForm((prev) => ({ ...prev, source_url: e.target.value }))}
              />
            </div>

            {materialForm.source_type === "pdf" && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Upload PDF
                  <input
                    type="file"
                    accept="application/pdf"
                    className="mt-1 block w-full text-sm"
                    onChange={(e) => handlePdfSelected(e.target.files?.[0] || null)}
                  />
                </label>
                {materialForm.source_file_name && (
                  <p className="text-xs text-slate-500">Selected file: {materialForm.source_file_name}</p>
                )}
              </div>
            )}

            {materialForm.source_type === "link" ? (
              <textarea
                rows={5}
                placeholder="Paste link text/content (optional but recommended for accurate summary + quiz)."
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={materialForm.content}
                onChange={(e) => setMaterialForm((prev) => ({ ...prev, content: e.target.value }))}
              />
            ) : null}

            {pdfStatus ? <p className="text-xs text-slate-600">{pdfStatus}</p> : null}

            <div className="mt-2 p-3 border border-slate-200 rounded bg-slate-50 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600">
                Click submit to save the PDF in DB, assign it to students, and refresh the reading list.
              </p>
              <button
                onClick={handleUploadMaterial}
                disabled={uploadingMaterial}
                className="px-4 py-2 bg-slate-900 border border-slate-900 text-white rounded font-bold text-sm hover:bg-black disabled:opacity-70 flex items-center gap-2 shrink-0"
              >
                {uploadingMaterial ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Submit PDF & Assign Now
              </button>
            </div>
          </div>

          <div className="moodle-card p-6">
            <h3 className="text-lg font-bold mb-4">Existing Materials</h3>
            <div className="space-y-3">
              {materials.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No materials uploaded yet.</p>
              ) : (
                materials.map((m) => (
                  <div key={m.id} className="border border-slate-200 rounded p-4">
                    <div className="flex justify-between items-center gap-3 flex-wrap">
                      <div>
                        <p className="font-bold text-slate-800">{m.title}</p>
                        <p className="text-xs text-slate-500">
                          {m.section_title} • {m.source_type} • {m.quiz_count || 0} questions
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
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "participants" && (
        <div className="moodle-card p-6">
          <h3 className="text-lg font-bold mb-4">Participants</h3>
          {enrolNotice ? (
            <div
              className={`mb-4 rounded border px-3 py-2 text-sm ${
                enrolNotice.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {enrolNotice.text}
            </div>
          ) : null}
          <div className="space-y-3 mb-6">
            {allStudents
              .filter((s) => !participants.find((p) => p.id === s.id))
              .map((student) => (
                <div key={student.id} className="flex items-center justify-between border border-slate-200 rounded p-3">
                  <div>
                    <p className="font-semibold text-sm">{student.name}</p>
                    <p className="text-xs text-slate-500">{student.email}</p>
                  </div>
                  <button
                    onClick={() => handleEnrol(student.id)}
                    disabled={enrollingId === student.id}
                    className="px-3 py-1.5 bg-moodle-blue text-white rounded text-xs font-bold disabled:opacity-70"
                  >
                    {enrollingId === student.id ? "Enrolling..." : "Enrol"}
                  </button>
                </div>
              ))}
          </div>
          <div className="space-y-2">
            {participants.map((p) => (
              <div key={p.id} className="border border-slate-200 rounded p-3 flex justify-between">
                <div>
                  <p className="font-semibold text-sm">{p.name}</p>
                  <p className="text-xs text-slate-500">{p.email}</p>
                </div>
                <span className="text-xs text-slate-500 capitalize">{p.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "reports" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="moodle-card p-4">
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Attempts</p>
              <p className="text-2xl font-black text-slate-800 mt-1">{quizAnalytics?.attempts || 0}</p>
            </div>
            <div className="moodle-card p-4">
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Average %</p>
              <p className="text-2xl font-black text-moodle-blue mt-1">{quizAnalytics?.average_percentage || 0}%</p>
            </div>
            <div className="moodle-card p-4">
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Highest %</p>
              <p className="text-2xl font-black text-emerald-600 mt-1">{quizAnalytics?.highest_percentage || 0}%</p>
            </div>
            <div className="moodle-card p-4">
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Top Performer</p>
              <p className="text-sm font-bold text-slate-800 mt-2">{quizAnalytics?.top_performer?.name || "--"}</p>
              <p className="text-xs text-slate-500">{quizAnalytics?.top_performer?.average_percentage || 0}% avg</p>
            </div>
          </div>

          <div className="moodle-card p-6 overflow-x-auto">
            <h3 className="text-lg font-bold mb-4">Quiz Attempt Reports</h3>
          {reports.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No quiz submissions yet.</p>
          ) : (
            <table className="min-w-full text-sm border border-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 border">Student</th>
                  <th className="px-3 py-2 border">Material</th>
                  <th className="px-3 py-2 border">Section</th>
                  <th className="px-3 py-2 border">Score</th>
                  <th className="px-3 py-2 border">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 border">
                      {r.student_name}
                      <div className="text-xs text-slate-500">{r.student_email}</div>
                    </td>
                    <td className="px-3 py-2 border">{r.material_title}</td>
                    <td className="px-3 py-2 border">{r.section_title}</td>
                    <td className="px-3 py-2 border font-bold text-moodle-blue">
                      {r.score}/{r.total_questions}
                    </td>
                    <td className="px-3 py-2 border">
                      {new Date(r.submitted_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
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
