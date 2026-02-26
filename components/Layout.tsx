
import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  CalendarDays, 
  FileText, 
  BrainCircuit, 
  BarChart3, 
  Search, 
  Bell, 
  UserCircle,
  Zap,
  Settings,
  PieChart,
  Users,
  Menu,
  X,
  MessageSquare,
  ChevronRight,
  Home,
  GraduationCap,
  BookOpen
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const getBreadcrumbs = () => {
    const crumbs = [{ label: 'Home', tab: NavigationTab.DASHBOARD }];
    
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
        crumbs.push({ label: 'Home', tab: NavigationTab.FACULTY_SETUP });
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
          
          <div className="flex items-center space-x-2 cursor-pointer" onClick={() => onTabChange(NavigationTab.DASHBOARD)}>
            <div className="w-8 h-8 bg-moodle-blue rounded flex items-center justify-center text-white">
              <GraduationCap size={20} />
            </div>
            <span className="text-xl font-bold text-slate-800 hidden sm:block tracking-tight">W<span className="text-moodle-blue">I</span>SENET</span>
          </div>

          <nav className="hidden md:flex items-center ml-4">
            <NavItem 
              label="Home" 
              active={activeTab === NavigationTab.DASHBOARD} 
              onClick={() => onTabChange(NavigationTab.DASHBOARD)} 
            />
            <NavItem 
              label="Dashboard" 
              active={activeTab === NavigationTab.DASHBOARD} 
              onClick={() => onTabChange(NavigationTab.DASHBOARD)} 
            />
            <NavItem 
              label="My courses" 
              active={activeTab === NavigationTab.BOOSTER} 
              onClick={() => onTabChange(NavigationTab.BOOSTER)} 
            />
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
                  active={activeTab === NavigationTab.BOOSTER}
                  onClick={() => onTabChange(NavigationTab.BOOSTER)}
                />
                
                <div className="pt-4 pb-2 px-4 text-xs font-bold text-slate-400 uppercase tracking-wider">My courses</div>
                <div className="space-y-1 px-2">
                  <button className="w-full flex items-center space-x-2 px-2 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded transition-colors text-left">
                    <div className="w-2 h-2 bg-moodle-blue rounded-full shrink-0"></div>
                    <span className="truncate">Business Communication - I</span>
                  </button>
                  <button className="w-full flex items-center space-x-2 px-2 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded transition-colors text-left">
                    <div className="w-2 h-2 bg-moodle-orange rounded-full shrink-0"></div>
                    <span className="truncate">Business Policy & Strategy - I</span>
                  </button>
                  <button className="w-full flex items-center space-x-2 px-2 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded transition-colors text-left">
                    <div className="w-2 h-2 bg-green-500 rounded-full shrink-0"></div>
                    <span className="truncate">Decision Analysis Simulation</span>
                  </button>
                </div>

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
                <SidebarItem 
                  icon={<BarChart3 size={18} />} 
                  label="Learning Insights" 
                  active={activeTab === NavigationTab.REPORTS}
                  onClick={() => onTabChange(NavigationTab.REPORTS)}
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
                  active={activeTab === NavigationTab.DASHBOARD}
                  onClick={() => onTabChange(NavigationTab.DASHBOARD)}
                />
                <SidebarItem 
                  icon={<BookOpen size={18} />} 
                  label="My courses" 
                  active={false}
                  onClick={() => {}}
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
          
          <div className="p-4 border-t border-slate-200">
            <div className="bg-white rounded-lg p-3 border border-slate-200 shadow-sm">
              <div className="flex items-center space-x-2 mb-2">
                <BrainCircuit size={16} className="text-moodle-blue" />
                <span className="text-xs font-bold text-slate-700">AI Assistant</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-tight mb-2">Need help with your course material?</p>
              <button className="w-full py-1.5 bg-moodle-blue text-white rounded text-[10px] font-semibold hover:bg-blue-700 transition-colors">
                Ask Ekosh
              </button>
            </div>
          </div>
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
