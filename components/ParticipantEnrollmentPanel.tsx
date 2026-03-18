import React from "react";
import { Loader2 } from "lucide-react";

export interface ParticipantUser {
  id: number;
  name: string;
  email: string;
  role?: string;
}

type Notice = { type: "success" | "error"; text: string };

interface ParticipantEnrollmentPanelProps {
  title?: string;
  participants: ParticipantUser[];
  allStudents: ParticipantUser[];
  notice?: Notice | null;
  onAddParticipant: (studentId: number) => void;
  addingId?: number | null;
  addLabel?: string;
  addingLabel?: string;
  selectionMode?: "single" | "multi";
  selectedCandidateIds?: number[];
  onToggleCandidate?: (studentId: number) => void;
  onSelectAllCandidates?: (checked: boolean) => void;
  onSubmitSelected?: () => void;
  submittingSelected?: boolean;
  submitSelectedLabel?: string;
  submittingSelectedLabel?: string;
  onRemoveParticipant?: (studentId: number) => void;
  removeLabel?: string;
  candidatesSubtitle?: string;
  participantsSubtitle?: string;
  emptyCandidatesText?: string;
  emptyParticipantsText?: string;
}

const ParticipantEnrollmentPanel: React.FC<ParticipantEnrollmentPanelProps> = ({
  title = "Participants",
  participants,
  allStudents,
  notice,
  onAddParticipant,
  addingId = null,
  addLabel = "Enrol",
  addingLabel = "Working...",
  selectionMode = "single",
  selectedCandidateIds = [],
  onToggleCandidate,
  onSelectAllCandidates,
  onSubmitSelected,
  submittingSelected = false,
  submitSelectedLabel = "Save selected",
  submittingSelectedLabel = "Saving...",
  onRemoveParticipant,
  removeLabel = "Remove",
  candidatesSubtitle = "Available students",
  participantsSubtitle = "Enrolled students",
  emptyCandidatesText = "No students available.",
  emptyParticipantsText = "No participants yet.",
}) => {
  const participantIds = new Set((participants || []).map((participant) => Number(participant.id)));
  const candidates = (allStudents || []).filter((student) => !participantIds.has(Number(student.id)));
  const allSelected =
    candidates.length > 0 && candidates.every((student) => selectedCandidateIds.includes(Number(student.id)));

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold">{title}</h3>
      {notice ? (
        <div
          className={`rounded border px-3 py-2 text-sm ${
            notice.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{candidatesSubtitle}</p>
          {selectionMode === "multi" && candidates.length > 0 ? (
            <label className="text-xs font-semibold text-slate-700 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => onSelectAllCandidates?.(event.target.checked)}
              />
              Select all
            </label>
          ) : null}
        </div>
        {candidates.length === 0 ? (
          <p className="text-sm text-slate-500 italic">{emptyCandidatesText}</p>
        ) : (
          <div className="space-y-2">
            {candidates.map((student) => (
              <div
                key={student.id}
                className="flex items-center justify-between gap-3 border border-slate-200 rounded p-3"
              >
                <div>
                  <p className="font-semibold text-sm">{student.name}</p>
                  <p className="text-xs text-slate-500">{student.email}</p>
                </div>
                {selectionMode === "multi" ? (
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={selectedCandidateIds.includes(Number(student.id))}
                      onChange={() => onToggleCandidate?.(student.id)}
                    />
                    Select
                  </label>
                ) : (
                  <button
                    onClick={() => onAddParticipant(student.id)}
                    disabled={addingId === student.id}
                    className="px-3 py-1.5 bg-slate-900 text-white border border-slate-900 rounded text-xs font-bold disabled:opacity-70 inline-flex items-center gap-1"
                  >
                    {addingId === student.id ? <Loader2 size={14} className="animate-spin" /> : null}
                    {addingId === student.id ? addingLabel : addLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {selectionMode === "multi" ? (
          <div className="pt-2">
            <button
              onClick={onSubmitSelected}
              disabled={submittingSelected || selectedCandidateIds.length === 0}
              className="px-4 py-2 bg-slate-900 text-white border border-slate-900 rounded text-xs font-bold disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              {submittingSelected ? <Loader2 size={14} className="animate-spin" /> : null}
              {submittingSelected ? submittingSelectedLabel : submitSelectedLabel}
            </button>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{participantsSubtitle}</p>
        {participants.length === 0 ? (
          <p className="text-sm text-slate-500 italic">{emptyParticipantsText}</p>
        ) : (
          <div className="space-y-2">
            {participants.map((participant) => (
              <div
                key={participant.id}
                className="border border-slate-200 rounded p-3 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="font-semibold text-sm">{participant.name}</p>
                  <p className="text-xs text-slate-500">{participant.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 capitalize">{participant.role || "student"}</span>
                  {onRemoveParticipant ? (
                    <button
                      onClick={() => onRemoveParticipant(participant.id)}
                      className="px-2.5 py-1 border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {removeLabel}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ParticipantEnrollmentPanel;
