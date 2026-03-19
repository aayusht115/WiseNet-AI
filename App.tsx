
import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
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
  const [courseInitialTab, setCourseInitialTab] = useState<'course' | 'feedback'>('course');

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
            onSelectCourse={(id) => {
              setSelectedCourseId(id);
              setCourseInitialTab('course');
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

export default App;
