
import React, { useState, useEffect, Component } from 'react';
import Layout from './components/Layout';

// ── Error Boundary ───────────────────────────────────────────────────────────
interface ErrorBoundaryState { hasError: boolean; message: string }
class ErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: err?.message ?? String(err) };
  }
  componentDidCatch(err: any, info: any) {
    console.error('WiseNet caught render error:', err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-8 text-center">
          <div className="max-w-md">
            <h1 className="text-2xl font-bold text-slate-800 mb-2">Something went wrong</h1>
            <p className="text-slate-500 text-sm mb-6">{this.state.message}</p>
            <button
              onClick={() => { this.setState({ hasError: false, message: '' }); window.location.reload(); }}
              className="px-6 py-2.5 bg-moodle-blue text-white rounded-lg font-semibold text-sm hover:bg-blue-700"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import Dashboard from './pages/Dashboard';
import Planner from './pages/Planner';
import Summarizer from './pages/Summarizer';
import Reflections from './pages/Reflections';
import PreReadBooster from './pages/PreReadBooster';
import LearnMode from './pages/LearnMode';
import FlashQuiz from './pages/FlashQuiz';
import FacultySetup from './pages/FacultySetup';
import FacultyAnalytics from './pages/FacultyAnalytics';
import FacultyCourseEditor from './pages/FacultyCourseEditor';
import CourseManagement from './pages/CourseManagement';
import Calendar from './pages/Calendar';
import LoginPage from './pages/LoginPage';
import { NavigationTab, PreReadSession, UserRole, User } from './types';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationTab>(NavigationTab.DASHBOARD);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<PreReadSession | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [highlightMaterialId, setHighlightMaterialId] = useState<number | undefined>(undefined);
  const [courseInitialTab, setCourseInitialTab] = useState<'course' | 'feedback' | 'analytics'>('course');

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        }
      } catch (err) {
        console.error("Auth check failed", err);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  const handleStartBooster = (session: PreReadSession) => {
    setActiveSession(session);
    setActiveTab(NavigationTab.LEARN_MODE);
  };

  const handleLogin = (userData: User) => {
    setUser(userData);
    setActiveTab(userData.role === 'faculty' ? NavigationTab.FACULTY_SETUP : NavigationTab.DASHBOARD);
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setActiveTab(NavigationTab.LOGIN);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-moodle-blue"></div>
    </div>;
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const renderContent = () => {
    // Override navigation if in specific workflows
    if (activeTab === NavigationTab.LEARN_MODE && activeSession) {
      return (
        <LearnMode 
          session={activeSession} 
          onExit={() => {
            setActiveSession(null);
            setActiveTab(NavigationTab.BOOSTER);
          }} 
          onComplete={() => setActiveTab(NavigationTab.QUIZ)}
        />
      );
    }

    if (activeTab === NavigationTab.QUIZ && activeSession) {
      return (
        <FlashQuiz 
          session={activeSession} 
          onFinish={(score, weakTopics) => {
            console.log("Quiz Finished:", score, weakTopics);
            setActiveSession(null);
            setActiveTab(NavigationTab.BOOSTER);
          }} 
        />
      );
    }

    switch (activeTab) {
      case NavigationTab.DASHBOARD:
        return (
          <Dashboard
            onOpenCourse={(id, initialTab) => {
              setSelectedCourseId(id);
              setCourseInitialTab(initialTab === 'feedback' ? 'feedback' : 'course');
              setActiveTab(NavigationTab.COURSE_MANAGEMENT);
            }}
            onOpenPreRead={(materialId) => {
              setHighlightMaterialId(materialId);
              setActiveTab(NavigationTab.BOOSTER);
            }}
          />
        );
      case NavigationTab.PLANNER:
        return <Planner />;
      case NavigationTab.CALENDAR:
        return <Calendar role={user.role} />;
      case NavigationTab.BOOSTER:
        return <PreReadBooster onStart={handleStartBooster} highlightMaterialId={highlightMaterialId} />;
      case NavigationTab.SUMMARIZER:
        return <Summarizer />;
      case NavigationTab.REFLECTIONS:
        return <Reflections />;
      case NavigationTab.FACULTY_SETUP:
        return (
          <FacultySetup 
            onAddCourse={() => {
              setSelectedCourseId(null);
              setCourseInitialTab('course');
              setActiveTab(NavigationTab.COURSE_EDITOR);
            }} 
            onSelectCourse={(id, tab) => {
              setSelectedCourseId(id);
              setCourseInitialTab(tab || 'course');
              setActiveTab(NavigationTab.COURSE_MANAGEMENT);
            }}
          />
        );
      case NavigationTab.COURSE_EDITOR:
        return (
          <FacultyCourseEditor 
            courseId={selectedCourseId || undefined}
            onSave={() => {
              setSelectedCourseId(null);
              setCourseInitialTab('course');
              setActiveTab(NavigationTab.FACULTY_SETUP);
            }}
            onSaveAndDisplay={(id) => {
              setSelectedCourseId(id);
              setCourseInitialTab('course');
              setActiveTab(NavigationTab.COURSE_MANAGEMENT);
            }}
            onCancel={() => {
              setSelectedCourseId(null);
              setCourseInitialTab('course');
              setActiveTab(NavigationTab.FACULTY_SETUP);
            }}
          />
        );
      case NavigationTab.COURSE_MANAGEMENT:
        return selectedCourseId ? (
          <CourseManagement 
            courseId={selectedCourseId}
            role={user.role}
            initialTab={courseInitialTab}
            onBack={() => {
              setSelectedCourseId(null);
              setCourseInitialTab('course');
              setActiveTab(user.role === 'faculty' ? NavigationTab.FACULTY_SETUP : NavigationTab.DASHBOARD);
            }}
          />
        ) : <Dashboard />;
      case NavigationTab.FACULTY_ANALYTICS:
        return <FacultyAnalytics />;
      default:
        return <Dashboard />;
    }
  };

  const isFullPage = activeTab === NavigationTab.LEARN_MODE && !!activeSession;

  return (
    <Layout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      role={user.role}
      user={user}
      onLogout={handleLogout}
      onUserUpdate={setUser}
      noPadding={isFullPage}
      onSelectCourse={(id) => {
        setSelectedCourseId(id);
        setCourseInitialTab('course');
        setActiveTab(NavigationTab.COURSE_MANAGEMENT);
      }}
    >
      {renderContent()}
    </Layout>
  );
};

const AppWithBoundary: React.FC = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithBoundary;
