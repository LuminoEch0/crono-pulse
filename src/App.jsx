import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Hourglass, Plus, Eye, EyeOff, LogOut, Flame, BarChart3, History as HistoryIcon,
  Home, Trash2, X, Undo2, Loader2, Trophy, Mail, Lock, Pencil, Sparkles, Timer,
} from 'lucide-react';

/* ───────────── Supabase ───────────── */
const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY_ = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = URL_ && KEY_ ? createClient(URL_, KEY_) : null;

/* ───────────── Helpers ───────────── */
const pad = (n) => String(n).padStart(2, '0');
const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const weekStart = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return dk(x); };
const periodKey = (cadence, d = new Date()) => (cadence === 'weekly' ? 'W' + weekStart(d) : 'D' + dk(d));
const fmt = (m) => {
  m = Math.max(0, Math.round(m));
  const h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
};
const EMPTY = { entries: [], periods: {}, archive: [], xp: 0 };
const loadStore = (uid) => {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem('chronospulse:' + uid) || '{}') }; }
  catch { return { ...EMPTY }; }
};
const saveStore = (uid, s) => { try { localStorage.setItem('chronospulse:' + uid, JSON.stringify(s)); } catch { /* storage full/blocked */ } };
const XP_PER_LEVEL = 300; // 5 hours of logged focus per level
const QUICK = [5, 15, 30, 60];

/* ───────────── Shared UI ───────────── */
const inputCls = 'w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-base text-slate-100 placeholder:text-slate-500 outline-none focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/20';

function Logo({ size = 28 }) {
  return (
    <span className="inline-flex items-center justify-center rounded-xl bg-amber-300 text-[#0B1F24]" style={{ width: size + 10, height: size + 10 }}>
      <Hourglass size={size - 6} strokeWidth={2.5} />
    </span>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[#12292F] border border-white/10 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-2 rounded-full hover:bg-white/10"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ───────────── Setup / Splash ───────────── */
function Setup() {
  return (
    <div className="min-h-screen bg-[#0B1F24] text-slate-100 grid place-items-center p-6">
      <div className="max-w-sm text-center space-y-3">
        <Logo size={36} />
        <h1 className="text-xl font-semibold">Connect Supabase</h1>
        <p className="text-slate-400 text-sm">Add <code className="text-amber-300">VITE_SUPABASE_URL</code> and <code className="text-amber-300">VITE_SUPABASE_ANON_KEY</code> to your <code>.env</code> file, then restart the dev server.</p>
      </div>
    </div>
  );
}
const Splash = () => (
  <div className="min-h-screen bg-[#0B1F24] grid place-items-center"><Loader2 className="animate-spin text-amber-300" /></div>
);

/* ───────────── Auth ───────────── */
function Auth() {
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password: pw });
        if (error) throw error;
        if (!data.session) setMsg({ ok: true, text: 'Account created. Check your email to confirm, then sign in.' });
      }
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Something went wrong. Try again.' });
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#0B1F24] text-slate-100 flex flex-col justify-center px-6 py-10 pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <div className="w-full max-w-sm mx-auto">
        <Logo size={36} />
        <h1 className="mt-6 text-4xl font-bold tracking-tight">ChronosPulse</h1>
        <p className="mt-2 text-slate-400">Give every goal a time budget. Spend it on purpose.</p>

        <form onSubmit={submit} className="mt-8 space-y-3">
          <div className="relative">
            <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls + ' pl-11'} />
          </div>
          <div className="relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type={show ? 'text' : 'password'} required minLength={6} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} placeholder="Password (6+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls + ' pl-11 pr-12'} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-amber-300">
              {show ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          {msg && <p className={`text-sm rounded-xl px-3 py-2 ${msg.ok ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>{msg.text}</p>}
          <button disabled={busy} className="w-full rounded-2xl bg-amber-300 text-[#0B1F24] font-semibold py-3.5 active:scale-[.98] transition disabled:opacity-60 flex items-center justify-center gap-2">
            {busy && <Loader2 size={18} className="animate-spin" />}{mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }} className="mt-5 w-full text-sm text-slate-400 hover:text-amber-300">
          {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}

/* ───────────── Task form & custom log ───────────── */
function TaskForm({ task, onSave, onClose }) {
  const [title, setTitle] = useState(task?.title || '');
  const [cadence, setCadence] = useState(task?.cadence || 'daily');
  const [h, setH] = useState(task ? Math.floor(task.target_minutes / 60) : 1);
  const [m, setM] = useState(task ? task.target_minutes % 60 : 0);
  const target = (Number(h) || 0) * 60 + (Number(m) || 0);
  const ok = title.trim() && target > 0;
  return (
    <Sheet title={task ? 'Edit budget' : 'New time budget'} onClose={onClose}>
      <div className="space-y-4">
        <input autoFocus className={inputCls} placeholder="What are you spending time on?" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
        <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-white/5">
          {['daily', 'weekly'].map((c) => (
            <button key={c} type="button" onClick={() => setCadence(c)} className={`py-2.5 rounded-xl text-sm font-medium capitalize ${cadence === c ? 'bg-amber-300 text-[#0B1F24]' : 'text-slate-400'}`}>{c}</button>
          ))}
        </div>
        <div>
          <p className="text-sm text-slate-400 mb-2">Budget per {cadence === 'daily' ? 'day' : 'week'}</p>
          <div className="flex gap-3 items-center">
            <input type="number" min="0" max="168" inputMode="numeric" className={inputCls} value={h} onChange={(e) => setH(e.target.value)} /><span className="text-slate-400">h</span>
            <input type="number" min="0" max="59" inputMode="numeric" className={inputCls} value={m} onChange={(e) => setM(e.target.value)} /><span className="text-slate-400">m</span>
          </div>
        </div>
        <button disabled={!ok} onClick={() => onSave({ title: title.trim(), cadence, target_minutes: target })} className="w-full rounded-2xl bg-amber-300 text-[#0B1F24] font-semibold py-3.5 disabled:opacity-40">
          {task ? 'Save changes' : 'Create budget'}
        </button>
      </div>
    </Sheet>
  );
}

function CustomLog({ task, onLog, onClose }) {
  const [v, setV] = useState('');
  return (
    <Sheet title={`Log time · ${task.title}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); const n = parseInt(v, 10); if (n > 0) onLog(n); }} className="flex gap-3">
        <input autoFocus type="number" min="1" inputMode="numeric" placeholder="Minutes" className={inputCls} value={v} onChange={(e) => setV(e.target.value)} />
        <button className="rounded-2xl bg-amber-300 text-[#0B1F24] font-semibold px-6">Log</button>
      </form>
    </Sheet>
  );
}

