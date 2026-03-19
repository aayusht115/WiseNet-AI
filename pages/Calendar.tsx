import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  RotateCcw,
  User,
  X,
} from "lucide-react";
import { UserRole } from "../types";

interface CalendarSession {
  id: number;
  course_id: number;
  session_number: number;
  session_title: string;
  session_date: string;
  start_time?: string;
  end_time?: string;
  mode?: string;
  course_name: string;
  course_code: string;
  faculty_name?: string;
  session_status?: "scheduled" | "completed" | "cancelled" | "rescheduled";
  original_date?: string;
  attendance_status?: "present" | "absent" | "late" | "excused" | "not_marked" | "scheduled";
  attendance_note?: string;
  attendance_marked_at?: string;
}

interface PendingSession {
  id: number;
  session_number: number;
  session_title: string;
  session_date: string;
  course_name: string;
  course_code: string;
}

interface CalendarProps {
  role?: UserRole;
}

const HOUR_HEIGHT = 72;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const COURSE_COLORS = [
  "border-sky-400 bg-sky-50 text-sky-900",
  "border-violet-400 bg-violet-50 text-violet-900",
  "border-teal-400 bg-teal-50 text-teal-900",
  "border-amber-400 bg-amber-50 text-amber-900",
  "border-rose-400 bg-rose-50 text-rose-900",
  "border-indigo-400 bg-indigo-50 text-indigo-900",
  "border-emerald-400 bg-emerald-50 text-emerald-900",
];
const COURSE_DOT_COLORS = [
  "bg-sky-400",
  "bg-violet-400",
  "bg-teal-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-indigo-400",
  "bg-emerald-400",
];

function useNow() {
  const TIME_OVERRIDE_KEY = "wisenet_time_override";
  const getEffectiveNow = useCallback(() => {
    const override = localStorage.getItem(TIME_OVERRIDE_KEY);
    return override ? new Date(override) : new Date();
  }, []);
  const [now, setNow] = useState(getEffectiveNow);

  useEffect(() => {
    const handler = () => setNow(getEffectiveNow());
    window.addEventListener("wisenet-time-override-updated", handler);
    const interval = window.setInterval(() => setNow(getEffectiveNow()), 60_000);
    return () => {
      window.removeEventListener("wisenet-time-override-updated", handler);
      window.clearInterval(interval);
    };
  }, [getEffectiveNow]);

  return now;
}

function formatIsoDate(date: Date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

function startOfWeek(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - value.getDay());
  return value;
}

function addDays(date: Date, amount: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + amount);
  return value;
}

function parseTimeToMinutes(value?: string) {
  if (!value) return null;
  const [hour, minute] = value.split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
}

