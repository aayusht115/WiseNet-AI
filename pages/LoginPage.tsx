import React, { useState } from 'react';
import { UserCircle, Lock, GraduationCap, User } from 'lucide-react';

interface LoginPageProps {
  onLogin: (user: any) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regRole, setRegRole] = useState<'student' | 'faculty'>('student');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const switchMode = (next: 'login' | 'register') => {
    setError(null);
    setMode(next);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error('Invalid credentials');
      const user = await response.json();
      onLogin(user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (regPassword !== regConfirm) {
      setError('Passwords do not match');
      return;
    }
    if (regPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: regName, email: regEmail, password: regPassword, role: regRole }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Registration failed');
      onLogin(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-cover bg-center relative" style={{ backgroundImage: 'url("/SPJIMR_Mumbai_Campus.jpg")' }}>
      <div className="absolute inset-0 bg-black/20"></div>

      <div className="relative z-10 w-full max-w-md bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col p-8 m-4">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-12 h-12 bg-moodle-blue rounded flex items-center justify-center text-white">
            <GraduationCap size={32} />
          </div>
          <h1 className="text-4xl font-bold text-slate-800 tracking-tight">W<span className="text-moodle-blue">I</span>SENET</h1>
        </div>

        {/* Tab toggle */}
        <div className="flex mb-6 border border-slate-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-moodle-blue text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            Log In
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'register' ? 'bg-moodle-blue text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            Register
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded text-sm">
            {error}
          </div>
        )}

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <input
                type="email"
                placeholder="Email address"
                className="w-full moodle-input pl-10 py-3"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            </div>

            <div className="relative">
              <input
                type="password"
                placeholder="Password"
                className="w-full moodle-input pl-10 py-3"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            </div>

            <button type="submit" disabled={loading} className="w-full moodle-btn-primary py-3 text-lg disabled:opacity-60">
              {loading ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Full name"
                className="w-full moodle-input pl-10 py-3"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                required
              />
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            </div>

            <div className="relative">
              <input
                type="email"
                placeholder="Email address"
                className="w-full moodle-input pl-10 py-3"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                required
              />
              <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            </div>

            <div className="relative">
              <input
                type="password"
                placeholder="Password"
                className="w-full moodle-input pl-10 py-3"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                required
              />
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            </div>

            <div className="relative">
              <input
                type="password"
                placeholder="Confirm password"
                className="w-full moodle-input pl-10 py-3"
                value={regConfirm}
                onChange={(e) => setRegConfirm(e.target.value)}
                required
              />
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setRegRole('student')}
                className={`flex-1 py-2 rounded border text-sm font-medium transition-colors ${regRole === 'student' ? 'bg-moodle-blue text-white border-moodle-blue' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                Student
              </button>
              <button
                type="button"
                onClick={() => setRegRole('faculty')}
                className={`flex-1 py-2 rounded border text-sm font-medium transition-colors ${regRole === 'faculty' ? 'bg-moodle-blue text-white border-moodle-blue' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                Faculty
              </button>
            </div>

            <button type="submit" disabled={loading} className="w-full moodle-btn-primary py-3 text-lg disabled:opacity-60">
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}
      </div>

      <div className="absolute bottom-8 right-8">
        <button className="w-10 h-10 bg-white/80 rounded-full flex items-center justify-center text-slate-600 shadow-lg hover:bg-white">
          <span className="text-xl font-bold">?</span>
        </button>
      </div>
    </div>
  );
};

export default LoginPage;