/* ───────────── Task card: the budget drains as you log ───────────── */
function TaskCard({ task, onLog, onUndo, onCustom, onEdit }) {
  const remaining = task.target_minutes - task.logged_minutes;
  const done = remaining <= 0;
  const left = Math.max(0, Math.min(100, (remaining / task.target_minutes) * 100));
  return (
    <article className={`rounded-3xl p-5 border ${done ? 'bg-emerald-400/10 border-emerald-300/30' : 'bg-[#12292F] border-white/10'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{task.title}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{fmt(task.target_minutes)} per {task.cadence === 'daily' ? 'day' : 'week'}</p>
        </div>
        <button onClick={onEdit} aria-label="Edit" className="p-2 -m-2 text-slate-500 hover:text-amber-300"><Pencil size={16} /></button>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        {done ? (
          <>
            <Sparkles className="text-emerald-300 self-center" size={26} />
            <span className="text-3xl font-bold text-emerald-300">Quota met</span>
            {remaining < 0 && <span className="text-sm text-emerald-200/80">+{fmt(-remaining)} extra</span>}
          </>
        ) : (
          <>
            <span className="text-4xl font-bold tabular-nums tracking-tight text-amber-300">{fmt(remaining)}</span>
            <span className="text-sm text-slate-400">left</span>
          </>
        )}
      </div>

      {/* sand bar: shrinks as time is logged */}
      <div className="mt-3 h-3 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={Math.round(100 - left)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full transition-all duration-500 ${done ? 'bg-emerald-300' : 'bg-amber-300'}`} style={{ width: `${done ? 100 : left}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-slate-400 tabular-nums">{fmt(task.logged_minutes)} logged</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button key={q} onClick={() => onLog(q)} className="px-4 py-2 rounded-full bg-white/10 text-sm font-medium active:scale-95 hover:bg-amber-300 hover:text-[#0B1F24] transition">+{q}m</button>
        ))}
        <button onClick={onCustom} aria-label="Custom amount" className="px-3 py-2 rounded-full bg-white/5 text-slate-300 active:scale-95"><Timer size={16} /></button>
        <button onClick={onUndo} disabled={task.logged_minutes <= 0} aria-label="Undo last entry" className="px-3 py-2 rounded-full bg-white/5 text-slate-300 active:scale-95 disabled:opacity-30"><Undo2 size={16} /></button>
      </div>
    </article>
  );
}

/* ───────────── Main tracker ───────────── */
function Tracker({ user }) {
  const uid = user.id;
  const [tasks, setTasks] = useState([]);
  const [store, setStore] = useState(() => loadStore(uid));
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('today');
  const [form, setForm] = useState(null); // null | 'new' | task
  const [custom, setCustom] = useState(null);
  const [toast, setToast] = useState(null);

  const say = useCallback((text) => { setToast(text); setTimeout(() => setToast(null), 2600); }, []);
  const patchStore = useCallback((fn) => setStore((s) => { const n = fn(s); saveStore(uid, n); return n; }), [uid]);

  // Load tasks, then roll over any expired daily/weekly periods
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from('tasks').select('*').eq('user_id', uid).order('created_at', { ascending: true });
      if (!alive) return;
      if (error) { say(error.message); setLoading(false); return; }
      const s = loadStore(uid);
      const periods = { ...s.periods }, archive = [...s.archive];
      const rows = [];
      for (const t of data) {
        const key = periodKey(t.cadence);
        const prev = periods[t.id];
        if (prev && prev !== key) {
          archive.push({ id: t.id, title: t.title, cadence: t.cadence, period: prev, target: t.target_minutes, logged: t.logged_minutes });
          if (t.logged_minutes > 0) await supabase.from('tasks').update({ logged_minutes: 0 }).eq('id', t.id);
          rows.push({ ...t, logged_minutes: 0 });
        } else rows.push(t);
        periods[t.id] = key;
      }
      const next = { ...s, periods, archive: archive.slice(-300) };
      saveStore(uid, next);
      setStore(next); setTasks(rows); setLoading(false);
    })();
    return () => { alive = false; };
  }, [uid, say]);

  const applyLog = async (task, delta, { undo = false } = {}) => {
    const next = Math.max(0, task.logged_minutes + delta);
    if (next === task.logged_minutes) return;
    const real = next - task.logged_minutes;
    const prev = task.logged_minutes;
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, logged_minutes: next } : t)));
    const { error } = await supabase.from('tasks').update({ logged_minutes: next }).eq('id', task.id);
    if (error) {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, logged_minutes: prev } : t)));
      return say(error.message);
    }
    patchStore((s) => {
      let entries = s.entries;
      if (undo) {
        const i = [...entries].reverse().findIndex((e) => e.taskId === task.id && e.minutes > 0);
        if (i >= 0) entries = entries.filter((_, idx) => idx !== entries.length - 1 - i);
      } else {
        entries = [...entries, { taskId: task.id, title: task.title, minutes: real, ts: Date.now() }].slice(-600);
      }
      return { ...s, entries, xp: Math.max(0, s.xp + real) };
    });
    if (!undo && prev < task.target_minutes && next >= task.target_minutes) say(`🎉 ${task.title}: quota met!`);
  };

  const undo = (task) => {
    const last = [...store.entries].reverse().find((e) => e.taskId === task.id && e.minutes > 0);
    applyLog(task, -(last ? Math.min(last.minutes, task.logged_minutes) : 5), { undo: true });
  };

  const saveTask = async (vals) => {
    if (form === 'new') {
      const { data, error } = await supabase.from('tasks').insert({ ...vals, user_id: uid, logged_minutes: 0 }).select().single();
      if (error) return say(error.message);
      setTasks((t) => [...t, data]);
      patchStore((s) => ({ ...s, periods: { ...s.periods, [data.id]: periodKey(data.cadence) } }));
    } else {
      const { data, error } = await supabase.from('tasks').update(vals).eq('id', form.id).select().single();
      if (error) return say(error.message);
      setTasks((t) => t.map((x) => (x.id === data.id ? data : x)));
      if (vals.cadence !== form.cadence) patchStore((s) => ({ ...s, periods: { ...s.periods, [data.id]: periodKey(data.cadence) } }));
    }
    setForm(null);
  };

  const removeTask = async () => {
    if (!window.confirm(`Delete “${form.title}”? Its history stays in this device's log.`)) return;
    const { error } = await supabase.from('tasks').delete().eq('id', form.id);
    if (error) return say(error.message);
    setTasks((t) => t.filter((x) => x.id !== form.id));
    setForm(null);
  };

  /* ── derived stats ── */
  const stats = useMemo(() => {
    const today = dk(new Date()), wk = weekStart(new Date());
    const byDay = {};
    store.entries.forEach((e) => { const k = dk(new Date(e.ts)); byDay[k] = (byDay[k] || 0) + e.minutes; });
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return { key: dk(d), label: d.toLocaleDateString(undefined, { weekday: 'short' }), min: byDay[dk(d)] || 0 }; });
    const weekMin = Object.entries(byDay).filter(([k]) => weekStart(new Date(k + 'T12:00:00')) === wk).reduce((a, [, v]) => a + v, 0);
    let streak = 0; const c = new Date();
    if (!byDay[dk(c)]) c.setDate(c.getDate() - 1);
    while (byDay[dk(c)] > 0) { streak++; c.setDate(c.getDate() - 1); }
    const crushed = store.archive.filter((a) => a.logged >= a.target).length + tasks.filter((t) => t.logged_minutes >= t.target_minutes).length;
    const perTask = {}; store.entries.forEach((e) => { perTask[e.title] = (perTask[e.title] || 0) + e.minutes; });
    return { todayMin: byDay[today] || 0, weekMin, days, streak, crushed, perTask, level: Math.floor(store.xp / XP_PER_LEVEL) + 1, lvlPct: ((store.xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100 };
  }, [store, tasks]);

  const totals = useMemo(() => ({
    left: tasks.reduce((a, t) => a + Math.max(0, t.target_minutes - t.logged_minutes), 0),
    met: tasks.filter((t) => t.logged_minutes >= t.target_minutes).length,
  }), [tasks]);

  const grouped = useMemo(() => {
    const g = {}; [...store.entries].reverse().forEach((e) => { const k = dk(new Date(e.ts)); (g[k] ||= []).push(e); });
    return Object.entries(g);
  }, [store.entries]);

  const maxDay = Math.max(60, ...stats.days.map((d) => d.min));
  const tabs = [['today', Home, 'Budgets'], ['overview', BarChart3, 'Overview'], ['history', HistoryIcon, 'History']];

  return (
    <div className="min-h-screen bg-[#0B1F24] text-slate-100">
      <div className="max-w-md mx-auto min-h-screen flex flex-col px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-32">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3"><Logo size={26} /><span className="font-bold text-lg tracking-tight">ChronosPulse</span></div>
          <button onClick={() => supabase.auth.signOut()} aria-label="Sign out" className="p-2 rounded-full text-slate-400 hover:bg-white/10"><LogOut size={20} /></button>
        </header>

        {/* level + streak */}
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3">
          <Trophy size={20} className="text-amber-300 shrink-0" />
          <div className="flex-1">
            <div className="flex justify-between text-xs text-slate-400"><span>Level {stats.level}</span><span>{fmt(store.xp % XP_PER_LEVEL)} / {fmt(XP_PER_LEVEL)}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full bg-amber-300 transition-all" style={{ width: `${stats.lvlPct}%` }} /></div>
          </div>
          <div className="flex items-center gap-1 text-sm font-semibold text-orange-300" title="Day streak"><Flame size={18} />{stats.streak}</div>
        </div>

        <main className="mt-5 flex-1">
          {loading ? <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-amber-300" /></div> : tab === 'today' ? (
            tasks.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <Hourglass className="mx-auto text-amber-300" size={40} />
                <h2 className="text-xl font-semibold">No budgets yet</h2>
                <p className="text-slate-400 text-sm">Set a daily or weekly time quota, like 2h of coursework a day.</p>
                <button onClick={() => setForm('new')} className="mt-2 rounded-2xl bg-amber-300 text-[#0B1F24] font-semibold px-6 py-3">Create your first budget</button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-400 px-1">{fmt(totals.left)} left across {tasks.length} budget{tasks.length > 1 ? 's' : ''} · {totals.met} met</p>
                {tasks.map((t) => (
                  <TaskCard key={t.id} task={t} onLog={(n) => applyLog(t, n)} onUndo={() => undo(t)} onCustom={() => setCustom(t)} onEdit={() => setForm(t)} />
                ))}
              </div>
            )
          ) : tab === 'overview' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[['Today', fmt(stats.todayMin)], ['This week', fmt(stats.weekMin)], ['Quotas met', stats.crushed]].map(([k, v]) => (
                  <div key={k} className="rounded-2xl bg-[#12292F] border border-white/10 p-3"><p className="text-xs text-slate-400">{k}</p><p className="mt-1 text-xl font-bold text-amber-300 tabular-nums">{v}</p></div>
                ))}
              </div>
              <section className="rounded-3xl bg-[#12292F] border border-white/10 p-5">
                <h3 className="font-semibold mb-4">Last 7 days</h3>
                <div className="flex items-end justify-between gap-2 h-36">
                  {stats.days.map((d, i) => (
                    <div key={d.key} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                      <span className="text-[10px] text-slate-400 tabular-nums">{d.min ? fmt(d.min) : ''}</span>
                      <div className={`w-full rounded-t-lg ${i === 6 ? 'bg-amber-300' : 'bg-amber-300/40'}`} style={{ height: `${Math.max(4, (d.min / maxDay) * 100)}%` }} />
                      <span className="text-[11px] text-slate-400">{d.label}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-3xl bg-[#12292F] border border-white/10 p-5">
                <h3 className="font-semibold mb-3">Where your time goes</h3>
                {Object.keys(stats.perTask).length === 0 ? <p className="text-sm text-slate-400">Log some time to see your split.</p> : (() => {
                  const rows = Object.entries(stats.perTask).sort((a, b) => b[1] - a[1]); const top = rows[0][1];
                  return rows.map(([name, min]) => (
                    <div key={name} className="mb-3 last:mb-0">
                      <div className="flex justify-between text-sm"><span className="truncate">{name}</span><span className="text-slate-400 tabular-nums">{fmt(min)}</span></div>
                      <div className="mt-1 h-2 rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-300/80" style={{ width: `${(min / top) * 100}%` }} /></div>
                    </div>
                  ));
                })()}
              </section>
            </div>
          ) : (
            <div className="space-y-5">
              {store.archive.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-slate-400 mb-2 px-1">Finished periods</h3>
                  <div className="space-y-2">
                    {[...store.archive].reverse().slice(0, 30).map((a, i) => {
                      const hit = a.logged >= a.target;
                      return (
                        <div key={i} className="flex items-center justify-between rounded-2xl bg-[#12292F] border border-white/10 px-4 py-3">
                          <div className="min-w-0"><p className="truncate text-sm font-medium">{a.title}</p><p className="text-xs text-slate-400">{a.period.slice(1)} · {a.cadence}</p></div>
                          <span className={`text-sm font-semibold tabular-nums ${hit ? 'text-emerald-300' : 'text-slate-300'}`}>{fmt(a.logged)} / {fmt(a.target)}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
              <section>
                <h3 className="text-sm font-semibold text-slate-400 mb-2 px-1">Time log</h3>
                {grouped.length === 0 ? <p className="text-sm text-slate-400 px-1">Nothing logged yet. Your sessions will appear here.</p> : grouped.slice(0, 14).map(([day, es]) => (
                  <div key={day} className="mb-4">
                    <p className="text-xs text-slate-500 mb-1.5 px-1">{new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · {fmt(es.reduce((a, e) => a + e.minutes, 0))}</p>
                    <div className="rounded-2xl bg-[#12292F] border border-white/10 divide-y divide-white/5">
                      {es.map((e, i) => (
                        <div key={i} className="flex justify-between px-4 py-2.5 text-sm"><span className="truncate">{e.title}</span><span className="text-amber-300 tabular-nums">{e.minutes > 0 ? '+' : ''}{e.minutes}m <span className="text-slate-500 text-xs ml-1">{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></span></div>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-slate-500 px-1">Detailed history is stored on this device. Quotas and totals sync via your account.</p>
              </section>
            </div>
          )}
        </main>
      </div>

      {tab === 'today' && tasks.length > 0 && (
        <button onClick={() => setForm('new')} aria-label="New budget" className="fixed right-5 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 h-14 w-14 rounded-full bg-amber-300 text-[#0B1F24] shadow-lg shadow-black/40 grid place-items-center active:scale-95"><Plus size={26} strokeWidth={2.5} /></button>
      )}

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-[#0B1F24]/90 backdrop-blur border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md mx-auto grid grid-cols-3">
          {tabs.map(([id, Icon, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`flex flex-col items-center gap-1 py-3 text-xs ${tab === id ? 'text-amber-300' : 'text-slate-500'}`}><Icon size={22} />{label}</button>
          ))}
        </div>
      </nav>

      {form && (
        <>
          <TaskForm task={form === 'new' ? null : form} onSave={saveTask} onClose={() => setForm(null)} />
          {form !== 'new' && <button onClick={removeTask} className="fixed z-50 left-1/2 -translate-x-1/2 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center gap-2 text-sm text-rose-300 bg-[#0B1F24] rounded-full px-4 py-2 border border-rose-300/30"><Trash2 size={14} />Delete budget</button>}
        </>
      )}
      {custom && <CustomLog task={custom} onClose={() => setCustom(null)} onLog={(n) => { applyLog(custom, n); setCustom(null); }} />}
      {toast && <div className="fixed top-[calc(1rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-50 rounded-full bg-slate-100 text-[#0B1F24] text-sm font-medium px-4 py-2 shadow-xl max-w-[90vw]">{toast}</div>}
    </div>
  );
}

/* ───────────── Root ───────────── */
export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  if (!supabase) return <Setup />;
  if (session === undefined) return <Splash />;
  return session ? <Tracker key={session.user.id} user={session.user} /> : <Auth />;
}
