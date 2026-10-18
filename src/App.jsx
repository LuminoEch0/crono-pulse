import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  Eye, EyeOff, Activity, Clock, Plus, Target, 
  RotateCcw, Trash2, LogOut, CheckCircle2, Zap
} from 'lucide-react';

// ==========================================
// 1. SUPABASE INITIALIZATION
// ==========================================
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Check for missing env variables for better DX
const isConfigured = supabaseUrl && supabaseKey;
const supabase = isConfigured ? createClient(supabaseUrl, supabaseKey) : null;

// ==========================================
// 2. UTILITY FUNCTIONS
// ==========================================
const formatTime = (totalMins) => {
  const h = Math.floor(Math.abs(totalMins) / 60);
  const m = Math.abs(totalMins) % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
};

// ==========================================
// 3. COMPONENTS
// ==========================================

// --- Visual Gamification Ring ---
const PulseRing = ({ percent, label, colorHex }) => {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(percent, 100) / 100) * circ;
  
  return (
    <div className="flex flex-col items-center">
      <div className="relative flex justify-center items-center w-20 h-20">
        <svg className="w-full h-full transform -rotate-90">
          <circle cx="50%" cy="50%" r={r} fill="transparent" stroke="#1e293b" strokeWidth="6" />
          <circle 
            cx="50%" cy="50%" r={r} fill="transparent" stroke={colorHex} strokeWidth="6" 
            strokeDasharray={circ} strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute flex flex-col items-center">
           <span className="text-sm font-bold text-slate-100">{Math.round(percent)}%</span>
        </div>
      </div>
      <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider font-semibold">{label}</span>
    </div>
  );
};

// --- Task Card Component ---
const TaskCard = ({ task, onLogTime, onReset, onDelete }) => {
  const remaining = task.target_minutes - task.logged_minutes;
  const isOvertime = remaining < 0;
  const percent = Math.min((task.logged_minutes / task.target_minutes) * 100, 100);
  const isComplete = percent >= 100;
  
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg relative overflow-hidden group">
      {/* Top Edge Progress Glow */}
      <div 
        className={`absolute top-0 left-0 h-1 transition-all duration-500 ${isComplete ? 'bg-emerald-500' : 'bg-gradient-to-r from-indigo-500 to-purple-500'}`} 
        style={{ width: `${percent}%`}} 
      />
      
      <div className="flex justify-between items-start mb-4 pt-1">
        <div className="pr-3">
           <h3 className="text-base font-semibold text-slate-100 leading-tight mb-1">{task.title}</h3>
           <p className="text-xs text-slate-400 flex items-center gap-1">
             <Target size={12} /> {formatTime(task.target_minutes)} {task.cadence}
           </p>
        </div>
        <div className="text-right whitespace-nowrap">
           <span className={`text-xl font-bold ${isComplete ? 'text-emerald-400' : 'text-white'}`}>
             {formatTime(Math.abs(remaining))}
           </span>
           <p className="text-[10px] text-slate-400 uppercase tracking-wide">
             {isOvertime ? '+ overtime' : 'remaining'}
           </p>
        </div>
      </div>

      {/* Quick Actions (Time Chunks) */}
      <div className="flex items-center gap-2 mt-2">
         <button onClick={() => onLogTime(task, 15)} className="flex-1 bg-slate-800/50 hover:bg-indigo-600/20 hover:text-indigo-400 text-slate-300 border border-slate-700 py-1.5 rounded-lg text-xs font-semibold transition">
           +15m
         </button>
         <button onClick={() => onLogTime(task, 30)} className="flex-1 bg-slate-800/50 hover:bg-indigo-600/20 hover:text-indigo-400 text-slate-300 border border-slate-700 py-1.5 rounded-lg text-xs font-semibold transition">
           +30m
         </button>
         <button onClick={() => onLogTime(task, 60)} className="flex-1 bg-slate-800/50 hover:bg-indigo-600/20 hover:text-indigo-400 text-slate-300 border border-slate-700 py-1.5 rounded-lg text-xs font-semibold transition">
           +1h
         </button>
         
         {/* Manage Dropdown / Icons */}
         <div className="flex items-center gap-1 ml-2 border-l border-slate-800 pl-2">
            <button onClick={() => onReset(task)} className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-400/10 rounded-md transition" title="Reset Time">
              <RotateCcw size={14} />
            </button>
            <button onClick={() => onDelete(task.id)} className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-md transition" title="Delete Task">
              <Trash2 size={14} />
            </button>
         </div>
      </div>
    </div>
  );
};

