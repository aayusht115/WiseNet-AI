import React, { useEffect, useState, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, Clock, MapPin, BookOpen,
  CheckCircle2, XCircle, RotateCcw, AlertCircle, X, User,
} from 'lucide-react';
import { UserRole } from '../types';

interface CalendarSession {
  id: number;
  course_id: number;
  session_number: number;
  session_title: string;
  session_date: string; // YYYY-MM-DD
  start_time?: string;
  end_time?: string;
  mode?: string;
  course_name: string;
  course_code: string;
  faculty_name?: string;
  session_status?: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
  original_date?: string;
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

// Stable colour palette — one colour per unique course_id
const COURSE_COLOURS = [
  { pill: 'bg-blue-100 text-blue-800 border-blue-200',   dot: 'bg-blue-500',   border: 'border-l-blue-500',   badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  { pill: 'bg-violet-100 text-violet-800 border-violet-200', dot: 'bg-violet-500', border: 'border-l-violet-500', badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  { pill: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500', border: 'border-l-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { pill: 'bg-amber-100 text-amber-800 border-amber-200',  dot: 'bg-amber-500',  border: 'border-l-amber-500',  badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  { pill: 'bg-pink-100 text-pink-800 border-pink-200',   dot: 'bg-pink-500',   border: 'border-l-pink-500',   badge: 'bg-pink-50 text-pink-700 border-pink-200' },
  { pill: 'bg-teal-100 text-teal-800 border-teal-200',   dot: 'bg-teal-500',   border: 'border-l-teal-500',   badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  { pill: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-500', border: 'border-l-orange-500', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
];

function useNow() {
  const TIME_OVERRIDE_KEY = 'wisenet_time_override';
  const getEffectiveNow = useCallback(() => {
    const override = localStorage.getItem(TIME_OVERRIDE_KEY);
    return override ? new Date(override) : new Date();
  }, []);
  const [now, setNow] = useState(getEffectiveNow);
  useEffect(() => {
    const handler = () => setNow(getEffectiveNow());
    window.addEventListener('wisenet-time-override-updated', handler);
    const interval = setInterval(() => setNow(getEffectiveNow()), 60_000);
    return () => {
      window.removeEventListener('wisenet-time-override-updated', handler);
      clearInterval(interval);
    };
  }, [getEffectiveNow]);
  return now;
}

function formatTime(t?: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const WEEKDAYS_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const WEEKDAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function StatusBadge({ status, isPast }: { status?: string; isPast: boolean }) {
  if (status === 'completed') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
      <CheckCircle2 size={10} /> Completed
    </span>
  );
  if (status === 'cancelled') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
      <XCircle size={10} /> Cancelled
    </span>
  );
  if (status === 'rescheduled') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
      <RotateCcw size={10} /> Rescheduled
    </span>
  );
  if (isPast && (!status || status === 'scheduled')) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5">
      <AlertCircle size={10} /> Unmarked
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
      Scheduled
    </span>
  );
}

const Calendar: React.FC<CalendarProps> = ({ role }) => {
  const now = useNow();
  const todayStr = now.toISOString().slice(0, 10);
  const isFaculty = role === 'faculty';

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Faculty pending popup
  const [pendingSessions, setPendingSessions] = useState<PendingSession[]>([]);
  const [showPendingModal, setShowPendingModal] = useState(false);

  // Faculty action state
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [actionNotice, setActionNotice] = useState<{ id: number; msg: string } | null>(null);

  // Reschedule modal
  const [rescheduleSession, setRescheduleSession] = useState<CalendarSession | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleStart, setRescheduleStart] = useState('');
  const [rescheduleEnd, setRescheduleEnd] = useState('');
  const [rescheduleLoading, setRescheduleLoading] = useState(false);

  const fetchSessions = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/calendar', { credentials: 'include' })
      .then(async r => {
        const text = await r.text();
        if (!r.ok) {
          try { const d = JSON.parse(text); throw new Error(d.error || `Server error ${r.status}`); }
          catch { throw new Error(`Server error ${r.status} — try restarting the server`); }
        }
        return JSON.parse(text) as CalendarSession[];
      })
      .then(data => setSessions(data))
      .catch((e: any) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  useEffect(() => {
    if (!isFaculty) return;
    fetch('/api/calendar/pending', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: PendingSession[]) => {
        if (rows.length > 0) { setPendingSessions(rows); setShowPendingModal(true); }
      })
      .catch(() => {});
  }, [isFaculty]);

  // Assign stable colour index to each unique course_id
  const courseColourMap = React.useMemo(() => {
    const map = new Map<number, number>();
    let idx = 0;
    for (const s of sessions) {
      if (!map.has(s.course_id)) { map.set(s.course_id, idx % COURSE_COLOURS.length); idx++; }
    }
    return map;
  }, [sessions]);

  const colourFor = (courseId: number) => COURSE_COLOURS[courseColourMap.get(courseId) ?? 0];

  // Map from YYYY-MM-DD → sessions[]
  const sessionsByDate = React.useMemo(() => {
    const map = new Map<string, CalendarSession[]>();
    for (const s of sessions) {
      const existing = map.get(s.session_date) ?? [];
      existing.push(s);
      map.set(s.session_date, existing);
    }
    return map;
  }, [sessions]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const goToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth()); setSelectedDate(todayStr); };

  // Build the grid
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array(firstDayOfMonth).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedSessions = selectedDate ? (sessionsByDate.get(selectedDate) ?? []) : [];

  const handleStatusUpdate = async (sessionId: number, status: 'completed' | 'cancelled') => {
    setActionLoading(sessionId);
    setActionNotice(null);
    try {
      const r = await fetch(`/api/sessions/${sessionId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
        credentials: 'include',
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({ error: 'Failed' }));
        setActionNotice({ id: sessionId, msg: d.error || 'Failed to update.' });
      } else { fetchSessions(); }
    } catch { setActionNotice({ id: sessionId, msg: 'Something went wrong. Please try again.' }); }
    finally { setActionLoading(null); }
  };

  const handleReschedule = async () => {
    if (!rescheduleSession || !rescheduleDate) return;
    setRescheduleLoading(true);
    try {
      const r = await fetch(`/api/sessions/${rescheduleSession.id}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_date: rescheduleDate, start_time: rescheduleStart || undefined, end_time: rescheduleEnd || undefined }),
        credentials: 'include',
      });
      if (r.ok) { setRescheduleSession(null); fetchSessions(); }
    } catch { /* ignore */ }
    finally { setRescheduleLoading(false); }
  };

  // Unique courses for legend
  const uniqueCourses = [...new Map<number, CalendarSession>(sessions.map(s => [s.course_id, s])).values()];

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Course Calendar</h2>
        <p className="text-slate-500 text-sm mt-1">All scheduled class sessions across your courses.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
      )}

      {/* ── Faculty: pending sessions popup ── */}
      {showPendingModal && pendingSessions.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl border border-amber-200 p-6 max-w-md w-full mx-4 animate-in zoom-in duration-200">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 text-amber-700">
                <AlertCircle size={20} />
                <h3 className="font-bold text-base">Action Required</h3>
              </div>
              <button onClick={() => setShowPendingModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-700 mb-4">
              You have <strong>{pendingSessions.length}</strong> past session{pendingSessions.length > 1 ? 's' : ''} with no status update.
              Please mark them as completed, cancelled, or rescheduled.
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto mb-4">
              {pendingSessions.map(s => (
                <div key={s.id} className="text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-amber-800">
                  <span className="font-semibold">{s.course_code}</span> · Session {s.session_number}: {s.session_title}
                  <span className="ml-1 text-amber-600">— {new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setShowPendingModal(false)} className="w-full py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black">
              Got it — I'll update them
            </button>
          </div>
        </div>
      )}

      {/* ── Reschedule modal ── */}
      {rescheduleSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full mx-4 animate-in zoom-in duration-200">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-bold text-base text-slate-800">Reschedule Session</h3>
              <button onClick={() => setRescheduleSession(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              <span className="font-semibold">{rescheduleSession.course_code}</span> — {rescheduleSession.session_title}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">New Date</label>
                <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Start</label>
                  <input type="time" value={rescheduleStart} onChange={e => setRescheduleStart(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">End</label>
                  <input type="time" value={rescheduleEnd} onChange={e => setRescheduleEnd(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-moodle-blue" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setRescheduleSession(null)}
                className="flex-1 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleReschedule} disabled={!rescheduleDate || rescheduleLoading}
                className="flex-1 py-2 bg-moodle-blue text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
                {rescheduleLoading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ── Left: Month grid ── */}
        <div className="xl:col-span-2 moodle-card p-6">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
                <ChevronLeft size={18} />
              </button>
              <h3 className="text-lg font-bold text-slate-800 w-44 text-center select-none">
                {MONTHS[month]} {year}
              </h3>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
                <ChevronRight size={18} />
              </button>
            </div>
            <button onClick={goToday}
              className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:border-moodle-blue hover:text-moodle-blue transition-colors">
              Today
            </button>
          </div>

          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-moodle-blue" />
            </div>
          ) : (
            <>
              {/* Weekday headers */}
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS_SHORT.map(d => (
                  <div key={d} className="text-center text-[11px] font-bold text-slate-400 uppercase py-2">{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7 border-l border-t border-slate-100">
                {cells.map((dateStr, i) => {
                  if (!dateStr) {
                    return <div key={`empty-${i}`} className="border-r border-b border-slate-100 bg-slate-50/50 min-h-[100px]" />;
                  }
                  const isPast = dateStr < todayStr;
                  const isToday = dateStr === todayStr;
                  const isSelected = dateStr === selectedDate;
                  const daySessions = sessionsByDate.get(dateStr) ?? [];
                  const dayNum = parseInt(dateStr.slice(8), 10);

                  return (
                    <button
                      key={dateStr}
                      onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                      className={`
                        border-r border-b border-slate-100 min-h-[100px] p-1.5 text-left flex flex-col gap-0.5 transition-colors group
                        ${isSelected ? 'bg-blue-50/80' : isPast ? 'bg-white' : 'bg-white hover:bg-slate-50/70'}
                      `}
                    >
                      {/* Day number */}
                      <span className={`
                        text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-0.5 shrink-0 self-start
                        ${isToday ? 'bg-moodle-blue text-white' : isPast ? 'text-slate-300' : 'text-slate-700 group-hover:text-slate-900'}
                      `}>
                        {dayNum}
                      </span>

                      {/* Session pills — Google Calendar style */}
                      <div className="flex flex-col gap-0.5 w-full min-w-0">
                        {daySessions.slice(0, 3).map(s => {
                          const c = colourFor(s.course_id);
                          const statusStrike = s.session_status === 'cancelled' ? 'opacity-40 line-through' : '';
                          const leftBorderColour =
                            s.session_status === 'completed' ? 'border-l-emerald-500' :
                            s.session_status === 'cancelled' ? 'border-l-red-400' :
                            s.session_status === 'rescheduled' ? 'border-l-amber-400' :
                            isPast && (!s.session_status || s.session_status === 'scheduled') ? 'border-l-orange-400' :
                            c.border;
                          return (
                            <span
                              key={s.id}
                              className={`
                                text-[10px] font-medium px-1.5 py-0.5 rounded-sm truncate flex items-center gap-1
                                border-l-2 ${leftBorderColour}
                                ${c.pill} ${statusStrike}
                              `}
                              title={`${s.course_code} · ${s.session_title}${s.start_time ? ` · ${formatTime(s.start_time)}` : ''}`}
                            >
                              {s.start_time && (
                                <span className="shrink-0 font-semibold">{formatTime(s.start_time)}</span>
                              )}
                              <span className="truncate">{s.course_code}</span>
                            </span>
                          );
                        })}
                        {daySessions.length > 3 && (
                          <span className="text-[10px] text-slate-400 px-1 font-medium">+{daySessions.length - 3} more</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Right: Day detail + legend ── */}
        <div className="space-y-4">

          {/* Day detail panel */}
          <div className="moodle-card overflow-hidden">
            {selectedDate ? (
              <>
                {/* Header */}
                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        {WEEKDAYS_FULL[new Date(selectedDate + 'T12:00:00').getDay()]}
                      </p>
                      <p className="text-base font-bold text-slate-800 mt-0.5">
                        {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
                          month: 'long', day: 'numeric', year: 'numeric',
                        })}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {selectedDate === todayStr && (
                        <span className="text-[10px] font-bold text-moodle-blue bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">Today</span>
                      )}
                      {selectedDate < todayStr && (
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">Past</span>
                      )}
                      <button onClick={() => setSelectedDate(null)} className="text-slate-300 hover:text-slate-500">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {selectedSessions.length > 0 && (
                    <p className="text-xs text-slate-500 mt-1.5">
                      {selectedSessions.length} session{selectedSessions.length > 1 ? 's' : ''} scheduled
                    </p>
                  )}
                </div>

                {/* Sessions */}
                <div className="p-4 space-y-3 max-h-[520px] overflow-y-auto">
                  {selectedSessions.length === 0 ? (
                    <div className="flex flex-col items-center py-8 text-center gap-2">
                      <BookOpen size={28} className="text-slate-200" />
                      <p className="text-sm text-slate-400">No sessions on this day.</p>
                    </div>
                  ) : (
                    selectedSessions.map(s => {
                      const c = colourFor(s.course_id);
                      const isPast = s.session_date < todayStr;
                      const isCancelled = s.session_status === 'cancelled';
                      return (
                        <div
                          key={s.id}
                          className={`rounded-xl border border-slate-100 overflow-hidden transition-opacity ${isCancelled ? 'opacity-50' : ''}`}
                        >
                          {/* Colour top stripe */}
                          <div className={`px-4 py-2.5 flex items-center gap-2 ${c.badge} border-b border-slate-100`}>
                            <div className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                            <span className="text-[11px] font-bold uppercase tracking-wider truncate">
                              {s.course_code} · Session {s.session_number}
                            </span>
                            <div className="ml-auto shrink-0">
                              <StatusBadge status={s.session_status} isPast={isPast} />
                            </div>
                          </div>

                          {/* Body */}
                          <div className="px-4 py-3 bg-white space-y-2">
                            <p className="text-sm font-semibold text-slate-800 leading-snug">{s.session_title}</p>
                            <p className="text-xs text-slate-500 truncate">{s.course_name}</p>

                            {/* Meta rows */}
                            <div className="space-y-1.5 pt-1">
                              {/* Time */}
                              {(s.start_time || s.end_time) ? (
                                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                  <Clock size={12} className="text-slate-400 shrink-0" />
                                  <span className="font-medium">
                                    {formatTime(s.start_time)}
                                    {s.end_time ? ` – ${formatTime(s.end_time)}` : ''}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-xs text-slate-400 italic">
                                  <Clock size={12} className="shrink-0" />
                                  <span>No time set</span>
                                </div>
                              )}

                              {/* Date (explicit) */}
                              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                <span className="text-slate-400 text-[10px] w-3 text-center">📅</span>
                                <span>{new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                              </div>

                              {/* Mode / location */}
                              {s.mode && (
                                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                  <MapPin size={12} className="text-slate-400 shrink-0" />
                                  <span>{s.mode}</span>
                                </div>
                              )}

                              {/* Professor */}
                              {s.faculty_name && (
                                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                  <User size={12} className="text-slate-400 shrink-0" />
                                  <span>{isFaculty ? 'You' : s.faculty_name}</span>
                                </div>
                              )}

                              {/* Rescheduled: show original date */}
                              {s.original_date && s.session_status === 'rescheduled' && (
                                <p className="text-[10px] text-slate-400 pl-4">
                                  Originally: {new Date(s.original_date + 'T12:00:00').toLocaleDateString()}
                                </p>
                              )}
                            </div>

                            {/* Faculty action buttons */}
                            {isFaculty && s.session_status !== 'completed' && s.session_status !== 'cancelled' && (
                              <div className="pt-2 border-t border-slate-50 flex flex-wrap gap-1.5">
                                {actionNotice?.id === s.id && (
                                  <p className="text-[10px] text-red-600 w-full">{actionNotice.msg}</p>
                                )}
                                <button
                                  disabled={actionLoading === s.id}
                                  onClick={() => handleStatusUpdate(s.id, 'completed')}
                                  className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
                                >
                                  <CheckCircle2 size={10} /> Mark Complete
                                </button>
                                <button
                                  disabled={actionLoading === s.id}
                                  onClick={() => handleStatusUpdate(s.id, 'cancelled')}
                                  className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold bg-red-50 border border-red-200 text-red-600 rounded-lg hover:bg-red-100 disabled:opacity-50"
                                >
                                  <XCircle size={10} /> Cancel
                                </button>
                                <button
                                  onClick={() => {
                                    setRescheduleSession(s);
                                    setRescheduleDate(s.session_date);
                                    setRescheduleStart(s.start_time || '');
                                    setRescheduleEnd(s.end_time || '');
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold bg-amber-50 border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-100"
                                >
                                  <RotateCcw size={10} /> Reschedule
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-3 px-6">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                  <BookOpen size={22} className="text-slate-300" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-500">Select a date</p>
                  <p className="text-xs text-slate-400 mt-0.5">Click any date on the calendar to view session details</p>
                </div>
              </div>
            )}
          </div>

          {/* Course legend */}
          {sessions.length > 0 && (
            <div className="moodle-card p-5">
              <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Courses</h4>
              <div className="space-y-2">
                {uniqueCourses.map(s => {
                  const c = colourFor(s.course_id);
                  return (
                    <div key={s.course_id} className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.dot}`} />
                      <span className="text-xs text-slate-700 truncate">
                        <span className="font-semibold">{s.course_code}</span>
                        <span className="text-slate-400"> · {s.course_name}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              {isFaculty && (
                <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Status</p>
                  {[
                    { dot: 'bg-emerald-500', label: 'Completed' },
                    { dot: 'bg-red-400',    label: 'Cancelled' },
                    { dot: 'bg-amber-400',  label: 'Rescheduled' },
                    { dot: 'bg-orange-400', label: 'Unmarked (past)' },
                  ].map(({ dot, label }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                      <span className="text-xs text-slate-500">{label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Calendar;
