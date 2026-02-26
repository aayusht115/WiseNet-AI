import React, { useMemo } from "react";
import { CourseSession } from "../types";

interface ScheduleBoardProps {
  sessions: CourseSession[];
  title?: string;
}

function toYmd(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const ScheduleBoard: React.FC<ScheduleBoardProps> = ({ sessions, title = "Course Schedule" }) => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekdayOffset = firstDay.getDay();

  const sessionByDate = useMemo(() => {
    const map = new Map<string, CourseSession[]>();
    sessions.forEach((session) => {
      const key = String(session.session_date).slice(0, 10);
      const list = map.get(key) || [];
      list.push(session);
      map.set(key, list);
    });
    return map;
  }, [sessions]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className="moodle-card p-5">
        <h3 className="text-lg font-bold text-slate-800 mb-3">{title} Calendar</h3>
        <div className="grid grid-cols-7 gap-1 text-[11px] text-slate-500 mb-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="text-center font-semibold py-1">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: weekdayOffset }).map((_, idx) => (
            <div key={`blank-${idx}`} className="h-16 rounded border border-transparent" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const day = idx + 1;
            const currentDate = new Date(year, month, day);
            const key = toYmd(currentDate);
            const daySessions = sessionByDate.get(key) || [];
            const isToday = key === toYmd(today);
            return (
              <div
                key={key}
                className={`h-16 rounded border p-1 overflow-hidden ${
                  isToday ? "border-moodle-blue bg-blue-50" : "border-slate-200"
                }`}
              >
                <div className="text-[11px] font-bold text-slate-700">{day}</div>
                {daySessions.slice(0, 2).map((session) => (
                  <div
                    key={session.id}
                    className="text-[10px] mt-0.5 truncate bg-slate-100 rounded px-1 py-0.5 text-slate-700"
                  >
                    S{session.session_number}
                  </div>
                ))}
                {daySessions.length > 2 ? (
                  <div className="text-[10px] text-slate-400 mt-0.5">+{daySessions.length - 2} more</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="moodle-card p-5 overflow-x-auto">
        <h3 className="text-lg font-bold text-slate-800 mb-3">{title} Timetable</h3>
        {sessions.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No sessions scheduled yet.</p>
        ) : (
          <table className="min-w-full text-sm border border-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 border text-left">Session</th>
                <th className="px-3 py-2 border text-left">Title</th>
                <th className="px-3 py-2 border text-left">Date</th>
                <th className="px-3 py-2 border text-left">Time</th>
                <th className="px-3 py-2 border text-left">Mode</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td className="px-3 py-2 border font-semibold">S{session.session_number}</td>
                  <td className="px-3 py-2 border">{session.title}</td>
                  <td className="px-3 py-2 border">
                    {new Date(session.session_date).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 border">
                    {session.start_time || "--"} - {session.end_time || "--"}
                  </td>
                  <td className="px-3 py-2 border capitalize">{session.mode || "classroom"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ScheduleBoard;