// --- Dashboard Component ---
function Dashboard({ session }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // New Task State
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState('daily');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    if (!error && data) setTasks(data);
    setLoading(false);
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!title) return;
    
    const targetMins = (parseInt(hours || 0) * 60) + parseInt(minutes || 0);
    if (targetMins === 0) return alert("Please set a time budget.");

    const newTask = {
      user_id: session.user.id,
      title,
      cadence,
      target_minutes: targetMins,
      logged_minutes: 0,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from('tasks').insert([newTask]).select();
    if (!error && data) {
      setTasks([data[0], ...tasks]);
      setShowAddModal(false);
      setTitle(''); setHours(''); setMinutes('');
    }
  };

  const handleLogTime = async (task, minsToAdd) => {
    const newLogged = task.logged_minutes + minsToAdd;
    // Optimistic UI Update
    setTasks(tasks.map(t => t.id === task.id ? { ...t, logged_minutes: newLogged } : t));
    await supabase.from('tasks').update({ logged_minutes: newLogged }).eq('id', task.id);
  };

  const handleResetTask = async (task) => {
    setTasks(tasks.map(t => t.id === task.id ? { ...t, logged_minutes: 0 } : t));
    await supabase.from('tasks').update({ logged_minutes: 0 }).eq('id', task.id);
  };

  const handleDeleteTask = async (taskId) => {
    if(!window.confirm("Delete this budget?")) return;
    setTasks(tasks.filter(t => t.id !== taskId));
    await supabase.from('tasks').delete().eq('id', taskId);
  };

  const dailyTasks = tasks.filter(t => t.cadence === 'daily');
  const weeklyTasks = tasks.filter(t => t.cadence === 'weekly');

  const calcProgress = (list) => {
    if (list.length === 0) return 0;
    const tTarget = list.reduce((a, b) => a + b.target_minutes, 0);
    const tLogged = list.reduce((a, b) => a + b.logged_minutes, 0);
    return tTarget === 0 ? 0 : (tLogged / tTarget) * 100;
  };

  const dailyProg = calcProgress(dailyTasks);
  const weeklyProg = calcProgress(weeklyTasks);
  const totalProg = calcProgress(tasks);

  // Gamification logic
  let pulseStatus = { text: 'Flatline', color: 'text-slate-500' };
  if (totalProg > 0) pulseStatus = { text: 'Faint', color: 'text-rose-400' };
  if (totalProg > 30) pulseStatus = { text: 'Steady', color: 'text-indigo-400' };
  if (totalProg > 70) pulseStatus = { text: 'Strong', color: 'text-emerald-400' };
  if (totalProg >= 100) pulseStatus = { text: 'Overdrive', color: 'text-amber-400' };

  if (loading) return <div className="flex h-screen items-center justify-center"><Activity className="animate-spin text-rose-500" size={32} /></div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-24 selection:bg-indigo-500/30">
      {/* Header */}
      <header className="flex justify-between items-center py-4 px-6 border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <Zap className="text-rose-500 fill-rose-500/20" size={20} />
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-rose-400 to-indigo-500 tracking-tight">ChronosPulse</h1>
        </div>
        <button onClick={() => supabase.auth.signOut()} className="text-slate-400 hover:text-rose-400 transition">
          <LogOut size={18} />
        </button>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-8">
        
        {/* Pulse Score Gamification View */}
        <section className="bg-slate-900/50 rounded-3xl p-6 border border-slate-800 flex items-center justify-between">
           <div>
             <h2 className="text-sm font-medium text-slate-400 uppercase tracking-widest mb-1">Pulse Intensity</h2>
             <p className={`text-2xl font-bold ${pulseStatus.color} flex items-center gap-2`}>
                {pulseStatus.text} {totalProg >= 100 && <CheckCircle2 size={20}/>}
             </p>
           </div>
           <div className="flex gap-4">
             <PulseRing percent={dailyProg} label="Daily" colorHex="#6366f1" />
             <PulseRing percent={weeklyProg} label="Weekly" colorHex="#10b981" />
           </div>
        </section>

        {/* Task Lists */}
        <section>
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><Clock size={14}/> Daily Budgets</h2>
          {dailyTasks.length === 0 ? (
             <p className="text-sm text-slate-600 italic">No daily budgets set. Tap + to add one.</p>
          ) : (
            <div className="space-y-3">
              {dailyTasks.map(t => <TaskCard key={t.id} task={t} onLogTime={handleLogTime} onReset={handleResetTask} onDelete={handleDeleteTask} />)}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><Activity size={14}/> Weekly Budgets</h2>
          {weeklyTasks.length === 0 ? (
             <p className="text-sm text-slate-600 italic">No weekly budgets set.</p>
          ) : (
            <div className="space-y-3">
              {weeklyTasks.map(t => <TaskCard key={t.id} task={t} onLogTime={handleLogTime} onReset={handleResetTask} onDelete={handleDeleteTask} />)}
            </div>
          )}
        </section>
      </main>

      {/* Floating Action Button */}
      <button 
        onClick={() => setShowAddModal(true)} 
        className="fixed bottom-6 right-6 lg:right-1/3 bg-indigo-600 text-white p-4 rounded-full shadow-xl shadow-indigo-900/20 hover:bg-indigo-500 transition transform hover:scale-105 z-40"
      >
        <Plus size={24} />
      </button>

      {/* Add Task Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-800">
              <h3 className="text-lg font-bold text-slate-100">New Time Budget</h3>
            </div>
            <form onSubmit={handleAddTask} className="p-5 space-y-5">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wide">Activity Name</label>
                <input required type="text" placeholder="e.g. Project Research" value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition" />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wide">Cadence</label>
                <div className="flex gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button type="button" onClick={() => setCadence('daily')} className={`flex-1 py-2 rounded-md text-sm font-medium transition ${cadence === 'daily' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>Daily</button>
                  <button type="button" onClick={() => setCadence('weekly')} className={`flex-1 py-2 rounded-md text-sm font-medium transition ${cadence === 'weekly' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>Weekly</button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wide">Target Quota</label>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <input type="number" min="0" placeholder="Hours" value={hours} onChange={e => setHours(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 text-center" />
                  </div>
                  <div className="flex-1">
                    <input type="number" min="0" max="59" placeholder="Mins" value={minutes} onChange={e => setMinutes(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 text-center" />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-slate-400 hover:bg-slate-800 transition">Cancel</button>
                <button type="submit" className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition">Save Budget</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Authentication Component ---
function Auth() {
  const [loading, setLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    
    if (isLogin) {
       const { error } = await supabase.auth.signInWithPassword({ email, password });
       if (error) setErrorMsg(error.message);
    } else {
       const { error } = await supabase.auth.signUp({ email, password });
       if (error) setErrorMsg(error.message);
       else alert('Success! Check your email or sign in if auto-confirmed.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 selection:bg-rose-500/30">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-8">
        <div className="flex justify-center mb-6">
          <div className="bg-slate-950 p-4 rounded-full shadow-inner border border-slate-800">
            <Zap size={32} className="text-rose-500" />
          </div>
        </div>
        
        <h2 className="text-2xl font-bold text-center text-white mb-2 tracking-tight">Welcome to ChronosPulse</h2>
        <p className="text-slate-400 text-center text-sm mb-8">Master your time budgets and build momentum.</p>

        {errorMsg && <div className="bg-rose-500/10 border border-rose-500/50 text-rose-400 text-sm p-3 rounded-lg mb-6">{errorMsg}</div>}

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Email</label>
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition" placeholder="you@example.com" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Password</label>
            <div className="relative">
              <input required type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition pr-12" placeholder="••••••••" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3.5 text-slate-500 hover:text-slate-300 transition">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold py-3 rounded-xl shadow-lg transition transform active:scale-95 disabled:opacity-70 mt-2">
            {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button type="button" onClick={() => setIsLogin(!isLogin)} className="text-sm text-slate-400 hover:text-white transition">
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 4. MAIN APP ENTRY
// ==========================================
export default function App() {
  const [session, setSession] = useState(null);
  const [appLoading, setAppLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured) return;
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAppLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!isConfigured) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center p-6 text-center">
        <Zap className="text-rose-500 mb-4" size={48} />
        <h1 className="text-2xl font-bold mb-2 text-white">Configuration Missing</h1>
        <p className="text-slate-400 max-w-md leading-relaxed">
          Please set <code className="bg-slate-900 text-indigo-400 px-1.5 py-0.5 rounded border border-slate-800">VITE_SUPABASE_URL</code> and <code className="bg-slate-900 text-indigo-400 px-1.5 py-0.5 rounded border border-slate-800">VITE_SUPABASE_ANON_KEY</code> in your environment to launch ChronosPulse.
        </p>
      </div>
    );
  }

  if (appLoading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Activity className="animate-spin text-indigo-500" size={32} /></div>;

  return session ? <Dashboard session={session} /> : <Auth />;
}