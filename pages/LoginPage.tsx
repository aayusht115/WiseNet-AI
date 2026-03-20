import React, { useState } from 'react';
import { UserCircle, Lock, GraduationCap, User } from 'lucide-react';

interface LoginPageProps {
  onLogin: (user: any) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login state — pre-filled for demo
  const [email, setEmail] = useState('pgp25.aayush@spjimr.org');
  const [password, setPassword] = useState('password123');

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
      if (!response.ok) throw new Error('Invalid credentials. Please check your email and password.');
      const user = await response.json();
      onLogin(user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const passwordMismatch = regConfirm.length > 0 && regPassword !== regConfirm;
  const canRegister =
    regName.trim().length > 0 &&
    regEmail.trim().length > 0 &&
    regPassword.length >= 6 &&
    regPassword === regConfirm;

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
      if (!response.ok) {
        if (response.status === 409) throw new Error('An account with this email already exists. Try logging in.');
        throw new Error(data.error || 'Registration failed. Please try again.');
      }
      onLogin(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center relative"
      style={{ backgroundImage: 'url("/SPJIMR_Mumbai_Campus.jpg")' }}
    >
      <div className="absolute inset-0 bg-black/30" />

      <div className="relative z-10 w-full max-w-sm bg-white rounded-2xl shadow-2xl p-8 m-4">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 bg-moodle-blue rounded-lg flex items-center justify-center text-white shrink-0">
            <GraduationCap size={28} />
          </div>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">
            W<span className="text-moodle-blue">I</span>SENET
          </h1>
        </div>

        {/* Title */}
        <h2 className="text-lg font-semibold text-slate-700 mb-1">
          {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          {mode === 'login' ? 'Enter your credentials to continue.' : 'Fill in the details below to get started.'}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* ── LOGIN FORM ── */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="email"
                placeholder="Email address"
                className="w-full moodle-input pl-9 py-2.5 text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="password"
                placeholder="Password"
                className="w-full moodle-input pl-9 py-2.5 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full moodle-btn-primary py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

            {/* Links below sign in */}
            <div className="flex items-center justify-between pt-1 text-xs text-slate-500">
              <button
                type="button"
                onClick={() => switchMode('register')}
                className="hover:text-moodle-blue font-medium transition-colors"
              >
                New here? Register
              </button>
              <button
                type="button"
                className="hover:text-moodle-blue font-medium transition-colors"
                onClick={() => setError('Please contact your administrator to reset your password.')}
              >
                Forgot password?
              </button>
            </div>
          </form>
        )}

        {/* ── REGISTER FORM ── */}
        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Full name"
                className="w-full moodle-input pl-9 py-2.5 text-sm"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                required
              />
            </div>

            <div className="relative">
              <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="email"
                placeholder="Email address"
                className="w-full moodle-input pl-9 py-2.5 text-sm"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                required
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="password"
                placeholder="Password"
                className="w-full moodle-input pl-9 py-2.5 text-sm"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                required
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="password"
                placeholder="Confirm password"
                className={`w-full moodle-input pl-9 py-2.5 text-sm ${passwordMismatch ? 'border-red-400 focus:ring-red-300' : ''}`}
                value={regConfirm}
                onChange={(e) => setRegConfirm(e.target.value)}
                required
              />
              {passwordMismatch && (
                <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRegRole('student')}
                className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors ${regRole === 'student' ? 'bg-moodle-blue text-white border-moodle-blue' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                Student
              </button>
              <button
                type="button"
                onClick={() => setRegRole('faculty')}
                className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors ${regRole === 'faculty' ? 'bg-moodle-blue text-white border-moodle-blue' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                Faculty
              </button>
            </div>

            <button
              type="submit"
              disabled={loading || !canRegister}
              className="w-full moodle-btn-primary py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-xs text-slate-500 hover:text-moodle-blue font-medium transition-colors"
              >
                Already have an account? Sign in
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
