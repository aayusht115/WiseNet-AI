import React, { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Clock, MapPin, BookOpen } from 'lucide-react';

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
}

// Stable colour palette — one colour per unique course_id
const COURSE_COLOURS = [
  { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200', dot: 'bg-blue-500' },
  { bg: 'bg-violet-100', text: 'text-violet-800', border: 'border-violet-200', dot: 'bg-violet-500' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', dot: 'bg-amber-500' },
  { bg: 'bg-pink-100', text: 'text-pink-800', border: 'border-pink-200', dot: 'bg-pink-500' },
  { bg: 'bg-teal-100', text: 'text-teal-800', border: 'border-teal-200', dot: 'bg-teal-500' },
  { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200', dot: 'bg-orange-500' },
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

const MONTHS = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const Calendar: React.FC = () => {
  const now = useNow();
  const todayStr = now.toISOString().slice(0, 10);

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/calendar', { credentials: 'include' })
      .then(async r => {
        const text = await r.text();
        if (!r.ok) {
          // Try to parse as JSON error, fall back to status text
          try {
            const d = JSON.parse(text);
            throw new Error(d.error || `Server error ${r.status}`);
          } catch {
            throw new Error(`Server error ${r.status} — try restarting the server`);
          }
        }
        return JSON.parse(text) as CalendarSession[];
      })
      .then(data => setSessions(data))
      .catch((e: any) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  // Assign a stable colour index to each unique course_id
  const courseColourMap = React.useMemo(() => {
    const map = new Map<number, number>();
    let idx = 0;
    for (const s of sessions) {
      if (!map.has(s.course_id)) {
        map.set(s.course_id, idx % COURSE_COLOURS.length);
        idx++;
      }
    }
    return map;
  }, [sessions]);

  const colourFor = (courseId: number) =>
    COURSE_COLOURS[courseColourMap.get(courseId) ?? 0];

  // Build a map from YYYY-MM-DD → sessions
  const sessionsByDate = React.useMemo(() => {
    const map = new Map<string, CalendarSession[]>();
    for (const s of sessions) {
      const existing = map.get(s.session_date) ?? [];
      existing.push(s);
      map.set(s.session_date, existing);
    }
    return map;
  }, [sessions]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };
  const goToday = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setSelectedDate(todayStr);
  };

  // Build the grid: weeks × 7 days
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array(firstDayOfMonth).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }),
  ];
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedSessions = selectedDate ? (sessionsByDate.get(selectedDate) ?? []) : [];

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Course Calendar</h2>
        <p className="text-slate-500 text-sm mt-1">All scheduled class sessions across your courses.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded p-4 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Month grid */}
        <div className="xl:col-span-2 moodle-card p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <button onClick={prevMonth} className="p-1.5 rounded hover:bg-slate-100 text-slate-600">
                <ChevronLeft size={18} />
              </button>
              <h3 className="text-lg font-bold text-slate-800 w-44 text-center">
                {MONTHS[month]} {year}
              </h3>
              <button onClick={nextMonth} className="p-1.5 rounded hover:bg-slate-100 text-slate-600">
                <ChevronRight size={18} />
              </button>
            </div>
            <button
              onClick={goToday}
              className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded hover:border-moodle-blue hover:text-moodle-blue transition-colors"
            >
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
              <div className="grid grid-cols-7 mb-2">
                {WEEKDAYS.map(d => (
                  <div key={d} className="text-center text-xs font-bold text-slate-400 uppercase py-1">{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7 gap-px bg-slate-100 rounded-lg overflow-hidden border border-slate-100">
                {cells.map((dateStr, i) => {
                  if (!dateStr) {
                    return <div key={`empty-${i}`} className="bg-slate-50 h-20 sm:h-24" />;
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
                        relative bg-white h-20 sm:h-24 p-1.5 text-left flex flex-col transition-colors
                        ${isPast ? 'opacity-40' : 'hover:bg-blue-50'}
                        ${isSelected ? 'ring-2 ring-inset ring-moodle-blue bg-blue-50' : ''}
                      `}
                    >
                      <span className={`
                        text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full shrink-0
                        ${isToday ? 'bg-moodle-blue text-white' : 'text-slate-700'}
                      `}>
                        {dayNum}
                      </span>
                      <div className="flex flex-col gap-0.5 mt-0.5 overflow-hidden w-full">
                        {daySessions.slice(0, 2).map(s => {
                          const c = colourFor(s.course_id);
                          return (
                            <span
                              key={s.id}
                              className={`text-[10px] font-medium px-1 py-0.5 rounded truncate ${c.bg} ${c.text}`}
                            >
                              {s.course_code}
                            </span>
                          );
                        })}
                        {daySessions.length > 2 && (
                          <span className="text-[10px] text-slate-400 px-1">+{daySessions.length - 2} more</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Right panel: selected day detail + legend */}
        <div className="space-y-4">
          {/* Selected day detail */}
          <div className="moodle-card p-5">
            {selectedDate ? (
              <>
                <h4 className="text-sm font-bold text-slate-800 mb-4">
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                  })}
                  {selectedDate < todayStr && (
                    <span className="ml-2 text-xs font-normal text-slate-400 bg-slate-100 rounded px-2 py-0.5">Completed</span>
                  )}
                  {selectedDate === todayStr && (
                    <span className="ml-2 text-xs font-normal text-moodle-blue bg-blue-50 rounded px-2 py-0.5">Today</span>
                  )}
                </h4>
                {selectedSessions.length === 0 ? (
                  <p className="text-sm text-slate-400">No sessions scheduled.</p>
                ) : (
                  <div className="space-y-3">
                    {selectedSessions.map(s => {
                      const c = colourFor(s.course_id);
                      const isPast = s.session_date < todayStr;
                      return (
                        <div key={s.id} className={`rounded-lg border p-3 ${c.border} ${isPast ? 'opacity-60' : ''}`}>
                          <div className="flex items-start gap-2">
                            <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${c.dot}`} />
                            <div className="min-w-0">
                              <p className={`text-xs font-bold uppercase tracking-wide ${c.text}`}>
                                {s.course_code} — Session {s.session_number}
                              </p>
                              <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{s.session_title}</p>
                              <p className="text-xs text-slate-500 mt-0.5 truncate">{s.course_name}</p>
                              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                {(s.start_time || s.end_time) && (
                                  <span className="flex items-center gap-1 text-xs text-slate-500">
                                    <Clock size={11} />
                                    {formatTime(s.start_time)}{s.end_time ? ` – ${formatTime(s.end_time)}` : ''}
                                  </span>
                                )}
                                {s.mode && (
                                  <span className="flex items-center gap-1 text-xs text-slate-500">
                                    <MapPin size={11} />
                                    {s.mode}
                                  </span>
                                )}
                              </div>
                              {isPast && (
                                <span className="inline-block mt-1.5 text-[10px] font-semibold text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">
                                  Class completed
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                <BookOpen size={32} className="text-slate-300" />
                <p className="text-sm text-slate-400">Select a day to see sessions</p>
              </div>
            )}
          </div>

          {/* Course legend */}
          {sessions.length > 0 && (
            <div className="moodle-card p-5">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Courses</h4>
              <div className="space-y-2">
                {[...new Map(sessions.map(s => [s.course_id, s])).values()].map(s => {
                  const c = colourFor(s.course_id);
                  return (
                    <div key={s.course_id} className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.dot}`} />
                      <span className="text-sm text-slate-700 truncate">
                        <span className="font-semibold">{s.course_code}</span> — {s.course_name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Calendar;
