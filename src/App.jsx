import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Plus, CheckCircle, Clock, Trash2, Calendar, BarChart2, LogOut } from 'lucide-react';

export default function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState('daily');
  const [targetHours, setTargetHours] = useState('');
  const [logAmount, setLogAmount] = useState({});
  const [activeTab, setActiveTab] = useState('today');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchTasks();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchTasks();
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (type) => {
    let error;
    if (type === 'signup') {
      ({ error } = await supabase.auth.signUp({ email, password }));
    } else {
      ({ error } = await supabase.auth.signInWithPassword({ email, password }));
    }
    if (error) alert(error.message);
  };

  const fetchTasks = async () => {
    const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (error) console.error(error);
    else setTasks(data || []);
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!title || !targetHours) return;
    const target_minutes = Math.round(parseFloat(targetHours) * 60);
    const { data, error } = await supabase
      .from('tasks')
      .insert([{ title, cadence, target_minutes, user_id: session.user.id }])
      .select();

    if (error) alert(error.message);
    else {
      setTasks([...tasks, ...data]);
      setTitle('');
      setTargetHours('');
    }
  };

  const logTime = async (taskId, currentLogged) => {
    const minutesToDeduct = Math.round(parseFloat(logAmount[taskId] || 0) * 60);
    if (!minutesToDeduct || minutesToDeduct <= 0) return;

    const newLogged = currentLogged + minutesToDeduct;
    const { error } = await supabase.from('tasks').update({ logged_minutes: newLogged }).eq('id', taskId);

    if (error) alert(error.message);
    else {
      setTasks(tasks.map(t => t.id === taskId ? { ...t, logged_minutes: newLogged } : t));
      setLogAmount({ ...logAmount, [taskId]: '' });
    }
  };

  const deleteTask = async (taskId) => {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (error) alert(error.message);
    else setTasks(tasks.filter(t => t.id !== taskId));
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-xl max-w-md w-full shadow-2xl border border-slate-700">
          <h1 className="text-3xl font-bold mb-2 text-center text-blue-400">ChronosPulse</h1>
          <p className="text-slate-400 text-center mb-6">Track time-budgeted daily & weekly goals</p>
          <div className="space-y-4">
            <input
              type="email"
              placeholder="Email"
              className="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password"
              className="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex gap-4 pt-2">
              <button onClick={() => handleAuth('login')} className="w-1/2 bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-semibold transition">Log In</button>
              <button onClick={() => handleAuth('signup')} className="w-1/2 bg-slate-700 hover:bg-slate-600 py-3 rounded-lg font-semibold transition">Sign Up</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <header className="flex justify-between items-center mb-8 bg-slate-800 p-4 rounded-xl border border-slate-700">
        <div>
          <h1 className="text-2xl font-bold text-blue-400">ChronosPulse</h1>
          <p className="text-xs text-slate-400">{session.user.email}</p>
        </div>
        <button onClick={() => supabase.auth.signOut()} className="flex items-center gap-2 text-slate-400 hover:text-red-400 text-sm">
          <LogOut size={18} /> Logout
        </button>
      </header>

      {/* Navigation Tabs */}
      <div className="flex gap-2 mb-6 bg-slate-800 p-1.5 rounded-xl border border-slate-700">
        <button onClick={() => setActiveTab('today')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'today' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>Active Tasks</button>
        <button onClick={() => setActiveTab('analytics')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'analytics' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>Overview & History</button>
      </div>

      {activeTab === 'today' ? (
        <>
          {/* Add New Task Form */}
          <form onSubmit={addTask} className="bg-slate-800 p-4 rounded-xl border border-slate-700 mb-6 space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2"><Plus size={20} className="text-blue-400" /> Set New Time Budget</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="text"
                placeholder="Task title (e.g., Coursework)"
                className="p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <select
                className="p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                value={cadence}
                onChange={(e) => setCadence(e.target.value)}
              >
                <option value="daily">Daily Target</option>
                <option value="weekly">Weekly Target</option>
              </select>
              <input
                type="number"
                step="0.5"
                placeholder="Hours budget (e.g. 2 or 5)"
                className="p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                value={targetHours}
                onChange={(e) => setTargetHours(e.target.value)}
              />
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-semibold transition">Add Goal</button>
          </form>

          {/* Task List */}
          <div className="space-y-4">
            {tasks.map((task) => {
              const remainingMinutes = Math.max(0, task.target_minutes - task.logged_minutes);
              const remainingHours = (remainingMinutes / 60).toFixed(1);
              const progressPct = Math.min(100, Math.round((task.logged_minutes / task.target_minutes) * 100));

              return (
                <div key={task.id} className="bg-slate-800 p-5 rounded-xl border border-slate-700 relative overflow-hidden">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold uppercase ${task.cadence === 'daily' ? 'bg-indigo-950 text-indigo-300 border border-indigo-800' : 'bg-emerald-950 text-emerald-300 border border-emerald-800'}`}>
                        {task.cadence}
                      </span>
                      <h3 className="text-xl font-bold mt-1 text-white">{task.title}</h3>
                    </div>
                    <button onClick={() => deleteTask(task.id)} className="text-slate-500 hover:text-red-400 p-1">
                      <Trash2 size={18} />
                    </button>
                  </div>

                  {/* Progress Stats */}
                  <div className="flex items-center justify-between text-sm mb-2 text-slate-300">
                    <span className="flex items-center gap-1"><Clock size={16} className="text-blue-400" /> Remaining: <strong className="text-white">{remainingHours} hrs</strong></span>
                    <span>Target: {(task.target_minutes / 60).toFixed(1)} hrs ({progressPct}%)</span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden mb-4">
                    <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${progressPct}%` }}></div>
                  </div>

                  {/* Log Time Entry */}
                  <div className="flex gap-2 bg-slate-900 p-2 rounded-lg border border-slate-700/50">
                    <input
                      type="number"
                      step="0.25"
                      placeholder="Hours completed (e.g. 1 or 0.5)"
                      className="bg-transparent text-sm px-2 text-white flex-1 focus:outline-none"
                      value={logAmount[task.id] || ''}
                      onChange={(e) => setLogAmount({ ...logAmount, [task.id]: e.target.value })}
                    />
                    <button
                      onClick={() => logTime(task.id, task.logged_minutes)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition"
                    >
                      <CheckCircle size={14} /> Deduct Time
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        /* Analytics View */
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 text-center py-12">
          <BarChart2 size={48} className="mx-auto text-blue-400 mb-3" />
          <h2 className="text-xl font-bold text-white mb-2">Weekly & Monthly Overview</h2>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            You are currently tracking {tasks.length} active goals. Continue logging your daily/weekly hours to populate your long-term completion heatmaps!
          </p>
        </div>
      )}
    </div>
  );
}