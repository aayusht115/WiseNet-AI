import React, { useState } from 'react';
import { UserCircle, Lock, GraduationCap } from 'lucide-react';

interface LoginPageProps {
  onLogin: (user: any) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('pgp25.aayush@spjimr.org');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-cover bg-center relative" style={{ backgroundImage: 'url("https://picsum.photos/id/122/1920/1080")' }}>
      <div className="absolute inset-0 bg-black/20"></div>
      
      <div className="relative z-10 w-full max-w-md bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col p-8 m-4">
        <div className="flex items-center space-x-3 mb-8">
          <div className="w-12 h-12 bg-moodle-blue rounded flex items-center justify-center text-white">
            <GraduationCap size={32} />
          </div>
          <h1 className="text-4xl font-bold text-slate-800 tracking-tight">W<span className="text-moodle-blue">I</span>SENET</h1>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded text-sm">
            {error}
          </div>
        )}

        <div className="mb-6 p-4 bg-orange-50 border border-orange-100 text-orange-800 rounded text-sm">
          Your session has timed out. Please log in again.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="email"
              placeholder="Username"
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

          <button type="submit" className="w-full moodle-btn-primary py-3 text-lg">
            Log in
          </button>
        </form>

        <a href="#" className="mt-4 text-sm text-moodle-blue hover:underline">Lost password?</a>

        <div className="mt-8 pt-8 border-t border-slate-100">
          <p className="text-sm font-bold text-slate-800 mb-4">Log in using your account on:</p>
          <button className="flex items-center space-x-3 px-4 py-2 border border-slate-200 rounded hover:bg-slate-50 transition-colors">
            <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center">
              <UserCircle size={16} className="text-slate-400" />
            </div>
            <span className="text-sm font-medium text-slate-700">Login via SPJIMR email id</span>
          </button>
        </div>
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