function formatTime(value?: string) {
  if (!value) return "Time TBD";
  const minutes = parseTimeToMinutes(value);
  if (minutes === null) return value;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour} ${suffix}`;
}

function getSessionWindow(session: CalendarSession) {
  const start = parseTimeToMinutes(session.start_time);
  const end = parseTimeToMinutes(session.end_time);
  if (start === null) return null;
  const safeEnd = end !== null && end > start ? end : start + 60;
  return { start, end: safeEnd };
}

function formatWeekLabel(weekStart: Date) {
  const weekEnd = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  const sameYear = weekStart.getFullYear() === weekEnd.getFullYear();

  if (sameMonth && sameYear) {
    return `${weekStart.toLocaleDateString("en-US", { month: "long" })} ${weekStart.getDate()}-${weekEnd.getDate()}, ${weekStart.getFullYear()}`;
  }

  return `${weekStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} - ${weekEnd.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function getCourseColor(courseId: number, courseColorMap: Map<number, number>) {
  return COURSE_COLORS[courseColorMap.get(courseId) ?? 0];
}

function getCourseDotColor(courseId: number, courseColorMap: Map<number, number>) {
  return COURSE_DOT_COLORS[courseColorMap.get(courseId) ?? 0];
}

function getStudentAttendanceMeta(session: CalendarSession, courseClassName: string) {
  switch (session.attendance_status) {
    case "present":
      return {
        label: "Attended",
        shell: "border-emerald-400 bg-emerald-50 text-emerald-900",
        badge: "bg-emerald-100 text-emerald-800",
      };
    case "absent":
      return {
        label: "Missed",
        shell: "border-rose-400 bg-rose-50 text-rose-900",
        badge: "bg-rose-100 text-rose-800",
      };
    case "late":
      return {
        label: "Late",
        shell: "border-amber-400 bg-amber-50 text-amber-900",
        badge: "bg-amber-100 text-amber-800",
      };
    case "excused":
      return {
        label: "Excused",
        shell: "border-sky-400 bg-sky-50 text-sky-900",
        badge: "bg-sky-100 text-sky-800",
      };
    case "not_marked":
      return {
        label: "Attendance pending",
        shell: "border-slate-300 bg-slate-50 text-slate-800",
        badge: "bg-slate-100 text-slate-700",
      };
    default:
      return {
        label: "Scheduled",
        shell: courseClassName,
        badge: "bg-slate-100 text-slate-700",
      };
  }
}

function getFacultyStatusMeta(session: CalendarSession, courseClassName: string) {
  switch (session.session_status) {
    case "completed":
      return {
        label: "Completed",
        shell: "border-emerald-400 bg-emerald-50 text-emerald-900",
        badge: "bg-emerald-100 text-emerald-800",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        shell: "border-rose-400 bg-rose-50 text-rose-900",
        badge: "bg-rose-100 text-rose-800",
      };
    case "rescheduled":
      return {
        label: "Rescheduled",
        shell: "border-amber-400 bg-amber-50 text-amber-900",
        badge: "bg-amber-100 text-amber-800",
      };
    default:
      return {
        label: "Scheduled",
        shell: courseClassName,
        badge: "bg-white/80 text-slate-700",
      };
  }
}

const Calendar: React.FC<CalendarProps> = ({ role }) => {
  const now = useNow();
  const todayStr = formatIsoDate(now);
  const isFaculty = role === "faculty";

  const [weekStart, setWeekStart] = useState(startOfWeek(now));
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [hasAutoAlignedWeek, setHasAutoAlignedWeek] = useState(false);

  const [pendingSessions, setPendingSessions] = useState<PendingSession[]>([]);
  const [showPendingModal, setShowPendingModal] = useState(false);

  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [actionNotice, setActionNotice] = useState<{ id: number; msg: string } | null>(null);
  const [rescheduleSession, setRescheduleSession] = useState<CalendarSession | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleStart, setRescheduleStart] = useState("");
  const [rescheduleEnd, setRescheduleEnd] = useState("");
  const [rescheduleLoading, setRescheduleLoading] = useState(false);

  const refreshPending = useCallback((showModal = false) => {
    if (!isFaculty) return;
    fetch("/api/calendar/pending", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: PendingSession[]) => {
        setPendingSessions(rows);
        if (showModal && rows.length > 0) setShowPendingModal(true);
        if (rows.length === 0) setShowPendingModal(false);
      })
      .catch(() => {});
  }, [isFaculty]);

  const fetchSessions = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/calendar", { credentials: "include" })
      .then(async (response) => {
        const text = await response.text();
        if (!response.ok) {
          try {
            const payload = JSON.parse(text);
            throw new Error(payload.error || `Server error ${response.status}`);
          } catch {
            throw new Error(`Server error ${response.status}`);
          }
        }
        return JSON.parse(text) as CalendarSession[];
      })
      .then((rows) => {
        setSessions(rows);
        setHasAutoAlignedWeek(false);
      })
      .catch((fetchError: any) => setError(String(fetchError?.message || fetchError)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Show modal once on mount; after that refreshPending only silently updates the list
  useEffect(() => {
    refreshPending(true);
  }, [refreshPending]);

  useEffect(() => {
    setWeekStart(startOfWeek(now));
  }, [todayStr]);

  useEffect(() => {
    if (hasAutoAlignedWeek || sessions.length === 0) return;
    const visibleStart = formatIsoDate(weekStart);
    const visibleEnd = formatIsoDate(addDays(weekStart, 6));
    const hasVisibleSessions = sessions.some(
      (session) => session.session_date >= visibleStart && session.session_date <= visibleEnd
    );
    if (hasVisibleSessions) {
      setHasAutoAlignedWeek(true);
      return;
    }

    const targetSession =
      sessions.find((session) => session.session_date >= todayStr) ??
      sessions
        .slice()
        .sort((left, right) => {
          const leftStamp = `${left.session_date}T${left.start_time || "23:59"}:00`;
          const rightStamp = `${right.session_date}T${right.start_time || "23:59"}:00`;
          return new Date(leftStamp).getTime() - new Date(rightStamp).getTime();
        })[0];

    if (!targetSession) return;
    const targetWeek = startOfWeek(new Date(`${targetSession.session_date}T12:00:00`));
    if (formatIsoDate(targetWeek) !== visibleStart) {
      setWeekStart(targetWeek);
    }
    setHasAutoAlignedWeek(true);
  }, [hasAutoAlignedWeek, sessions, todayStr, weekStart]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart]
  );
  const dayKeys = useMemo(() => days.map((day) => formatIsoDate(day)), [days]);

  const weekSessions = useMemo(
    () => sessions.filter((session) => dayKeys.includes(session.session_date)),
    [dayKeys, sessions]
  );

  const untimedSessions = useMemo(
    () => weekSessions.filter((session) => getSessionWindow(session) === null),
    [weekSessions]
  );

  const timedSessions = useMemo(
    () => weekSessions.filter((session) => getSessionWindow(session) !== null),
    [weekSessions]
  );

  const courseColorMap = useMemo(() => {
    const map = new Map<number, number>();
    let index = 0;
    for (const session of sessions) {
      if (!map.has(session.course_id)) {
        map.set(session.course_id, index % COURSE_COLORS.length);
        index += 1;
      }
    }
    return map;
  }, [sessions]);

  const { startHour, endHour } = useMemo(() => {
    if (timedSessions.length === 0) {
      return { startHour: 8, endHour: 20 };
    }
    const starts = timedSessions
      .map((session) => getSessionWindow(session)?.start ?? 8 * 60)
      .filter((value) => Number.isFinite(value));
    const ends = timedSessions
      .map((session) => getSessionWindow(session)?.end ?? 20 * 60)
      .filter((value) => Number.isFinite(value));
    const minHour = Math.max(7, Math.floor(Math.min(...starts) / 60) - 1);
    const maxHour = Math.min(22, Math.ceil(Math.max(...ends) / 60) + 1);
    return {
      startHour: minHour,
      endHour: Math.max(maxHour, minHour + 8),
    };
  }, [timedSessions]);

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index),
    [endHour, startHour]
  );
  const gridHeight = (endHour - startHour) * HOUR_HEIGHT;

  useEffect(() => {
    if (weekSessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    const stillVisible = weekSessions.some((session) => session.id === selectedSessionId);
    if (stillVisible) return;
    const preferred =
      weekSessions.find((session) => session.session_date === todayStr) ??
      [...weekSessions].sort((left, right) => {
        const leftStamp = `${left.session_date}T${left.start_time || "23:59"}:00`;
        const rightStamp = `${right.session_date}T${right.start_time || "23:59"}:00`;
        return new Date(leftStamp).getTime() - new Date(rightStamp).getTime();
      })[0];
    setSelectedSessionId(preferred?.id ?? null);
  }, [selectedSessionId, todayStr, weekSessions]);

  const selectedSession =
    weekSessions.find((session) => session.id === selectedSessionId) ?? null;

  const moveWeek = (delta: number) => {
    setWeekStart((current) => addDays(current, delta * 7));
  };

  const goToday = () => {
    setWeekStart(startOfWeek(now));
  };

  const handleStatusUpdate = async (sessionId: number, status: "completed" | "cancelled") => {
    setActionLoading(sessionId);
    setActionNotice(null);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Failed to update status." }));
        setActionNotice({ id: sessionId, msg: payload.error || "Failed to update status." });
        return;
      }
      fetchSessions();
      refreshPending();
    } catch {
      setActionNotice({ id: sessionId, msg: "Failed to update status." });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReschedule = async () => {
    if (!rescheduleSession || !rescheduleDate || rescheduleLoading) return;
    setRescheduleLoading(true);
    try {
      const response = await fetch(`/api/sessions/${rescheduleSession.id}/reschedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_date: rescheduleDate,
          start_time: rescheduleStart || undefined,
          end_time: rescheduleEnd || undefined,
        }),
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        setRescheduleSession(null);
        fetchSessions();
        refreshPending();
      } else {
        setActionNotice({ id: rescheduleSession.id, msg: payload.error || "Failed to reschedule." });
        setRescheduleLoading(false);
      }
    } catch {
      setActionNotice({ id: rescheduleSession.id, msg: "Network error. Please try again." });
      setRescheduleLoading(false);
    }
  };

  const uniqueCourses = [...new Map<number, CalendarSession>(sessions.map((session) => [session.course_id, session])).values()];

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Course Calendar</h2>
          <p className="text-sm text-slate-500 mt-1">
            Weekly schedule synced to your course sessions{isFaculty ? "." : ", faculty assignments, and attendance marks."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => moveWeek(-1)}
            className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            aria-label="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={goToday}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Today
          </button>
          <button
            onClick={() => moveWeek(1)}
            className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            aria-label="Next week"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="moodle-card p-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Week View</p>
          <h3 className="text-xl font-bold text-slate-800 mt-1">{formatWeekLabel(weekStart)}</h3>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {isFaculty ? (
            <>
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold">Completed</span>
              <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 font-semibold">Cancelled</span>
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold">Rescheduled</span>
            </>
          ) : (
            <>
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold">Attended</span>
              <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 font-semibold">Missed</span>
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold">Late</span>
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-4 text-sm">{error}</div>
      ) : null}

      {showPendingModal && pendingSessions.length > 0 ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-amber-200 p-6 max-w-lg w-full">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-2 text-amber-700">
                <AlertCircle size={20} />
                <h3 className="font-bold text-base">Action Required</h3>
              </div>
              <button onClick={() => setShowPendingModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-700 mb-4">
              You have <strong>{pendingSessions.length}</strong> past session{pendingSessions.length > 1 ? "s" : ""} with no status update.
            </p>
            <div className="space-y-2 max-h-56 overflow-y-auto mb-4">
              {pendingSessions.map((session) => (
                <div key={session.id} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <span className="font-semibold">{session.course_code}</span> · Session {session.session_number}: {session.session_title}
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowPendingModal(false)}
              className="w-full py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black"
            >
              Review in calendar
            </button>
          </div>
        </div>
      ) : null}

      {rescheduleSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-bold text-base text-slate-800">Reschedule Session</h3>
              <button onClick={() => setRescheduleSession(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              <span className="font-semibold">{rescheduleSession.course_code}</span> · {rescheduleSession.session_title}
            </p>
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                New date
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(event) => setRescheduleDate(event.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                  Start
                  <input
                    type="time"
                    value={rescheduleStart}
                    onChange={(event) => setRescheduleStart(event.target.value)}
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                  End
                  <input
                    type="time"
                    value={rescheduleEnd}
                    onChange={(event) => setRescheduleEnd(event.target.value)}
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setRescheduleSession(null)}
                className="flex-1 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReschedule}
                disabled={!rescheduleDate || rescheduleLoading}
                className="flex-1 py-2 bg-moodle-blue text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {rescheduleLoading ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6">
        <div className="moodle-card overflow-hidden">
          {loading ? (
            <div className="h-80 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-moodle-blue" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[1200px]">
                <div className="grid grid-cols-[88px_repeat(7,minmax(150px,1fr))] border-b border-slate-200">
                  <div className="bg-slate-50 px-4 py-4 text-xs font-bold uppercase tracking-widest text-slate-400">
                    Time
                  </div>
                  {days.map((day, index) => {
                    const dayKey = dayKeys[index];
                    const isToday = dayKey === todayStr;
                    return (
                      <div
                        key={dayKey}
                        className={`px-4 py-4 border-l border-slate-200 ${isToday ? "bg-blue-50/70" : "bg-slate-50/70"}`}
                      >
                        <p className={`text-xs font-bold uppercase tracking-widest ${isToday ? "text-moodle-blue" : "text-slate-400"}`}>
                          {DAY_NAMES[index]}
                        </p>
                        <p className={`text-2xl font-bold mt-1 ${isToday ? "text-moodle-blue" : "text-slate-800"}`}>
                          {day.getDate()}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-[88px_repeat(7,minmax(150px,1fr))]">
                  <div className="relative border-r border-slate-200 bg-white" style={{ height: gridHeight }}>
                    {hours.slice(0, -1).map((hour) => (
                      <div
                        key={hour}
                        className="absolute left-0 right-0 border-t border-slate-100 px-3 text-xs text-slate-400"
                        style={{ top: (hour - startHour) * HOUR_HEIGHT - 8 }}
                      >
                        {formatHour(hour)}
                      </div>
                    ))}
                  </div>

                  {days.map((day, index) => {
                    const dayKey = dayKeys[index];
                    const daySessions = timedSessions
                      .filter((session) => session.session_date === dayKey)
                      .sort((left, right) => {
                        const leftStart = getSessionWindow(left)?.start ?? 0;
                        const rightStart = getSessionWindow(right)?.start ?? 0;
                        return leftStart - rightStart;
                      });
                    const isToday = dayKey === todayStr;

                    return (
                      <div
                        key={dayKey}
                        className={`relative border-l border-slate-200 ${isToday ? "bg-blue-50/30" : "bg-white"}`}
                        style={{ height: gridHeight }}
                      >
                        {hours.slice(0, -1).map((hour) => (
                          <div
                            key={`${dayKey}-${hour}`}
                            className="absolute left-0 right-0 border-t border-slate-100"
                            style={{ top: (hour - startHour) * HOUR_HEIGHT }}
                          />
                        ))}

                        {daySessions.map((session) => {
                          const window = getSessionWindow(session);
                          if (!window) return null;
                          const top = ((window.start - startHour * 60) / 60) * HOUR_HEIGHT;
                          const height = Math.max(((window.end - window.start) / 60) * HOUR_HEIGHT - 8, 56);
                          const courseClassName = getCourseColor(session.course_id, courseColorMap);
                          const meta = isFaculty
                            ? getFacultyStatusMeta(session, courseClassName)
                            : getStudentAttendanceMeta(session, courseClassName);

                          return (
                            <button
                              key={session.id}
                              onClick={() => setSelectedSessionId(session.id)}
                              className={`absolute left-2 right-2 rounded-2xl border-l-4 border p-2 text-left shadow-sm hover:shadow-md transition overflow-hidden ${meta.shell} ${
                                selectedSessionId === session.id ? "ring-2 ring-slate-900/15" : ""
                              }`}
                              style={{ top, height }}
                            >
                              <div className="flex items-start justify-between gap-1 min-w-0">
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10px] font-bold uppercase tracking-wide opacity-80 truncate">
                                    {session.course_code}
                                  </p>
                                  <p className="text-xs font-bold leading-snug mt-0.5 truncate">{session.session_title}</p>
                                </div>
                                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${meta.badge}`}>
                                  {meta.label}
                                </span>
                              </div>
                              <p className="text-[10px] mt-1 truncate">
                                {formatTime(session.start_time)}{session.end_time ? ` – ${formatTime(session.end_time)}` : ""}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {!loading && weekSessions.length === 0 ? (
            <div className="border-t border-slate-200 px-5 py-4 bg-slate-50/70">
              <p className="text-sm font-semibold text-slate-700">No classes scheduled for this week.</p>
              <p className="text-xs text-slate-500 mt-1">Use the arrows to move to another week or click Today to return to the current schedule.</p>
            </div>
          ) : null}

          {untimedSessions.length > 0 ? (
            <div className="border-t border-slate-200 px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Time TBD</p>
              <div className="flex flex-wrap gap-2">
                {untimedSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => setSelectedSessionId(session.id)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {DAY_NAMES_LONG[new Date(`${session.session_date}T12:00:00`).getDay()]} · {session.course_code} · {session.session_title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="moodle-card p-5">
            {selectedSession ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    {selectedSession.course_code} · Session {selectedSession.session_number}
                  </p>
                  <h3 className="text-xl font-bold text-slate-800 mt-2">{selectedSession.session_title}</h3>
                  <p className="text-sm text-slate-500 mt-1">{selectedSession.course_name}</p>
                </div>

                <div className="space-y-2 text-sm text-slate-700">
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-slate-400" />
                    <span>
                      {new Date(`${selectedSession.session_date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      {" · "}
                      {formatTime(selectedSession.start_time)}
                      {selectedSession.end_time ? ` – ${formatTime(selectedSession.end_time)}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-slate-400" />
                    <span>{selectedSession.mode || "Mode TBD"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-slate-400" />
                    <span>{isFaculty ? "You" : selectedSession.faculty_name || "Faculty TBA"}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  {isFaculty ? (
                    <p className="font-semibold text-slate-700">
                      Status: <span className="text-slate-900 capitalize">{selectedSession.session_status || "scheduled"}</span>
                    </p>
                  ) : (
                    <p className="font-semibold text-slate-700">
                      Attendance: <span className="text-slate-900">{getStudentAttendanceMeta(selectedSession, getCourseColor(selectedSession.course_id, courseColorMap)).label}</span>
                    </p>
                  )}
                  {selectedSession.attendance_note ? (
                    <p className="text-xs text-slate-500 mt-2">Note: {selectedSession.attendance_note}</p>
                  ) : null}
                  {selectedSession.original_date && selectedSession.session_status === "rescheduled" ? (
                    <p className="text-xs text-slate-500 mt-2">
                      Originally scheduled for {new Date(`${selectedSession.original_date}T12:00:00`).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>

                {isFaculty && selectedSession.session_status !== "completed" && selectedSession.session_status !== "cancelled" ? (
                  <div className="space-y-2">
                    {actionNotice?.id === selectedSession.id ? (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                        {actionNotice.msg}
                      </div>
                    ) : null}
                    <button
                      disabled={actionLoading === selectedSession.id || selectedSession.session_date > todayStr}
                      onClick={() => handleStatusUpdate(selectedSession.id, "completed")}
                      title={selectedSession.session_date > todayStr ? "Can only mark completed on or after the session date" : undefined}
                      className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-bold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 size={14} />
                      Mark completed
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRescheduleSession(selectedSession);
                        setRescheduleDate(selectedSession.session_date);
                        setRescheduleStart(selectedSession.start_time || "");
                        setRescheduleEnd(selectedSession.end_time || "");
                      }}
                      className="w-full flex items-center justify-center gap-2 rounded-lg border border-amber-200 text-amber-700 py-2.5 text-sm font-bold hover:bg-amber-50"
                    >
                      <RotateCcw size={14} />
                      Reschedule
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="py-10 text-center">
                <p className="text-sm font-semibold text-slate-500">Select a class block</p>
                <p className="text-xs text-slate-400 mt-1">Details for the selected session will appear here.</p>
              </div>
            )}
          </div>

          {uniqueCourses.length > 0 ? (
            <div className="moodle-card p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Courses</p>
              <div className="space-y-2">
                {uniqueCourses.map((session) => (
                  <div key={session.course_id} className="flex items-center gap-2 text-sm text-slate-700">
                    <span className={`inline-block h-3 w-3 rounded-full ${getCourseDotColor(session.course_id, courseColorMap)}`} />
                    <span>
                      <span className="font-semibold">{session.course_code}</span> · {session.course_name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default Calendar;
