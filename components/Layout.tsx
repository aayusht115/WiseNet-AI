
import React, { useEffect, useState } from 'react';
import { 
  LayoutDashboard, 
  CalendarDays, 
  FileText, 
  Search, 
  Bell, 
  UserCircle,
  Zap,
  Settings,
  PieChart,
  Users,
  Menu,
  MessageSquare,
  ChevronRight,
  Home,
  GraduationCap,
  BookOpen,
  Clock3,
  RotateCcw
} from 'lucide-react';
import { NavigationTab, UserRole, User } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
  role: UserRole;
  user: User;
  onLogout: () => void;
}

const NavItem: React.FC<{ 
  label: string; 
  active: boolean; 
  onClick: () => void 
}> = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`px-4 py-5 text-sm font-medium transition-all border-b-2 ${
      active 
        ? 'border-moodle-blue text-moodle-blue' 
        : 'border-transparent text-slate-600 hover:text-moodle-blue hover:bg-slate-50'
    }`}
  >
    {label}
  </button>
);

const SidebarItem: React.FC<{ 
  icon: React.ReactNode; 
  label: string; 
  active: boolean; 
  onClick: () => void 
}> = ({ icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-md transition-all duration-200 ${
      active 
        ? 'bg-blue-50 text-moodle-blue font-semibold border-l-4 border-moodle-blue' 
        : 'text-slate-600 hover:bg-slate-100'
    }`}
  >
    <span className={active ? 'text-moodle-blue' : 'text-slate-400'}>{icon}</span>
    <span className="text-sm">{label}</span>
  </button>
);

const Layout: React.FC<LayoutProps> = ({ children, activeTab, onTabChange, role, user, onLogout }) => {
  const TIME_OVERRIDE_KEY = "wisenet_time_override";
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isTimeDialogOpen, setIsTimeDialogOpen] = useState(false);
  const [activeTimeOverride, setActiveTimeOverride] = useState<string>("");
  const [timeInputValue, setTimeInputValue] = useState<string>("");

  const toLocalDateTimeInput = (isoString: string) => {
    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) return "";
    const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  };

  useEffect(() => {
    const stored = localStorage.getItem(TIME_OVERRIDE_KEY) || "";
    setActiveTimeOverride(stored);
    setTimeInputValue(stored ? toLocalDateTimeInput(stored) : "");
  }, []);

  const saveTimeOverride = () => {
    if (!timeInputValue) return;
    const parsed = new Date(timeInputValue);
    if (Number.isNaN(parsed.getTime())) return;
    const iso = parsed.toISOString();
    localStorage.setItem(TIME_OVERRIDE_KEY, iso);
    setActiveTimeOverride(iso);
    window.dispatchEvent(new CustomEvent("wisenet-time-override-updated"));
    setIsTimeDialogOpen(false);
  };

  const resetTimeOverride = () => {
    localStorage.removeItem(TIME_OVERRIDE_KEY);
    setActiveTimeOverride("");
    setTimeInputValue("");
    window.dispatchEvent(new CustomEvent("wisenet-time-override-updated"));
    setIsTimeDialogOpen(false);
  };

  const getBreadcrumbs = () => {
    const crumbs = [
      {
        label: 'Home',
        tab: role === "faculty" ? NavigationTab.FACULTY_SETUP : NavigationTab.DASHBOARD,
      },
    ];
    
    switch (activeTab) {
      case NavigationTab.DASHBOARD:
        crumbs.push({ label: 'Dashboard', tab: NavigationTab.DASHBOARD });
        break;
      case NavigationTab.BOOSTER:
      case NavigationTab.LEARN_MODE:
      case NavigationTab.QUIZ:
        crumbs.push({ label: 'My Courses', tab: NavigationTab.DASHBOARD });
        crumbs.push({ label: 'Pre-read Booster', tab: NavigationTab.BOOSTER });
        break;
      case NavigationTab.PLANNER:
        crumbs.push({ label: 'Smart Planner', tab: NavigationTab.PLANNER });
        break;
      case NavigationTab.REPORTS:
        crumbs.push({ label: 'Learning Analytics', tab: NavigationTab.REPORTS });
        break;
      case NavigationTab.FACULTY_SETUP:
        crumbs.push({ label: 'Home', tab: NavigationTab.FACULTY_SETUP });
        break;
      case NavigationTab.COURSE_EDITOR:
        crumbs.push({ label: 'Home', tab: NavigationTab.FACULTY_SETUP });
        crumbs.push({ label: 'Add a new course', tab: NavigationTab.COURSE_EDITOR });
        break;
      case NavigationTab.COURSE_MANAGEMENT:
        crumbs.push({ label: 'Home', tab: role === "faculty" ? NavigationTab.FACULTY_SETUP : NavigationTab.DASHBOARD });
        crumbs.push({ label: 'Course Management', tab: NavigationTab.COURSE_MANAGEMENT });
        break;
      case NavigationTab.FACULTY_ANALYTICS:
        crumbs.push({ label: 'Faculty', tab: NavigationTab.FACULTY_ANALYTICS });
        crumbs.push({ label: 'Class Analytics', tab: NavigationTab.FACULTY_ANALYTICS });
        break;
    }
    return crumbs;
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      {/* Moodle Navbar */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-30 shrink-0">
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-slate-100 rounded-md text-slate-600"
          >
            <Menu size={20} />
          </button>
          
          <div
            className="flex items-center space-x-2 cursor-pointer"
            onClick={() =>
              onTabChange(role === "faculty" ? NavigationTab.FACULTY_SETUP : NavigationTab.DASHBOARD)
            }
          >
            <div className="w-8 h-8 bg-moodle-blue rounded flex items-center justify-center text-white">
              <GraduationCap size={20} />
            </div>
            <span className="text-xl font-bold text-slate-800 hidden sm:block tracking-tight">W<span className="text-moodle-blue">I</span>SENET</span>
          </div>

          <nav className="hidden md:flex items-center ml-4">
            <NavItem 
              label="Home" 
              active={role === "student" ? activeTab === NavigationTab.DASHBOARD : activeTab === NavigationTab.FACULTY_SETUP}
              onClick={() =>
                onTabChange(role === "student" ? NavigationTab.DASHBOARD : NavigationTab.FACULTY_SETUP)
              }
            />
            <NavItem 
              label="Dashboard" 
              active={
                role === "student"
                  ? activeTab === NavigationTab.DASHBOARD
                  : activeTab === NavigationTab.FACULTY_ANALYTICS
              }
              onClick={() =>
                onTabChange(
                  role === "student" ? NavigationTab.DASHBOARD : NavigationTab.FACULTY_ANALYTICS
                )
              }
            />
            {role === "student" ? (
              <NavItem
                label="My courses"
                active={activeTab === NavigationTab.DASHBOARD || activeTab === NavigationTab.COURSE_MANAGEMENT}
                onClick={() => onTabChange(NavigationTab.DASHBOARD)}
              />
            ) : (
              <NavItem
                label="My courses"
                active={activeTab === NavigationTab.FACULTY_SETUP || activeTab === NavigationTab.COURSE_MANAGEMENT}
                onClick={() => onTabChange(NavigationTab.FACULTY_SETUP)}
              />
            )}
          </nav>
        </div>
        
        <div className="flex items-center space-x-2 sm:space-x-4">
          <div className="hidden lg:flex items-center bg-slate-100 rounded-md px-3 py-1.5">
            <Search size={16} className="text-slate-400 mr-2" />
            <input 
              type="text" 
              placeholder="Search..." 
              className="bg-transparent border-none focus:ring-0 text-sm w-32 outline-none"
            />
          </div>

          <button
            onClick={() => setIsTimeDialogOpen((prev) => !prev)}
            className={`px-2.5 py-1.5 rounded-md border text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${
              activeTimeOverride
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
            title="Set test time for feedback/todo checks"
          >
            <Clock3 size={14} />
            {activeTimeOverride ? "Custom Time" : "Time"}
          </button>

          <button className="p-2 text-slate-500 hover:text-moodle-blue transition-colors relative">
            <Bell size={20} />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
          </button>
          
          <button className="p-2 text-slate-500 hover:text-moodle-blue transition-colors">
            <MessageSquare size={20} />
          </button>

          <div className="relative">
            <div 
              className="flex items-center space-x-2 pl-2 border-l border-slate-200 cursor-pointer group"
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            >
              <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center overflow-hidden">
                <UserCircle className="text-slate-400" size={32} />
              </div>
              <span className="text-sm font-medium text-slate-700 hidden sm:block group-hover:text-moodle-blue">
                {user.name}
              </span>
            </div>

            {isUserMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 border border-slate-200">
                <button className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">Profile</button>
                <button className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">Grades</button>
                <button className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">Messages</button>
                <button className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">Preferences</button>
                <div className="border-t border-slate-100 my-1"></div>
                <button 
                  onClick={onLogout}
                  className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {isTimeDialogOpen ? (
        <div className="absolute right-4 top-16 w-80 bg-white rounded-lg border border-slate-200 shadow-xl p-4 z-50 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">Dashboard Time Settings</p>
            <button
              onClick={() => setIsTimeDialogOpen(false)}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Close
            </button>
          </div>
          <p className="text-xs text-slate-500">
            System time: {new Date().toLocaleString()}
          </p>
          <label className="text-xs font-semibold text-slate-700 block">
            Custom test time
            <input
              type="datetime-local"
              value={timeInputValue}
              onChange={(event) => setTimeInputValue(event.target.value)}
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-xs"
            />
          </label>
          {activeTimeOverride ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              Active override: {new Date(activeTimeOverride).toLocaleString()}
            </p>
          ) : (
            <p className="text-xs text-slate-500">No override active. Feedback checks use live current time.</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={saveTimeOverride}
              className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-bold"
            >
              Save custom time
            </button>
            <button
              onClick={resetTimeOverride}
              className="px-3 py-1.5 border border-slate-300 rounded text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
            >
              <RotateCcw size={12} />
              Reset to current
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        {/* Moodle Sidebar */}
        <aside 
          className={`bg-slate-50 border-r border-slate-200 flex flex-col transition-all duration-300 ease-in-out ${
            isSidebarOpen ? 'w-64' : 'w-0 overflow-hidden border-none'
          }`}
        >
          <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
            {role === 'student' ? (
              <>
                <SidebarItem 
                  icon={<Home size={18} />} 
                  label="Home" 
                  active={activeTab === NavigationTab.DASHBOARD}
                  onClick={() => onTabChange(NavigationTab.DASHBOARD)}
                />
                <SidebarItem 
                  icon={<LayoutDashboard size={18} />} 
                  label="Dashboard" 
                  active={activeTab === NavigationTab.DASHBOARD}
                  onClick={() => onTabChange(NavigationTab.DASHBOARD)}
                />
                <SidebarItem 
                  icon={<BookOpen size={18} />} 
                  label="My courses" 
                  active={activeTab === NavigationTab.DASHBOARD || activeTab === NavigationTab.COURSE_MANAGEMENT}
                  onClick={() => onTabChange(NavigationTab.DASHBOARD)}
                />

                <div className="pt-4 pb-2 px-4 text-xs font-bold text-slate-400 uppercase tracking-wider">AI Enhancements</div>
                <SidebarItem 
                  icon={<Zap size={18} />} 
                  label="Pre-read Booster" 
                  active={activeTab === NavigationTab.BOOSTER || activeTab === NavigationTab.LEARN_MODE || activeTab === NavigationTab.QUIZ}
                  onClick={() => onTabChange(NavigationTab.BOOSTER)}
                />
                <SidebarItem 
                  icon={<CalendarDays size={18} />} 
                  label="Smart Planner" 
                  active={activeTab === NavigationTab.PLANNER}
                  onClick={() => onTabChange(NavigationTab.PLANNER)}
                />
              </>
            ) : (
              <>
                <SidebarItem 
                  icon={<Home size={18} />} 
                  label="Home" 
                  active={activeTab === NavigationTab.FACULTY_SETUP}
                  onClick={() => onTabChange(NavigationTab.FACULTY_SETUP)}
                />
                <SidebarItem 
                  icon={<LayoutDashboard size={18} />} 
                  label="Dashboard" 
                  active={activeTab === NavigationTab.FACULTY_ANALYTICS}
                  onClick={() => onTabChange(NavigationTab.FACULTY_ANALYTICS)}
                />
                <SidebarItem 
                  icon={<BookOpen size={18} />} 
                  label="My courses" 
                  active={activeTab === NavigationTab.FACULTY_SETUP || activeTab === NavigationTab.COURSE_MANAGEMENT}
                  onClick={() => onTabChange(NavigationTab.FACULTY_SETUP)}
                />
                <SidebarItem 
                  icon={<PieChart size={18} />} 
                  label="Class Analytics" 
                  active={activeTab === NavigationTab.FACULTY_ANALYTICS}
                  onClick={() => onTabChange(NavigationTab.FACULTY_ANALYTICS)}
                />
                <SidebarItem 
                  icon={<Settings size={18} />} 
                  label="Site administration" 
                  active={false}
                  onClick={() => {}}
                />
              </>
            )}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden bg-white">
          {/* Page Header & Breadcrumbs */}
          <div className="px-8 py-6 border-b border-slate-100 shrink-0 bg-slate-50/50">
            <nav className="flex items-center space-x-2 text-sm text-slate-500 mb-4">
              {getBreadcrumbs().map((crumb, idx) => (
                <React.Fragment key={idx}>
                  <button 
                    onClick={() => onTabChange(crumb.tab)}
                    className={`hover:text-moodle-blue hover:underline ${idx === getBreadcrumbs().length - 1 ? 'text-slate-800 font-medium' : ''}`}
                  >
                    {crumb.label}
                  </button>
                  {idx < getBreadcrumbs().length - 1 && <ChevronRight size={14} />}
                </React.Fragment>
              ))}
            </nav>
            
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <h1 className="text-3xl font-bold text-slate-900">
                {getBreadcrumbs()[getBreadcrumbs().length - 1].label}
              </h1>
              
              <div className="flex items-center space-x-3">
                <button className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                  Edit mode
                </button>
              </div>
            </div>
          </div>

          {/* Dynamic Page Content */}
          <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-7xl mx-auto">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
