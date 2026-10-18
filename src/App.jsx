'use client';
/* ==============================================================================================
 * ChronosPulse — Time-Budgeted Task & Quota Tracker (single-file React app)
 * ------------------------------------------------------------------------------------------------
 * Stack: React + Tailwind CSS + lucide-react + Supabase (auth + cloud sync)
 *
 * Drop-in usage (Vite):
 *   1) npm create vite@latest my-app -- --template react && cd my-app
 *   2) npm i lucide-react @supabase/supabase-js  &&  npm i -D tailwindcss @tailwindcss/vite
 *   3) Replace src/App.jsx with this file. Make sure src/index.css contains:
 *        @import "tailwindcss";
 *        @custom-variant dark (&:where(.dark, .dark *));
 *   4) Create .env.local with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 *   5) In Supabase, create the `tasks` table (SQL is shown in-app on the setup screen)
 *
 * Database schema (fixed, do not change):
 *   tasks(id uuid pk, user_id uuid → auth.users, title text, cadence text ('daily'|'weekly'),
 *         target_minutes int, logged_minutes int, created_at timestamptz)
 * Optional companion table for cloud-synced history: time_logs(id, user_id, task_id, minutes,
 * logged_at) — the app probes for it and falls back to on-device history when absent.
 *
 * Without Supabase credentials the app offers a fully functional local Demo Mode.
 * ============================================================================================== */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Activity, AlertTriangle, ArrowLeft, BarChart3, CalendarDays, CalendarRange, Check,
  CheckCircle2, Clock, CloudOff, Copy, Database, Download, Eye, EyeOff, Flame, Gauge,
  History, Hourglass, Info, Loader2, Lock, LogOut, Mail, Moon, MoreVertical, Pause, Pencil,
  Play, Plus, RotateCcw, Settings, ShieldCheck, Smartphone, Sparkles, Sun, Target, Timer,
  Trash2, TrendingUp, Trophy, X,
} from 'lucide-react';

/* =============================== 1. ENVIRONMENT & SUPABASE ================================== */

/** Resolve Supabase credentials from Vite env, Next env, or a window override. */
function resolveSupabaseConfig() {
  let url = null;
  let anonKey = null;
  try {
    // Vite: import.meta.env.VITE_* (safe to touch in other bundlers — guarded)
    const env = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
    if (env) {
      url = env.VITE_SUPABASE_URL || null;
      anonKey = env.VITE_SUPABASE_ANON_KEY || null;
    }
  } catch (err) { /* not a Vite build */ }
  try {
    if ((!url || !anonKey) && typeof process !== 'undefined' && process.env) {
      url = url || process.env.NEXT_PUBLIC_SUPABASE_URL || null;
      anonKey = anonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null;
    }
  } catch (err) { /* no process env */ }
  try {
    const w = typeof window !== 'undefined' ? window : null;
    if (w && w.chronospulseConfig) {
      url = url || w.chronospulseConfig.supabaseUrl || null;
      anonKey = anonKey || w.chronospulseConfig.supabaseAnonKey || null;
    }
  } catch (err) { /* no window */ }
  return { url, anonKey };
}

let _supabaseClient = null; // null = not resolved yet, false = unavailable
function getSupabase() {
  if (_supabaseClient !== null) return _supabaseClient;
  const { url, anonKey } = resolveSupabaseConfig();
  if (!url || !anonKey) { _supabaseClient = false; return false; }
  try {
    _supabaseClient = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (err) {
    console.warn('ChronosPulse: failed to create Supabase client', err);
    _supabaseClient = false;
  }
  return _supabaseClient;
}

const IS_PROD = (() => {
  try {
    const env = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
    if (env && typeof env.PROD !== 'undefined') return !!env.PROD;
  } catch (err) { /* ignore */ }
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV) {
      return process.env.NODE_ENV === 'production';
    }
  } catch (err) { /* ignore */ }
  return false;
})();

/* =============================== 2. CONSTANTS =============================================== */

const APP_NAME = 'ChronosPulse';
const APP_VERSION = '1.0.0';
const LS = {
  theme: 'cp_theme',
  timer: 'cp_timer',
  periodKey: (id) => `cp_pk_${id}`,
  demoUser: 'cp_demo_user',
  demoTasks: 'cp_demo_tasks',
  demoLogs: 'cp_demo_logs',
  deviceLogs: (uid) => `cp_logs_${uid}`,
};

/** Task accent palette (assigned by stable id hash — no blue/indigo). */
const PALETTE = [
  { name: 'emerald', dot: 'bg-emerald-400', text: 'text-emerald-500' },
  { name: 'teal', dot: 'bg-teal-400', text: 'text-teal-500' },
  { name: 'amber', dot: 'bg-amber-400', text: 'text-amber-500' },
  { name: 'rose', dot: 'bg-rose-400', text: 'text-rose-500' },
  { name: 'violet', dot: 'bg-violet-400', text: 'text-violet-400' },
  { name: 'orange', dot: 'bg-orange-400', text: 'text-orange-500' },
  { name: 'lime', dot: 'bg-lime-400', text: 'text-lime-500' },
];

const TASKS_SQL = `create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  cadence text not null check (cadence in ('daily','weekly')),
  target_minutes integer not null default 60,
  logged_minutes integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

create policy "Users manage their own tasks"
  on public.tasks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);`;

const LOGS_SQL = `-- Optional: cloud-synced history & analytics
create table if not exists public.time_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  minutes integer not null,
  logged_at timestamptz not null default now()
);

alter table public.time_logs enable row level security;

create policy "Users manage their own logs"
  on public.time_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Enable in Supabase Dashboard → Database → Publications → supabase_realtime
-- (adds live cross-device sync for time_logs)`;

const ENV_SAMPLE = `# .env.local
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-SUPABASE-ANON-KEY`;

/* =============================== 3. UTILITIES =============================================== */

const uid = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (err) { /* fall through */ }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function isoWeek(d) {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); // move to Thursday of ISO week
  const week1 = new Date(t.getFullYear(), 0, 4);
  return {
    year: t.getFullYear(),
    week: 1 + Math.round(((t.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7),
  };
}

function startOfWeek(d) {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); // Monday 00:00 local
  return t;
}

const dayKey = (d) => ymd(d);
const weekKeyOf = (d) => { const w = isoWeek(d); return `${w.year}-W${pad2(w.week)}`; };
const periodKeyFor = (cadence, date) => (cadence === 'weekly' ? weekKeyOf(date) : `d:${ymd(date)}`);

function isSamePeriod(isoDate, cadence, now) {
  const d = new Date(isoDate);
  if (cadence === 'weekly') {
    const a = startOfWeek(d); const b = startOfWeek(now || new Date());
    return a.getTime() === b.getTime();
  }
  return ymd(d) === ymd(now || new Date());
}

/** 95 → "1h 35m" */
function fmtDur(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  if (!r) return `${h}h`;
  return `${h}h ${r}m`;
}

const fmtClock = (iso) => {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(dateStr) {
  const now = new Date();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const d = new Date(`${dateStr}T12:00:00`);
  if (dateStr === ymd(now)) return 'Today';
  if (dateStr === ymd(yest)) return 'Yesterday';
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function longDate(d) {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const colorOf = (task) => PALETTE[hashString(task.id || task.title || 'x') % PALETTE.length];

function safeParse(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch (err) {
    return fallback;
  }
}

function lsGet(key) {
  try { return localStorage.getItem(key); } catch (err) { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (err) { return false; }
}
function lsDel(key) {
  try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
}

function mapAuthError(err) {
  const msg = (err && (err.message || err.error_description || String(err))) || 'Something went wrong.';
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (m.includes('already registered') || m.includes('already exists')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (m.includes('at least 6 characters') || m.includes('password should be')) {
    return 'Password must be at least 6 characters.';
  }
  if (m.includes('validate email') || m.includes('invalid email')) {
    return 'Please enter a valid email address.';
  }
  if (m.includes('email not confirmed')) {
    return 'Please confirm your email first — check your inbox.';
  }
  if (m.includes('rate limit')) return 'Too many attempts. Wait a moment and try again.';
  return msg;
}

/** Friendly message for any data-layer error. */
function friendlyError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  if (/relation .* does not exist/i.test(msg)) {
    return 'The tasks table was not found in Supabase. Run the SQL from the setup guide.';
  }
  if (/jwt|auth/i.test(msg) && /expir|invalid/i.test(msg)) return 'Your session expired. Please sign in again.';
  if (/failed to fetch|networkerror/i.test(msg)) return 'Network error — check your connection and try again.';
  return msg;
}

/* =============================== 4. GLOBAL STYLES & PWA ===================================== */

const CSS_TEXT = `
.cp-app{font-family:Inter,'Geist',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-tap-highlight-color:transparent}
body{background:#fafafa}
.dark body{background:#09090b}
.cp-scroll{scrollbar-width:thin;scrollbar-color:rgba(120,120,130,.35) transparent}
.cp-scroll::-webkit-scrollbar{width:6px;height:6px}
.cp-scroll::-webkit-scrollbar-thumb{background:rgba(120,120,130,.35);border-radius:999px}
.cp-scroll::-webkit-scrollbar-track{background:transparent}
.cp-tabular{font-variant-numeric:tabular-nums}
.cp-num::-webkit-outer-spin-button,.cp-num::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.cp-num{-moz-appearance:textfield;appearance:textfield}
@keyframes cp-fade-in{from{opacity:0}to{opacity:1}}
@keyframes cp-slide-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes cp-sheet{from{transform:translateY(48px);opacity:0}to{transform:none;opacity:1}}
@keyframes cp-pop{0%{transform:scale(.86);opacity:0}60%{transform:scale(1.03)}100%{transform:scale(1);opacity:1}}
@keyframes cp-ring{0%{transform:scale(.7);opacity:.8}100%{transform:scale(1.8);opacity:0}}
@keyframes cp-blink{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes cp-dash{to{stroke-dashoffset:-24}}
@keyframes cp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.cp-anim-fade{animation:cp-fade-in .25s ease both}
.cp-anim-up{animation:cp-slide-up .35s cubic-bezier(.16,1,.3,1) both}
.cp-anim-sheet{animation:cp-sheet .34s cubic-bezier(.16,1,.3,1) both}
.cp-anim-pop{animation:cp-pop .3s cubic-bezier(.16,1,.3,1) both}
.cp-blink{animation:cp-blink 1.6s ease-in-out infinite}
.cp-float{animation:cp-float 4s ease-in-out infinite}
.cp-pulse-ring{animation:cp-ring 1.8s cubic-bezier(.16,1,.3,1) infinite}
.cp-marching{stroke-dasharray:5 7;animation:cp-dash 1.1s linear infinite}
@media (prefers-reduced-motion:reduce){.cp-anim-fade,.cp-anim-up,.cp-anim-sheet,.cp-anim-pop,.cp-blink,.cp-float,.cp-pulse-ring,.cp-marching{animation:none}}
`;

/** Injects app-scoped global CSS + PWA head tags; registers the service worker in production. */
function useAppBootstrap() {
  const [installEvent, setInstallEvent] = useState(null);

  useEffect(() => {
    // global styles
    if (!document.getElementById('cp-styles')) {
      const el = document.createElement('style');
      el.id = 'cp-styles';
      el.textContent = CSS_TEXT;
      document.head.appendChild(el);
    }
    // head tags for PWA
    const ensureLink = (rel, href, type) => {
      if (document.head.querySelector(`link[rel="${rel}"][href="${href}"]`)) return;
      const l = document.createElement('link');
      l.rel = rel;
      l.href = href;
      if (type) l.type = type;
      document.head.appendChild(l);
    };
    const ensureMeta = (name, content) => {
      if (document.head.querySelector(`meta[name="${name}"]`)) return;
      const m = document.createElement('meta');
      m.name = name;
      m.content = content;
      document.head.appendChild(m);
    };
    ensureLink('manifest', '/manifest.webmanifest');
    ensureLink('icon', '/icon.svg', 'image/svg+xml');
    ensureLink('apple-touch-icon', '/apple-touch-icon.png');
    ensureMeta('theme-color', '#09090b');
    ensureMeta('apple-mobile-web-app-capable', 'yes');
    ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    ensureMeta('apple-mobile-web-app-title', 'ChronosPulse');
    ensureMeta('mobile-web-app-capable', 'yes');

    // service worker (production builds only, so dev never serves stale caches)
    if (IS_PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    // PWA install prompt
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installEvent) return false;
    try {
      installEvent.prompt();
      const choice = await installEvent.userChoice;
      setInstallEvent(null);
      return choice && choice.outcome === 'accepted';
    } catch (err) {
      return false;
    }
  }, [installEvent]);

  return { canInstall: !!installEvent, promptInstall };
}

/* =============================== 5. TOASTS =================================================== */

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const push = useCallback((message, opts = {}) => {
    const id = uid();
    const toast = {
      id,
      message,
      type: opts.type || 'info',
      action: opts.action || null, // { label, run }
    };
    setToasts((prev) => [...prev.slice(-3), toast]);
    const ttl = toast.action ? 6500 : 4000;
    setTimeout(() => dismiss(id), ttl);
    return id;
  }, [dismiss]);
  return { toasts, push, dismiss };
}

const TOAST_ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

function ToastStack({ toasts, dismiss, onAction }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3">
      {toasts.map((t) => {
        const Icon = TOAST_ICONS[t.type] || Info;
        const tone = t.type === 'success' ? 'text-emerald-500'
          : t.type === 'error' ? 'text-rose-500' : 'text-zinc-400';
        return (
          <div
            key={t.id}
            role="status"
            className="cp-anim-up pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-3 pl-4 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
          >
            <Icon size={18} className={`shrink-0 ${tone}`} />
            <p className="flex-1 text-sm text-zinc-700 dark:text-zinc-200">{t.message}</p>
            {t.action && (
              <button
                type="button"
                onClick={() => { onAction(t); dismiss(t.id); }}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* =============================== 6. VISUAL PRIMITIVES ======================================= */

function PulseLogo({ size = 36, className = '' }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 via-teal-500 to-teal-700 shadow-lg shadow-emerald-500/25 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 36" style={{ width: size * 0.72, height: size * 0.72 * 0.5625 }} fill="none">
        <polyline
          points="4,22 18,22 24,8 32,30 38,22 60,22"
          stroke="#fff"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex rounded-full bg-zinc-100 p-1 dark:bg-zinc-800/80">
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-all active:scale-[0.97] ${
              active
                ? 'bg-white text-zinc-900 shadow dark:bg-zinc-700 dark:text-white'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {Icon && <Icon size={15} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ProgressRing({ progress, size = 64, stroke = 6, className = '', children }) {
  const p = Math.max(0, Math.min(progress || 0, 1));
  const r = (size - stroke) / 2 - 1;
  const c = 2 * Math.PI * r;
  const over = (progress || 0) > 1;
  return (
    <div className={`relative inline-flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-zinc-200 dark:stroke-zinc-800" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          className={over ? 'stroke-amber-400' : 'stroke-emerald-500'}
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.16,1,.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** Hourly "pulse" step-chart of minutes logged today. */
function PulseChart({ logs }) {
  const buckets = useMemo(() => {
    const b = new Array(24).fill(0);
    const today = ymd(new Date());
    for (let i = 0; i < logs.length; i += 1) {
      const d = new Date(logs[i].logged_at);
      if (ymd(d) === today) b[d.getHours()] += logs[i].minutes;
    }
    return b;
  }, [logs]);

  const W = 336;
  const H = 64;
  const BW = W / 24;
  const maxRef = Math.max(30, ...buckets);
  const level = (v) => H - 5 - (v / maxRef) * (H - 14);
  let path = `M0 ${H - 3}`;
  buckets.forEach((v, h) => {
    const y = level(v).toFixed(1);
    path += ` L${(h * BW).toFixed(1)} ${y} L${((h + 1) * BW).toFixed(1)} ${y}`;
  });
  path += ` L${W} ${H - 3}`;
  const now = new Date();
  const nowX = (((now.getHours() * 60 + now.getMinutes()) / 1440) * W).toFixed(1);
  const total = buckets.reduce((a, b) => a + b, 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-zinc-400" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="cp-pulse-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path} fill="url(#cp-pulse-fill)" stroke="none" />
      <path
        d={path}
        fill="none"
        stroke="#10b981"
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={total ? '' : 'cp-marching'}
      />
      <line x1={nowX} y1="3" x2={nowX} y2={H - 3} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="3 4" />
      <circle cx={nowX} cy="4" r="3" fill="#34d399" className="cp-blink" />
    </svg>
  );
}

/** Simple rounded bar chart for the last N days. */
function MiniBarChart({ data }) {
  const W = data.length * 26 + 10;
  const H = 112;
  const top = 16;
  const bottom = 20;
  const max = Math.max(60, ...data.map((d) => d.minutes));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Minutes logged per day">
      <line x1="2" y1={top - 8} x2={W - 2} y2={top - 8} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth="1" strokeDasharray="4 4" />
      <text x="2" y={top - 11} fontSize="8" className="fill-zinc-400 dark:fill-zinc-500">{fmtDur(max)}</text>
      {data.map((d, i) => {
        const x = 5 + i * 26;
        const bw = 16;
        const h = Math.max(d.minutes > 0 ? 4 : 2, (d.minutes / max) * (H - top - bottom));
        const y = H - bottom - h;
        return (
          <g key={d.key}>
            <rect
              x={x}
              y={y}
              width={bw}
              height={h}
              rx="4"
              className={d.isToday ? 'fill-emerald-500' : 'fill-zinc-300 dark:fill-zinc-700'}
            >
              <title>{`${d.label}: ${fmtDur(d.minutes)}`}</title>
            </rect>
            <text x={x + bw / 2} y={H - 7} textAnchor="middle" fontSize="9" className="fill-zinc-400 dark:fill-zinc-500">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CodeBlock({ code, onCopy }) {
  return (
    <div className="group relative">
      <pre className="cp-scroll overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-950 p-3.5 pr-12 text-[11px] leading-relaxed text-zinc-300 dark:border-zinc-800">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        aria-label="Copy code"
        onClick={() => onCopy(code)}
        className="absolute right-2 top-2 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-400 transition hover:text-white active:scale-95"
      >
        <Copy size={13} />
      </button>
    </div>
  );
}

/* =============================== 7. DATA ADAPTERS ============================================ */

const getPk = (taskId) => lsGet(LS.periodKey(taskId));
const setPk = (taskId, key) => lsSet(LS.periodKey(taskId), key);

const sortTasks = (list) => list.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
const sortLogs = (list) => list.slice().sort((a, b) => (a.logged_at < b.logged_at ? 1 : -1));

/** localStorage-backed adapter used by Demo Mode. */
function makeDemoAdapter() {
  const readTasks = () => safeParse(lsGet(LS.demoTasks), []);
  const writeTasks = (list) => lsSet(LS.demoTasks, JSON.stringify(list));
  return {
    mode: 'demo',
    getUser: () => safeParse(lsGet(LS.demoUser), null),
    setUser: () => {
      const u = { id: 'demo-user', email: 'demo@chronospulse.app' };
      lsSet(LS.demoUser, JSON.stringify(u));
      return u;
    },
    clearUser: () => lsDel(LS.demoUser),
    fetchTasks: async () => sortTasks(readTasks()),
    insertTask: async (userId, data) => {
      const task = {
        id: uid(),
        user_id: userId,
        title: data.title,
        cadence: data.cadence,
        target_minutes: data.target_minutes,
        logged_minutes: 0,
        created_at: new Date().toISOString(),
      };
      writeTasks([...readTasks(), task]);
      return task;
    },
    updateTask: async (id, patch) => {
      const tasks = readTasks();
      const i = tasks.findIndex((t) => t.id === id);
      if (i === -1) throw new Error('Budget not found');
      tasks[i] = { ...tasks[i], ...patch };
      writeTasks(tasks);
      return tasks[i];
    },
    deleteTask: async (id) => writeTasks(readTasks().filter((t) => t.id !== id)),
    deleteAllTasks: async () => writeTasks([]),
  };
}

/** Supabase adapter for the fixed `tasks` schema (+ optional `time_logs`). */
function makeCloudAdapter(sb) {
  return {
    mode: 'cloud',
    sb,
    fetchTasks: async (userId) => {
      const { data, error } = await sb.from('tasks')
        .select('id, user_id, title, cadence, target_minutes, logged_minutes, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return sortTasks(data || []);
    },
    probeLogs: async () => {
      try {
        const { error } = await sb.from('time_logs').select('id', { head: true, count: 'exact' }).limit(1);
        return !error;
      } catch (err) {
        return false;
      }
    },
    fetchLogs: async (userId) => {
      const { data, error } = await sb.from('time_logs')
        .select('id, task_id, minutes, logged_at')
        .eq('user_id', userId)
        .order('logged_at', { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      return sortLogs(data || []);
    },
    insertTask: async (userId, data) => {
      const { data: row, error } = await sb.from('tasks').insert({
        user_id: userId,
        title: data.title,
        cadence: data.cadence,
        target_minutes: data.target_minutes,
        logged_minutes: 0,
      }).select('id, user_id, title, cadence, target_minutes, logged_minutes, created_at').single();
      if (error) throw new Error(error.message);
      return row;
    },
    updateTask: async (id, patch) => {
      const { data: row, error } = await sb.from('tasks').update(patch).eq('id', id)
        .select('id, user_id, title, cadence, target_minutes, logged_minutes, created_at').single();
      if (error) throw new Error(error.message);
      return row;
    },
    deleteTask: async (id) => {
      const { error } = await sb.from('tasks').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    deleteAllTasks: async (userId) => {
      const { error } = await sb.from('tasks').delete().eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
    insertLog: async (userId, taskId, minutes) => {
      const { data: row, error } = await sb.from('time_logs')
        .insert({ user_id: userId, task_id: taskId, minutes })
        .select('id, task_id, minutes, logged_at').single();
      if (error) throw new Error(error.message);
      return row;
    },
    deleteLog: async (logId) => {
      const { error } = await sb.from('time_logs').delete().eq('id', logId);
      if (error) throw new Error(error.message);
    },
    deleteLogsForTask: async (taskId) => {
      const { error } = await sb.from('time_logs').delete().eq('task_id', taskId);
      if (error) throw new Error(error.message);
    },
    deleteAllLogs: async (userId) => {
      const { error } = await sb.from('time_logs').delete().eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
  };
}

/* =============================== 8. CORE STATE HOOK ========================================== */

/**
 * Owns auth, tasks, logs, period rollovers, realtime sync and every mutation.
 * Works against either the Supabase adapter (cloud) or the demo adapter (local).
 */
function useChronos(push) {
  const [phase, setPhase] = useState('boot'); // boot | setup | auth | app
  const [mode, setMode] = useState(null); // 'cloud' | 'demo'
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(true);
  const [cloudLogs, setCloudLogs] = useState(false);

  const adapterRef = useRef(null);
  const tasksRef = useRef(tasks); tasksRef.current = tasks;
  const logsRef = useRef(logs); logsRef.current = logs;
  const userRef = useRef(user); userRef.current = user;
  const modeRef = useRef(mode); modeRef.current = mode;
  const cloudLogsRef = useRef(cloudLogs); cloudLogsRef.current = cloudLogs;
  const writingRef = useRef(0);
  const probeRef = useRef({ userId: null, ok: false });
  const channelRef = useRef(null);
  const syncTimerRef = useRef(null);
  const pushRef = useRef(push); pushRef.current = push;

  /* ---- helpers -------------------------------------------------------------------------- */

  const localLogKey = () => (modeRef.current === 'demo' ? LS.demoLogs : LS.deviceLogs(userRef.current ? userRef.current.id : 'anon'));
  const readLocalLogs = () => safeParse(lsGet(localLogKey()), []);
  const writeLocalLogs = (list) => lsSet(localLogKey(), JSON.stringify(list));

  const sumPeriodLogs = (task, allLogs, now) => allLogs
    .filter((l) => l.task_id === task.id && isSamePeriod(l.logged_at, task.cadence, now || new Date()))
    .reduce((s, l) => s + (l.minutes || 0), 0);

  /** Reset a task at period boundaries (daily rollover / new ISO week). Self-healing when logs exist. */
  async function applyRollovers(list, allLogs, { silent } = {}) {
    const now = new Date();
    const updates = [];
    const next = list.map((t) => {
      const key = periodKeyFor(t.cadence, now);
      const prevKey = getPk(t.id);
      if (prevKey === key) return t;
      setPk(t.id, key);
      const periodSum = sumPeriodLogs(t, allLogs, now);
      let newVal;
      if (prevKey == null) {
        // First time this device sees the task: adopt current-period log sum if any, else keep value
        newVal = periodSum > 0 ? periodSum : t.logged_minutes;
      } else {
        // Genuine rollover: restart from whatever was already logged in the new period
        newVal = periodSum;
      }
      if (newVal !== t.logged_minutes) {
        const nt = { ...t, logged_minutes: newVal };
        updates.push(nt);
        return nt;
      }
      return t;
    });
    if (updates.length) {
      writingRef.current += 1;
      try {
        await Promise.all(updates.map((t) => adapterRef.current.updateTask(t.id, { logged_minutes: t.logged_minutes })));
      } catch (err) {
        console.warn('ChronosPulse: rollover persist failed', err);
      } finally {
        writingRef.current -= 1;
      }
      if (!silent) pushRef.current('New period started — budget progress refreshed', { type: 'info' });
    }
    return next;
  }

  async function ensureTaskPeriod(task) {
    const now = new Date();
    const key = periodKeyFor(task.cadence, now);
    const prevKey = getPk(task.id);
    if (prevKey === key) return task;
    setPk(task.id, key);
    const periodSum = sumPeriodLogs(task, logsRef.current, now);
    const newVal = prevKey == null ? (periodSum > 0 ? periodSum : task.logged_minutes) : periodSum;
    if (newVal === task.logged_minutes) return task;
    writingRef.current += 1;
    try {
      const updated = await adapterRef.current.updateTask(task.id, { logged_minutes: newVal });
      const t2 = updated ? { ...task, logged_minutes: updated.logged_minutes } : { ...task, logged_minutes: newVal };
      setTasks((prev) => prev.map((x) => (x.id === task.id ? t2 : x)));
      tasksRef.current = tasksRef.current.map((x) => (x.id === task.id ? t2 : x));
      return t2;
    } catch (err) {
      return { ...task, logged_minutes: newVal };
    } finally {
      writingRef.current -= 1;
    }
  }

  /* ---- realtime sync (cloud) ------------------------------------------------------------ */

  function teardownRealtime() {
    const sb = getSupabase();
    if (channelRef.current && sb) {
      try { sb.removeChannel(channelRef.current); } catch (err) { /* ignore */ }
      channelRef.current = null;
    }
  }

  function scheduleSync() {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      if (writingRef.current > 0) { scheduleSync(); return; }
      doRefreshRef.current();
    }, 900);
  }

  function subscribeRealtime(userId) {
    const sb = getSupabase();
    const adapter = adapterRef.current;
    if (!sb || !adapter || adapter.mode !== 'cloud' || !userId) return;
    teardownRealtime();
    let ch = sb.channel(`cp-sync-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` }, scheduleSync);
    if (cloudLogsRef.current) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'time_logs', filter: `user_id=eq.${userId}` }, scheduleSync);
    }
    ch.subscribe();
    channelRef.current = ch;
  }

  /* ---- data loading ---------------------------------------------------------------------- */

  async function loadAll(userId) {
    setBusy(true);
    const adapter = adapterRef.current;
    try {
      const taskList = await adapter.fetchTasks(userId);
      let logList = [];
      if (adapter.mode === 'cloud') {
        if (probeRef.current.userId !== userId) {
          const ok = await adapter.probeLogs();
          probeRef.current = { userId, ok };
          cloudLogsRef.current = ok;
          setCloudLogs(ok);
        }
        logList = probeRef.current.ok ? await adapter.fetchLogs(userId) : readLocalLogs();
      } else {
        logList = readLocalLogs();
      }
      const next = await applyRollovers(taskList, logList, { silent: true });
      setTasks(next);
      setLogs(logList);
      if (adapter.mode === 'cloud') subscribeRealtime(userId);
    } catch (err) {
      pushRef.current(friendlyError(err), { type: 'error' });
      setTasks([]);
      setLogs([]);
    } finally {
      setBusy(false);
    }
  }

  async function doRefresh() {
    if (writingRef.current > 0) {
      setTimeout(() => doRefreshRef.current(), 1500);
      return;
    }
    const u = userRef.current;
    const adapter = adapterRef.current;
    if (!u || !adapter) return;
    try {
      const taskList = await adapter.fetchTasks(u.id);
      const logList = adapter.mode === 'cloud' && probeRef.current.ok ? await adapter.fetchLogs(u.id) : readLocalLogs();
      const next = await applyRollovers(taskList, logList, { silent: true });
      setTasks(next);
      setLogs(logList);
    } catch (err) {
      /* silent refresh */
    }
  }

  const loadAllRef = useRef(); loadAllRef.current = loadAll;
  const doRefreshRef = useRef(); doRefreshRef.current = doRefresh;

  async function rolloverSweep({ silent } = {}) {
    if (!tasksRef.current.length) return;
    const next = await applyRollovers(tasksRef.current, logsRef.current, { silent });
    if (next.some((t, i) => t !== tasksRef.current[i])) setTasks(next);
  }
  const rolloverSweepRef = useRef(); rolloverSweepRef.current = rolloverSweep;

  /* ---- auth ------------------------------------------------------------------------------- */

  function enterDemo() {
    const adapter = makeDemoAdapter();
    adapterRef.current = adapter;
    modeRef.current = 'demo';
    setMode('demo');
    cloudLogsRef.current = false;
    setCloudLogs(false);
    const u = adapter.getUser() || adapter.setUser();
    userRef.current = u;
    setUser(u);
    setPhase('app');
    loadAllRef.current(u.id);
  }

  async function signIn(email, password) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase is not configured yet.');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(mapAuthError(error));
    if (data && data.user) {
      modeRef.current = 'cloud';
      setMode('cloud');
      userRef.current = data.user;
      setUser(data.user);
      setPhase('app');
      await loadAllRef.current(data.user.id);
    }
  }

  async function signUp(email, password) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase is not configured yet.');
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(mapAuthError(error));
    if (data && data.user && data.session) {
      modeRef.current = 'cloud';
      setMode('cloud');
      userRef.current = data.user;
      setUser(data.user);
      setPhase('app');
      await loadAllRef.current(data.user.id);
      return { needsConfirmation: false };
    }
    return { needsConfirmation: true };
  }

  async function signOut() {
    const sb = getSupabase();
    if (modeRef.current === 'demo') {
      if (adapterRef.current) adapterRef.current.clearUser();
      setUser(null); userRef.current = null;
      setTasks([]); setLogs([]);
      setMode(null); modeRef.current = null;
      setPhase('setup');
      return;
    }
    try { if (sb) await sb.auth.signOut(); } catch (err) { /* ignore */ }
    teardownRealtime();
    setUser(null); userRef.current = null;
    setTasks([]); setLogs([]);
    setPhase('auth');
  }

  /* ---- task mutations ---------------------------------------------------------------------- */

  async function addTask(data) {
    const adapter = adapterRef.current;
    const u = userRef.current;
    if (!adapter || !u) return null;
    const task = await adapter.insertTask(u.id, data);
    setPk(task.id, periodKeyFor(data.cadence, new Date()));
    setTasks((prev) => sortTasks([...prev, task]));
    pushRef.current(`Budget created: ${task.title}`, { type: 'success' });
    return task;
  }

  async function updateTaskBudget(id, patch, { notice } = {}) {
    writingRef.current += 1;
    try {
      const updated = await adapterRef.current.updateTask(id, patch);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
      pushRef.current(notice || 'Budget updated', { type: 'success' });
    } catch (err) {
      pushRef.current(friendlyError(err), { type: 'error' });
      throw err;
    } finally {
      writingRef.current -= 1;
    }
  }

  async function deleteTask(id) {
    const task = tasksRef.current.find((t) => t.id === id);
    writingRef.current += 1;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setLogs((prev) => prev.filter((l) => l.task_id !== id));
    try {
      await adapterRef.current.deleteTask(id);
      if (modeRef.current === 'cloud' && cloudLogsRef.current) {
        await adapterRef.current.deleteLogsForTask(id);
      } else {
        writeLocalLogs(readLocalLogs().filter((l) => l.task_id !== id));
      }
      lsDel(LS.periodKey(id));
      pushRef.current(task ? `Deleted ${task.title}` : 'Budget deleted');
    } catch (err) {
      pushRef.current(friendlyError(err), { type: 'error' });
      doRefreshRef.current();
    } finally {
      writingRef.current -= 1;
    }
  }

  async function resetAllProgress() {
    const ids = tasksRef.current.map((t) => t.id);
    if (!ids.length) return;
    writingRef.current += 1;
    try {
      await Promise.all(ids.map((id) => adapterRef.current.updateTask(id, { logged_minutes: 0 })));
      setTasks((prev) => prev.map((t) => ({ ...t, logged_minutes: 0 })));
      pushRef.current('All budgets reset for their current period', { type: 'success' });
    } catch (err) {
      pushRef.current(friendlyError(err), { type: 'error' });
    } finally {
      writingRef.current -= 1;
    }
  }

  async function deleteAllTasks() {
    const u = userRef.current;
    if (!u) return;
    writingRef.current += 1;
    setTasks([]);
    setLogs([]);
    try {
      if (modeRef.current === 'cloud') {
        if (cloudLogsRef.current) await adapterRef.current.deleteAllLogs(u.id);
        await adapterRef.current.deleteAllTasks(u.id);
      } else {
        await adapterRef.current.deleteAllTasks(u.id);
        writeLocalLogs([]);
      }
      tasksRef.current.forEach((t) => lsDel(LS.periodKey(t.id)));
      pushRef.current('All budgets deleted');
    } catch (err) {
      pushRef.current(friendlyError(err), { type: 'error' });
      doRefreshRef.current();
    } finally {
      writingRef.current -= 1;
    }
  }

  /* ---- time logging ------------------------------------------------------------------------ */

  async function logTime(taskId, minutes, opts = {}) {
    const mins = Math.round(minutes);
    if (!mins || mins <= 0) return;
    const adapter = adapterRef.current;
    if (!adapter) return;
    const current = tasksRef.current.find((t) => t.id === taskId);
    if (!current) {
      if (!opts.silent) pushRef.current('That budget no longer exists', { type: 'info' });
      return;
    }
    const task = await ensureTaskPeriod(current);
    const before = task.logged_minutes;
    const after = before + mins;
    const tempId = uid();
    const tempLog = { id: tempId, task_id: taskId, minutes: mins, logged_at: new Date().toISOString() };

    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, logged_minutes: after } : t)));
    setLogs((prev) => [tempLog, ...prev]);
    writingRef.current += 1;
    try {
      const inCloud = modeRef.current === 'cloud' && cloudLogsRef.current;
      const [updatedTask, insertedLog] = await Promise.all([
        adapter.updateTask(taskId, { logged_minutes: after }),
        inCloud ? adapter.insertLog(userRef.current.id, taskId, mins) : Promise.resolve(null),
      ]);
      if (!inCloud) writeLocalLogs([tempLog, ...readLocalLogs()]);
      if (updatedTask) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, logged_minutes: updatedTask.logged_minutes } : t)));
      }
      let committedLog = tempLog;
      if (insertedLog) {
        committedLog = { id: insertedLog.id, task_id: taskId, minutes: mins, logged_at: insertedLog.logged_at };
        setLogs((prev) => prev.map((l) => (l.id === tempId ? committedLog : l)));
      }
      if (!opts.silent) {
        pushRef.current(`${fmtDur(mins)} logged to ${task.title}`, {
          action: { label: 'Undo', run: () => undoLog(taskId, committedLog.id, mins) },
        });
        if (before < task.target_minutes && after >= task.target_minutes) {
          pushRef.current(`Target met for ${task.title} — nice work!`, { type: 'success' });
        }
      }
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, logged_minutes: before } : t)));
      setLogs((prev) => prev.filter((l) => l.id !== tempId));
      pushRef.current(friendlyError(err), { type: 'error' });
    } finally {
      writingRef.current -= 1;
    }
  }

  async function undoLog(taskId, logId, minutes) {
    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!task) return;
    const newVal = Math.max(0, task.logged_minutes - minutes);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, logged_minutes: newVal } : t)));
    setLogs((prev) => prev.filter((l) => l.id !== logId));
    writingRef.current += 1;
    try {
      await adapterRef.current.updateTask(taskId, { logged_minutes: newVal });
      if (modeRef.current === 'cloud' && cloudLogsRef.current) {
        await adapterRef.current.deleteLog(logId);
      } else {
        writeLocalLogs(readLocalLogs().filter((l) => l.id !== logId));
      }
    } catch (err) {
      pushRef.current(friendlyError(err), { type: 'error' });
    } finally {
      writingRef.current -= 1;
    }
  }

  async function deleteLogEntry(log) {
    const task = tasksRef.current.find((t) => t.id === log.task_id);
    const inPeriod = task ? isSamePeriod(log.logged_at, task.cadence, new Date()) : false;
    const newLogged = task && inPeriod ? Math.max(0, task.logged_minutes - log.minutes) : null;
    setLogs((prev) => prev.filter((l) => l.id !== log.id));
    if (newLogged !== null) setTasks((prev) => prev.map((t) => (t.id === log.task_id ? { ...t, logged_minutes: newLogged } : t)));
    writingRef.current += 1;
    try {
      if (newLogged !== null) await adapterRef.current.updateTask(log.task_id, { logged_minutes: newLogged });
      if (modeRef.current === 'cloud' && cloudLogsRef.current) {
        await adapterRef.current.deleteLog(log.id);
      } else {
        writeLocalLogs(readLocalLogs().filter((l) => l.id !== log.id));
      }
      pushRef.current('Entry removed');
    } catch (err) {
      pushRef.current(friendlyError(err), { type: 'error' });
      doRefreshRef.current();
    } finally {
      writingRef.current -= 1;
    }
  }

  /* ---- sample data (demo) -------------------------------------------------------------------- */

  function loadSampleData() {
    if (modeRef.current !== 'demo') return;
    const now = new Date();
    const created = new Date(now.getTime() - 14 * 86400000).toISOString();
    const mk = (title, cadence, target) => ({
      id: uid(), user_id: 'demo-user', title, cadence,
      target_minutes: target, logged_minutes: 0, created_at: created,
    });
    const t1 = mk('Deep work — coursework', 'daily', 120);
    const t2 = mk('Project research', 'weekly', 300);
    const t3 = mk('Reading', 'daily', 45);
    const t4 = mk('Training', 'weekly', 180);
    const sampleTasks = [t1, t2, t3, t4];
    const at = (daysAgo, h, m) => {
      const d = new Date(now);
      d.setDate(now.getDate() - daysAgo);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const raw = [
      [0, 9, 15, t1, 40], [0, 11, 30, t1, 35], [0, 20, 0, t3, 25],
      [1, 8, 45, t1, 55], [1, 19, 20, t3, 30],
      [2, 10, 0, t1, 70], [2, 14, 30, t2, 45], [2, 21, 10, t3, 15],
      [3, 9, 30, t1, 60], [3, 17, 0, t4, 50],
      [4, 11, 15, t2, 80], [4, 20, 45, t3, 20],
      [5, 8, 30, t1, 45], [5, 16, 0, t4, 65],
      [6, 10, 30, t1, 90], [6, 15, 0, t2, 60], [6, 21, 30, t3, 35],
      [7, 9, 0, t1, 50], [7, 18, 45, t4, 40],
      [8, 13, 30, t2, 95], [8, 20, 15, t3, 25],
      [9, 10, 45, t1, 65], [9, 17, 30, t2, 40],
    ];
    const sampleLogs = raw.map(([da, h, m, t, min]) => ({ id: uid(), task_id: t.id, minutes: min, logged_at: at(da, h, m) }));
    sampleTasks.forEach((t) => {
      t.logged_minutes = sumPeriodLogs(t, sampleLogs, now);
      setPk(t.id, periodKeyFor(t.cadence, now));
    });
    lsSet(LS.demoTasks, JSON.stringify(sampleTasks));
    lsSet(LS.demoLogs, JSON.stringify(sampleLogs));
    setTasks(sampleTasks);
    setLogs(sampleLogs);
    pushRef.current('Sample budgets loaded — explore freely', { type: 'success' });
  }

  /* ---- boot & lifecycle ------------------------------------------------------------------------ */

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      // No Supabase config: resume an existing demo session, otherwise show setup
      const demo = makeDemoAdapter();
      if (demo.getUser()) {
        adapterRef.current = demo;
        modeRef.current = 'demo';
        setMode('demo');
        const u = demo.getUser();
        userRef.current = u;
        setUser(u);
        setPhase('app');
        loadAllRef.current(u.id);
      } else {
        setPhase('setup');
        setBusy(false);
      }
      return undefined;
    }
    const adapter = makeCloudAdapter(sb);
    adapterRef.current = adapter;
    modeRef.current = 'cloud';
    setMode('cloud');
    let disposed = false;
    let authSub = null;

    (async () => {
      try {
        const { data } = await sb.auth.getSession();
        if (disposed) return;
        const u = data && data.session ? data.session.user : null;
        if (u) {
          userRef.current = u;
          setUser(u);
          setPhase('app');
          await loadAllRef.current(u.id);
        } else {
          setPhase('auth');
          setBusy(false);
        }
      } catch (err) {
        if (!disposed) {
          setPhase('auth');
          setBusy(false);
        }
      }
      const { data: subData } = sb.auth.onAuthStateChange((evt, session) => {
        if (disposed) return;
        if (evt === 'SIGNED_OUT') {
          teardownRealtime();
          setUser(null); userRef.current = null;
          setTasks([]); setLogs([]);
          setPhase('auth');
        } else if ((evt === 'SIGNED_IN' || evt === 'INITIAL_SESSION') && session && session.user && !userRef.current) {
          userRef.current = session.user;
          setUser(session.user);
          setPhase('app');
          loadAllRef.current(session.user.id);
        }
      });
      authSub = subData;
    })();

    return () => {
      disposed = true;
      if (authSub && authSub.subscription) authSub.subscription.unsubscribe();
      teardownRealtime();
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, []);

  // Refresh on focus + periodic rollover sweep (handles midnight / week boundary while open)
  useEffect(() => {
    if (phase !== 'app') return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && modeRef.current === 'cloud' && userRef.current) {
        doRefreshRef.current();
      }
      rolloverSweepRef.current({ silent: false });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const iv = setInterval(() => rolloverSweepRef.current({ silent: false }), 30000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(iv);
    };
  }, [phase]);

  return {
    phase, mode, user, tasks, logs, busy, cloudLogs,
    signIn, signUp, signOut, enterDemo,
    addTask, updateTaskBudget, deleteTask, resetAllProgress, deleteAllTasks,
    logTime, undoLog, deleteLogEntry, loadSampleData,
  };
}

/* =============================== 9. SESSION TIMER ============================================ */

function useSessionTimer({ onStop }) {
  const [session, setSession] = useState(null); // { taskId, title, startedAt, accumMs, paused }
  const [now, setNow] = useState(() => Date.now());
  const sessionRef = useRef(session);
  const onStopRef = useRef(onStop);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { onStopRef.current = onStop; }, [onStop]);

  useEffect(() => {
    const raw = lsGet(LS.timer);
    if (!raw) return;
    const s = safeParse(raw, null);
    if (!s || !s.taskId) return;
    // Restore an in-flight session from the external localStorage store
    setSession(s); // eslint-disable-line react-hooks/set-state-in-effect
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (session) lsSet(LS.timer, JSON.stringify(session));
    else lsDel(LS.timer);
  }, [session]);

  useEffect(() => {
    if (!session || session.paused) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  const elapsedMs = session
    ? Math.max(0, session.accumMs + (session.paused ? 0 : now - session.startedAt))
    : 0;

  const start = useCallback((task) => {
    setNow(Date.now());
    setSession({ taskId: task.id, title: task.title, startedAt: Date.now(), accumMs: 0, paused: false });
  }, []);
  const pause = useCallback(() => {
    setSession((s) => (s && !s.paused ? { ...s, accumMs: s.accumMs + (Date.now() - s.startedAt), paused: true } : s));
  }, []);
  const resume = useCallback(() => {
    setNow(Date.now());
    setSession((s) => (s && s.paused ? { ...s, startedAt: Date.now(), paused: false } : s));
  }, []);
  const discard = useCallback(() => setSession(null), []);
  const stop = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const ms = s.accumMs + (s.paused ? 0 : Date.now() - s.startedAt);
    const minutes = Math.max(1, Math.round(ms / 60000));
    setSession(null);
    onStopRef.current(s.taskId, minutes);
  }, []);

  return {
    session, elapsedMs, start, pause, resume, discard, stop,
    isActiveFor: (id) => !!(session && session.taskId === id),
    isPausedFor: (id) => !!(session && session.taskId === id && session.paused),
  };
}

/* =============================== 10. SPLASH ================================================== */

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-zinc-50 dark:bg-zinc-950">
      <div className="relative flex items-center justify-center">
        <span className="cp-pulse-ring absolute h-20 w-20 rounded-2xl border-2 border-emerald-400/60" />
        <span className="cp-pulse-ring absolute h-20 w-20 rounded-2xl border-2 border-teal-400/40" style={{ animationDelay: '0.6s' }} />
        <PulseLogo size={64} />
      </div>
      <div className="text-center">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Warming up your time budgets</p>
      </div>
    </div>
  );
}

/* =============================== 11. AUTH SCREEN ============================================= */

function AuthField({ label, icon: Icon, type = 'text', value, onChange, autoComplete, placeholder, rightButton, inputId }) {
  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      <div className="relative">
        <Icon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className="w-full rounded-xl border border-zinc-200 bg-white py-3 pl-10 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
        />
        {rightButton}
      </div>
    </div>
  );
}

const AUTH_FEATURES = [
  { icon: Target, title: 'Time budgets, not checklists', text: 'Set daily or weekly minute quotas for what matters.' },
  { icon: Timer, title: 'Log it as you live it', text: 'Quick chunks or a live session timer — every minute counts.' },
  { icon: BarChart3, title: 'See your rhythm', text: 'History, streaks and analytics reveal how you spend time.' },
];

function AuthScreen({ onSignIn, onSignUp }) {
  const [tab, setTab] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const passwordToggle = (shown, setShown) => (
    <button
      type="button"
      onClick={() => setShown(!shown)}
      aria-label={shown ? 'Hide password' : 'Show password'}
      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    >
      {shown ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setNotice('');
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (tab === 'signup' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      if (tab === 'signin') {
        await onSignIn(em, password);
      } else {
        const res = await onSignUp(em, password);
        if (res && res.needsConfirmation) {
          setNotice('Account created. Check your inbox to confirm your email, then sign in.');
          setTab('signin');
        }
      }
    } catch (err) {
      setError(err && err.message ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh bg-zinc-50 dark:bg-zinc-950">
      {/* Brand panel (desktop) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-zinc-950 p-12 text-white lg:flex">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-96 bg-[radial-gradient(60%_60%_at_30%_0%,rgba(16,185,129,0.18),transparent)]" />
          <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-teal-500/10 blur-3xl" />
        </div>
        <div className="relative flex items-center gap-3">
          <PulseLogo size={40} />
          <span className="text-lg font-bold tracking-tight">{APP_NAME}</span>
        </div>
        <div className="relative">
          <h1 className="max-w-md text-4xl font-bold leading-tight tracking-tight">
            Budget your time.
            <br />
            <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">Hit your pulse.</span>
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-zinc-400">
            A goal-oriented productivity tracker for recurring time quotas — coursework, research, training, reading — measured in minutes, not checkboxes.
          </p>
          <div className="mt-10 space-y-5">
            {AUTH_FEATURES.map((f) => (
              <div key={f.title} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                  <f.icon size={17} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{f.title}</p>
                  <p className="mt-0.5 text-sm text-zinc-500">{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <svg viewBox="0 0 640 80" className="relative h-16 w-full" fill="none" aria-hidden="true">
          <polyline
            points="0,44 90,44 130,16 180,66 226,44 320,44 360,10 410,70 456,44 640,44"
            stroke="#10b981"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="cp-marching"
            strokeDasharray="8 6"
          />
        </svg>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col items-center justify-center px-5 py-10 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
            <PulseLogo size={52} />
            <div className="text-center">
              <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">{APP_NAME}</h1>
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">Budget your time. Hit your pulse.</p>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40 sm:p-7">
            <Segmented
              ariaLabel="Authentication mode"
              value={tab}
              onChange={(v) => { setTab(v); setError(''); setNotice(''); }}
              options={[
                { value: 'signin', label: 'Sign in', icon: ArrowLeft },
                { value: 'signup', label: 'Create account', icon: Sparkles },
              ]}
            />

            <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
              <AuthField
                label="Email"
                icon={Mail}
                type="email"
                inputId="cp-email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <AuthField
                label="Password"
                icon={Lock}
                type={showPw ? 'text' : 'password'}
                inputId="cp-password"
                autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                rightButton={passwordToggle(showPw, setShowPw)}
              />
              {tab === 'signup' && (
                <AuthField
                  label="Confirm password"
                  icon={ShieldCheck}
                  type={showPw2 ? 'text' : 'password'}
                  inputId="cp-password2"
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  rightButton={passwordToggle(showPw2, setShowPw2)}
                />
              )}

              {error && (
                <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {notice && (
                <div role="status" className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                  <Info size={16} className="mt-0.5 shrink-0" />
                  <span>{notice}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
                {tab === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </div>

          <p className="mt-5 text-center text-xs text-zinc-400 dark:text-zinc-500">
            Secured by Supabase Auth · your budgets sync privately to your account
          </p>
        </div>
      </div>
    </div>
  );
}

/* =============================== 12. SETUP SCREEN ============================================ */

function SetupCard({ step, icon: Icon, title, children }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          {step && <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-500">Step {step}</p>}
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h2>
        </div>
      </div>
      <div className="space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{children}</div>
    </div>
  );
}

function SetupScreen({ onEnterDemo, onCopy }) {
  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="cp-float mb-4">
            <PulseLogo size={64} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">{APP_NAME}</h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Budget your time. Hit your pulse. A time-quota tracker for daily and weekly goals.
          </p>
        </div>

        <div className="space-y-4">
          <SetupCard step={1} icon={Database} title="Create a Supabase project">
            <p>
              Head to{' '}
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-emerald-600 underline decoration-emerald-500/40 underline-offset-2 hover:decoration-emerald-500 dark:text-emerald-400"
              >
                supabase.com/dashboard
              </a>{' '}
              and create a free project. You will find your project URL and anon key under Project Settings, then API.
            </p>
          </SetupCard>

          <SetupCard step={2} icon={Target} title="Create the tasks table">
            <p>Open the SQL Editor in your Supabase project and run:</p>
            <CodeBlock code={TASKS_SQL} onCopy={onCopy} />
          </SetupCard>

          <SetupCard step={3} icon={Hourglass} title="Wire up your environment variables">
            <p>
              Create <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">.env.local</code> in your project root, then restart the dev server:
            </p>
            <CodeBlock code={ENV_SAMPLE} onCopy={onCopy} />
            <p className="text-xs">
              For production deploys, set the same variables in your hosting provider dashboard (Vercel, Netlify, and friends).
            </p>
          </SetupCard>

          <SetupCard icon={Sparkles} title="Optional — cloud history, analytics and realtime sync">
            <p>
              ChronosPulse works with the tasks table alone (history is then kept on your device). For cross-device history and analytics, also run:
            </p>
            <CodeBlock code={LOGS_SQL} onCopy={onCopy} />
          </SetupCard>
        </div>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 active:scale-[0.98]"
          >
            <RotateCcw size={16} />
            I set the variables — reload
          </button>
          <button
            type="button"
            onClick={onEnterDemo}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <CloudOff size={16} />
            Explore in demo mode
          </button>
        </div>

        <p className="mt-4 text-center text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
          Demo mode keeps every budget on this device only — no account, no cloud. Sign out anytime to return here.
        </p>
      </div>
    </div>
  );
}

/* =============================== 13. MODALS & MENUS ========================================== */

function Modal({ open, onClose, title, subtitle, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="cp-anim-fade absolute inset-0 bg-zinc-950/60 backdrop-blur-sm" onClick={onClose} />
      <div className="cp-anim-sheet cp-scroll relative max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:max-w-md sm:rounded-3xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({ state, onClose }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBusy(false); }, [state]);
  if (!state) return null;
  const run = async () => {
    setBusy(true);
    try {
      await state.onConfirm();
    } catch (err) {
      /* toasts are handled by the data layer */
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <Modal open onClose={onClose} title={state.title || 'Are you sure?'}>
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{state.message}</p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="h-11 flex-1 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60 ${
            state.danger ? 'bg-rose-500 hover:bg-rose-400' : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
          }`}
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          {state.label || 'Confirm'}
        </button>
      </div>
    </Modal>
  );
}

function Menu({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Budget options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <MoreVertical size={17} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="cp-anim-pop absolute right-0 top-10 z-40 w-52 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            {items.map((it) => (
              it.header ? (
                <div key={it.label} className="truncate px-3 pb-1 pt-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {it.label}
                </div>
              ) : (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  onClick={() => { setOpen(false); it.onClick(); }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    it.danger
                          ? 'text-rose-500 hover:bg-rose-500/10'
                          : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  <it.icon size={15} />
                  {it.label}
                </button>
              )
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* =============================== 14. TASK CARD =============================================== */

const fmtStopwatch = (ms) => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
};

function TaskCard({ task, onLog, onCustomLog, onEdit, onReset, onDelete, timer }) {
  const color = colorOf(task);
  const target = Math.max(1, task.target_minutes);
  const progress = task.logged_minutes / target;
  const pct = Math.round(progress * 100);
  const complete = task.logged_minutes >= task.target_minutes;
  const over = task.logged_minutes > task.target_minutes;
  const remaining = task.target_minutes - task.logged_minutes;
  const active = timer.isActiveFor(task.id);
  const paused = timer.isPausedFor(task.id);
  const anotherRunning = timer.session && timer.session.taskId !== task.id;

  const weekStart = startOfWeek(new Date());
  const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
  const nextReset = new Date(weekEnd.getTime() + 86400000);
  const daysLeft = Math.max(0, Math.ceil((weekEnd.getTime() - Date.now()) / 86400000));

  const quickBtn = 'inline-flex h-9 items-center rounded-full border border-zinc-200 px-3 text-xs font-semibold text-zinc-600 transition hover:border-emerald-500/60 hover:text-emerald-600 active:scale-95 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-500/60 dark:hover:text-emerald-400';

  return (
    <article
      className={`group relative flex flex-col rounded-3xl border bg-white p-4 transition-shadow duration-300 dark:bg-zinc-900 sm:p-5 ${
        complete
          ? 'border-emerald-500/40 shadow-[0_0_32px_-10px_rgba(16,185,129,0.45)] dark:border-emerald-500/40'
          : 'border-zinc-200 hover:shadow-lg hover:shadow-zinc-200/60 dark:border-zinc-800 dark:hover:shadow-black/50'
      }`}
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color.dot}`} aria-hidden="true" />
          <h3 className="truncate text-[15px] font-semibold text-zinc-900 dark:text-white" title={task.title}>
            {task.title}
          </h3>
          <span className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {task.cadence === 'weekly' ? <CalendarRange size={10} /> : <CalendarDays size={10} />}
            {task.cadence}
          </span>
          {active && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              <span className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${paused ? '' : 'cp-blink'}`} />
              {paused ? 'Paused' : 'Live'}
            </span>
          )}
        </div>
        <Menu
          items={[
            { label: 'Edit budget', icon: Pencil, onClick: onEdit },
            { label: 'Reset progress', icon: RotateCcw, onClick: onReset },
            { label: 'Delete', icon: Trash2, danger: true, onClick: onDelete },
          ]}
        />
      </div>

      <div className="flex items-center gap-4">
        <ProgressRing progress={progress} size={72} stroke={7}>
          {complete ? (
            <Check size={22} className="text-emerald-500" />
          ) : (
            <span className="cp-tabular text-sm font-bold text-zinc-700 dark:text-zinc-200">{pct}%</span>
          )}
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="cp-tabular text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
            {fmtDur(task.logged_minutes)}
            <span className="ml-1.5 text-sm font-medium text-zinc-400 dark:text-zinc-500">/ {fmtDur(task.target_minutes)}</span>
          </p>
          <p className={`mt-0.5 text-xs font-semibold ${over ? 'text-amber-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
            {over ? `${fmtDur(-remaining)} over quota` : `${fmtDur(remaining)} remaining`}
            {task.cadence === 'weekly' && <span className="font-medium text-zinc-400 dark:text-zinc-500"> · resets {MONTHS[nextReset.getMonth()]} {nextReset.getDate()}</span>}
          </p>
          {task.cadence === 'weekly' && (
            <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              {daysLeft === 0 ? 'Final day of the week' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left this week`}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className={quickBtn} onClick={() => onLog(task, 15)}>+15m</button>
        <button type="button" className={quickBtn} onClick={() => onLog(task, 30)}>+30m</button>
        <button type="button" className={quickBtn} onClick={() => onLog(task, 60)}>+1h</button>
        <button
          type="button"
          aria-label="Log a custom amount"
          className="inline-flex h-9 items-center gap-1 rounded-full border border-dashed border-zinc-300 px-3 text-xs font-semibold text-zinc-500 transition hover:border-emerald-500/60 hover:text-emerald-600 active:scale-95 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-emerald-400"
          onClick={onCustomLog}
        >
          <Plus size={13} />
          More
        </button>
        <span className="flex-1" />
        {active ? (
          <button
            type="button"
            onClick={paused ? timer.resume : timer.pause}
            className={`inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-xs font-bold transition active:scale-95 ${
              paused
                ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                : 'bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200'
            }`}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            <span className="cp-tabular">{fmtStopwatch(timer.elapsedMs)}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => timer.start(task)}
            disabled={anotherRunning}
            title={anotherRunning ? 'Another session is already running' : 'Start a live timer session'}
            aria-label="Start a live timer session"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-500/10 px-3.5 text-xs font-bold text-emerald-600 transition hover:bg-emerald-500/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400"
          >
            <Play size={13} />
            Timer
          </button>
        )}
      </div>
    </article>
  );
}

/* =============================== 15. TASK & LOGGING MODALS =================================== */

function AddEditTaskModal({ open, task, onClose, onSave }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Edit budget' : 'New time budget'}
      subtitle={task ? task.title : 'A recurring daily or weekly minute quota'}
    >
      {open ? <TaskForm key={task ? task.id : 'new'} task={task} onClose={onClose} onSave={onSave} /> : null}
    </Modal>
  );
}

function TaskForm({ task, onClose, onSave }) {
  const editing = !!task;
  const [title, setTitle] = useState(task ? task.title : '');
  const [cadence, setCadence] = useState(task ? task.cadence : 'daily');
  const [hours, setHours] = useState(task ? Math.floor(task.target_minutes / 60) : 1);
  const [mins, setMins] = useState(task ? task.target_minutes % 60 : 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = (Number(hours) || 0) * 60 + (Number(mins) || 0);
  const presets = cadence === 'daily' ? [30, 60, 120, 180, 300] : [120, 180, 300, 480, 600];

  const save = async () => {
    const t = title.trim();
    if (!t) { setError('Give this budget a name.'); return; }
    if (total < 1) { setError('Set a target of at least 1 minute.'); return; }
    if (total > 10080) { setError('That target is a little too ambitious (max 168h).'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave({ title: t, cadence, target_minutes: total });
    } catch (err) {
      setError(err && err.message ? err.message : 'Could not save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
        <div>
          <label htmlFor="cp-task-title" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
          <input
            id="cp-task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={60}
            placeholder="e.g. Coursework study"
            className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Cadence</span>
          <Segmented
            ariaLabel="Budget cadence"
            value={cadence}
            onChange={setCadence}
            options={[
              { value: 'daily', label: 'Daily', icon: CalendarDays },
              { value: 'weekly', label: 'Weekly', icon: CalendarRange },
            ]}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Target per {cadence === 'daily' ? 'day' : 'week'}</span>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="number"
                min={0}
                max={168}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-label="Hours"
                className="cp-num w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-3 pr-9 text-sm font-semibold text-zinc-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-400">h</span>
            </div>
            <div className="relative flex-1">
              <input
                type="number"
                min={0}
                max={59}
                value={mins}
                onChange={(e) => setMins(e.target.value)}
                aria-label="Minutes"
                className="cp-num w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-3 pr-9 text-sm font-semibold text-zinc-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-400">m</span>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => { setHours(Math.floor(p / 60)); setMins(p % 60); }}
                className={`h-8 rounded-full border px-3 text-xs font-semibold transition active:scale-95 ${
                  total === p
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-zinc-200 text-zinc-500 hover:border-emerald-500/50 hover:text-emerald-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-emerald-400'
                }`}
              >
                {fmtDur(p)}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-emerald-500/5 px-3.5 py-3 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Target size={14} className="mr-1.5 -mt-0.5 inline" />
          Aiming for <strong>{fmtDur(total)}</strong> every {cadence === 'daily' ? 'day' : 'week'}
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-12 flex-1 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !title.trim() || total < 1}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {editing ? 'Save changes' : 'Create budget'}
          </button>
        </div>
    </div>
  );
}

const LOG_PRESETS = [5, 10, 15, 30, 45, 60, 90, 120];

function LogTimeModal({ open, task, timerSessionTaskId, onClose, onLog, onStartTimer }) {
  return (
    <Modal open={open} onClose={onClose} title="Log time" subtitle={task ? task.title : undefined}>
      {open && task ? (
        <LogForm
          key={task.id}
          task={task}
          canStartTimer={!timerSessionTaskId}
          onClose={onClose}
          onLog={onLog}
          onStartTimer={onStartTimer}
        />
      ) : null}
    </Modal>
  );
}

function LogForm({ task, canStartTimer, onClose, onLog, onStartTimer }) {
  const [minutes, setMinutes] = useState(30);
  const value = Number(minutes) || 0;

  return (
    <div className="space-y-5">
        <div className="rounded-2xl border border-zinc-200 p-3.5 text-center dark:border-zinc-800">
          <p className="cp-tabular text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">{fmtDur(value)}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            of {fmtDur(task.target_minutes)} {task.cadence} target · {fmtDur(Math.max(0, task.target_minutes - task.logged_minutes))} remaining
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {LOG_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setMinutes(p)}
              className={`h-9 rounded-full border px-3.5 text-xs font-semibold transition active:scale-95 ${
                value === p
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-zinc-200 text-zinc-500 hover:border-emerald-500/50 hover:text-emerald-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-emerald-400'
              }`}
            >
              +{fmtDur(p)}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="cp-custom-minutes" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Custom amount (minutes)
          </label>
          <input
            id="cp-custom-minutes"
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="cp-num w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-3 text-sm font-semibold text-zinc-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
          />
        </div>

        <button
          type="button"
          disabled={value < 1}
          onClick={() => { onLog(task, value); onClose(); }}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check size={16} />
          Log {fmtDur(value)}
        </button>

        {canStartTimer ? (
          <button
            type="button"
            onClick={() => { onStartTimer(task); onClose(); }}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Timer size={15} />
            Start a live timer instead
          </button>
        ) : (
          <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
            Finish the running session before starting another one
          </p>
        )}
    </div>
  );
}

/* =============================== 16. DASHBOARD VIEW ========================================== */

function computeStreak(logs) {
  const days = new Set();
  logs.forEach((l) => days.add(ymd(new Date(l.logged_at))));
  let streak = 0;
  const d = new Date();
  if (!days.has(ymd(d))) d.setDate(d.getDate() - 1);
  while (days.has(ymd(d))) {
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function HeroCard({ tasks, logs }) {
  const daily = tasks.filter((t) => t.cadence === 'daily');
  const weekly = tasks.filter((t) => t.cadence === 'weekly');
  const dailyTarget = daily.reduce((s, t) => s + t.target_minutes, 0);
  const weeklyTarget = weekly.reduce((s, t) => s + t.target_minutes, 0);
  const dailyLogged = daily.reduce((s, t) => s + t.logged_minutes, 0);
  const weeklyLogged = weekly.reduce((s, t) => s + t.logged_minutes, 0);
  const streak = computeStreak(logs);
  const metToday = daily.filter((t) => t.logged_minutes >= t.target_minutes).length;

  const isDaily = dailyTarget > 0 || daily.length > 0;
  const label = isDaily ? 'Today' : 'This week';
  const logged = isDaily ? dailyLogged : weeklyLogged;
  const target = isDaily ? dailyTarget : weeklyTarget;
  const pct = target > 0 ? Math.min(100, (logged / target) * 100) : 0;
  const remaining = target - logged;

  return (
    <section className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/10 p-5 dark:border-emerald-500/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">{label}</p>
          <p className="cp-tabular mt-1.5 text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
            {fmtDur(logged)}
            <span className="text-base font-medium text-zinc-400 dark:text-zinc-500"> / {fmtDur(target)}</span>
          </p>
          <p className="mt-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {remaining >= 0
              ? `${fmtDur(remaining)} remaining`
              : `${fmtDur(-remaining)} over quota`}
            {isDaily && daily.length > 0 && ` · ${metToday}/${daily.length} budgets met`}
          </p>
        </div>
        {streak > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-500">
            <Flame size={13} />
            {streak} day{streak === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${
            remaining < 0
              ? 'bg-gradient-to-r from-amber-400 to-orange-400'
              : 'bg-gradient-to-r from-emerald-500 to-teal-400'
          }`}
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </div>

      <div className="mt-4">
        <PulseChart logs={logs} />
        <div className="mt-1 flex justify-between px-0.5 text-[10px] font-medium text-zinc-400/80 dark:text-zinc-600">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>
    </section>
  );
}

function EmptyDashboard({ isDemo, onAdd, onLoadSample }) {
  return (
    <div className="rounded-3xl border border-dashed border-zinc-300 bg-white/50 p-10 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
        <Clock size={28} />
      </div>
      <h3 className="mt-5 text-lg font-bold tracking-tight text-zinc-900 dark:text-white">No budgets yet</h3>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        Create a recurring time quota — like 2 hours of coursework per day — and every logged minute counts toward it.
      </p>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onAdd}
          className="flex h-11 items-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 active:scale-[0.98]"
        >
          <Plus size={16} />
          Create first budget
        </button>
        {isDemo && (
          <button
            type="button"
            onClick={onLoadSample}
            className="flex h-11 items-center gap-2 rounded-xl border border-zinc-300 px-5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Sparkles size={15} />
            Load sample data
          </button>
        )}
      </div>
    </div>
  );
}

function DashboardView({ tasks, logs, busy, isDemo, timer, onAdd, onEdit, onLog, onCustomLog, onReset, onDelete, onLoadSample }) {
  const daily = tasks.filter((t) => t.cadence === 'daily');
  const weekly = tasks.filter((t) => t.cadence === 'weekly');
  const ws = startOfWeek(new Date());
  const we = new Date(ws.getTime() + 6 * 86400000);

  if (busy) {
    return (
      <div className="space-y-4">
        <div className="h-48 animate-pulse rounded-3xl bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-44 animate-pulse rounded-3xl bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-44 animate-pulse rounded-3xl bg-zinc-100 dark:bg-zinc-900" />
      </div>
    );
  }

  if (!tasks.length) {
    return <EmptyDashboard isDemo={isDemo} onAdd={onAdd} onLoadSample={onLoadSample} />;
  }

  const cardProps = (t) => ({
    task: t,
    timer,
    onLog,
    onCustomLog: () => onCustomLog(t),
    onEdit: () => onEdit(t),
    onReset: () => onReset(t),
    onDelete: () => onDelete(t),
  });

  return (
    <div className="space-y-6">
      <HeroCard tasks={tasks} logs={logs} />

      {daily.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              <CalendarDays size={15} className="text-emerald-500" />
              Daily budgets
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-400 dark:bg-zinc-800">{daily.length}</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {daily.map((t) => <TaskCard key={t.id} {...cardProps(t)} />)}
          </div>
        </section>
      )}

      {weekly.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              <CalendarRange size={15} className="text-teal-500" />
              Weekly budgets
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-400 dark:bg-zinc-800">{weekly.length}</span>
            </h2>
            <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
              {MONTHS[ws.getMonth()]} {ws.getDate()} – {MONTHS[we.getMonth()]} {we.getDate()}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {weekly.map((t) => <TaskCard key={t.id} {...cardProps(t)} />)}
          </div>
        </section>
      )}
    </div>
  );
}

/* =============================== 17. HISTORY VIEW ============================================ */

function HistoryView({ tasks, logs, onDeleteEntry }) {
  const [filter, setFilter] = useState('all');
  const titleOf = useCallback((id) => {
    const t = tasks.find((x) => x.id === id);
    return t ? t.title : 'Removed budget';
  }, [tasks]);

  const groups = useMemo(() => {
    const filtered = filter === 'all' ? logs : logs.filter((l) => l.task_id === filter);
    const map = new Map();
    filtered.forEach((l) => {
      const k = ymd(new Date(l.logged_at));
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(l);
    });
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, items]) => ({
        date,
        items: items.slice().sort((a, b) => (a.logged_at < b.logged_at ? 1 : -1)),
        total: items.reduce((s, i) => s + i.minutes, 0),
      }));
  }, [logs, filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">History</h1>
        <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
          {logs.length} entr{logs.length === 1 ? 'y' : 'ies'}
        </span>
      </div>

      {tasks.length > 0 && (
        <div className="cp-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`h-9 shrink-0 rounded-full border px-3.5 text-xs font-semibold transition active:scale-95 ${
              filter === 'all'
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-zinc-200 text-zinc-500 hover:border-emerald-500/40 dark:border-zinc-700 dark:text-zinc-400'
            }`}
          >
            All activity
          </button>
          {tasks.map((t) => {
            const c = colorOf(t);
            const active = filter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`flex h-9 max-w-44 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition active:scale-95 ${
                  active
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-zinc-200 text-zinc-500 hover:border-emerald-500/40 dark:border-zinc-700 dark:text-zinc-400'
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${c.dot}`} />
                <span className="truncate">{t.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-zinc-300 bg-white/50 p-10 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
            <History size={24} />
          </div>
          <h3 className="mt-4 text-base font-bold text-zinc-900 dark:text-white">Nothing logged yet</h3>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
            Every minute you log lands here as a permanent entry.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.date} className="overflow-hidden rounded-3xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200">{dayLabel(g.date)}</span>
                <span className="cp-tabular text-xs font-semibold text-zinc-500 dark:text-zinc-400">{fmtDur(g.total)}</span>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {g.items.map((l) => {
                  const t = tasks.find((x) => x.id === l.task_id);
                  const c = t ? colorOf(t) : PALETTE[0];
                  return (
                    <li key={l.id} className="group flex items-center gap-3 px-4 py-3">
                      <span className="cp-tabular w-10 shrink-0 text-xs font-medium text-zinc-400">{fmtClock(l.logged_at)}</span>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${c.dot}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-700 dark:text-zinc-200" title={titleOf(l.task_id)}>
                        {titleOf(l.task_id)}
                      </span>
                      <span className="cp-tabular shrink-0 text-sm font-bold text-emerald-600 dark:text-emerald-400">+{fmtDur(l.minutes)}</span>
                      <button
                        type="button"
                        aria-label="Delete entry"
                        onClick={() => onDeleteEntry(l)}
                        className="shrink-0 rounded-full p-1.5 text-zinc-300 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-500 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* =============================== 18. ANALYTICS VIEW ========================================== */

function StatCard({ icon: Icon, value, label, sub, accent = 'text-emerald-500' }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <Icon size={16} className={accent} />
      <p className="cp-tabular mt-2.5 text-xl font-bold tracking-tight text-zinc-900 dark:text-white">{value}</p>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      {sub && <p className="mt-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{sub}</p>}
    </div>
  );
}

function AnalyticsView({ tasks, logs }) {
  const daily = tasks.filter((t) => t.cadence === 'daily');

  const stats = useMemo(() => {
    const now = new Date();
    const today = ymd(now);
    let todayMin = 0;
    let weekMin = 0;
    let allTime = 0;
    const ws = startOfWeek(now).getTime();
    logs.forEach((l) => {
      const d = new Date(l.logged_at);
      allTime += l.minutes;
      if (ymd(d) === today) todayMin += l.minutes;
      if (d.getTime() >= ws) weekMin += l.minutes;
    });
    return { todayMin, weekMin, allTime, streak: computeStreak(logs) };
  }, [logs]);

  const bars = useMemo(() => {
    const out = [];
    const now = new Date();
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = ymd(d);
      const minutes = logs
        .filter((l) => ymd(new Date(l.logged_at)) === key)
        .reduce((s, l) => s + l.minutes, 0);
      out.push({
        key,
        minutes,
        label: i === 0 ? 'Now' : WEEKDAYS[d.getDay()][0],
        isToday: i === 0,
      });
    }
    return out;
  }, [logs]);

  const performance = useMemo(
    () => tasks
      .map((t) => ({
        task: t,
        pct: t.target_minutes > 0 ? Math.round((t.logged_minutes / t.target_minutes) * 100) : 0,
        over: t.logged_minutes > t.target_minutes,
      }))
      .sort((a, b) => b.pct - a.pct),
    [tasks]
  );

  const insights = useMemo(() => {
    const weekdaySums = new Array(7).fill(0);
    const now = new Date();
    let last7 = 0;
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = ymd(d);
      const sum = logs.filter((l) => ymd(new Date(l.logged_at)) === key).reduce((s, l) => s + l.minutes, 0);
      weekdaySums[d.getDay()] += sum;
      last7 += sum;
    }
    const bestIdx = weekdaySums.indexOf(Math.max(...weekdaySums));
    const bestTotal = weekdaySums[bestIdx] || 0;
    const metToday = daily.filter((t) => t.logged_minutes >= t.target_minutes).length;
    return {
      bestDay: bestTotal > 0 ? WEEKDAYS[bestIdx] : null,
      avgDaily: Math.round(last7 / 7),
      metToday,
      dailyCount: daily.length,
    };
  }, [logs, daily]);

  const hasAnyData = tasks.length > 0 || logs.length > 0;

  if (!hasAnyData) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Analytics</h1>
        <div className="rounded-3xl border border-dashed border-zinc-300 bg-white/50 p-10 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
            <BarChart3 size={24} />
          </div>
          <h3 className="mt-4 text-base font-bold text-zinc-900 dark:text-white">No data to analyze yet</h3>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
            Create a budget and log a few sessions — insights, streaks and trends appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Analytics</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Clock} value={fmtDur(stats.todayMin)} label="Logged today" />
        <StatCard icon={CalendarRange} value={fmtDur(stats.weekMin)} label="This week" />
        <StatCard icon={Flame} value={`${stats.streak} day${stats.streak === 1 ? '' : 's'}`} label="Active streak" accent="text-amber-500" />
        <StatCard icon={TrendingUp} value={fmtDur(stats.allTime)} label="All time" />
      </div>

      <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Last 14 days</h2>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">minutes per day</span>
        </div>
        <MiniBarChart data={bars} />
      </div>

      {tasks.length > 0 && (
        <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Budget performance
          </h2>
          <div className="space-y-4">
            {performance.map(({ task, pct, over }) => {
              const c = colorOf(task);
              return (
                <div key={task.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${c.dot}`} aria-hidden="true" />
                      <span className="truncate font-medium text-zinc-700 dark:text-zinc-200">{task.title}</span>
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-zinc-400">{task.cadence}</span>
                    </span>
                    <span className={`cp-tabular shrink-0 text-xs font-bold ${over ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {pct}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className={`h-full rounded-full transition-[width] duration-700 ${
                        over ? 'bg-gradient-to-r from-amber-400 to-orange-400' : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(pct, 2))}%` }}
                    />
                  </div>
                  <p className="cp-tabular mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                    {fmtDur(task.logged_minutes)} of {fmtDur(task.target_minutes)} this {task.cadence === 'daily' ? 'day' : 'week'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Insights</h2>
        <div className="flex flex-wrap gap-2">
          {insights.bestDay && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <TrendingUp size={13} />
              Most productive day: {insights.bestDay}
            </span>
          )}
          <span className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <Gauge size={13} />
            7-day average: {fmtDur(insights.avgDaily)} per day
          </span>
          {insights.dailyCount > 0 && (
            <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
              insights.metToday === insights.dailyCount
                ? 'bg-amber-500/10 text-amber-500'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
            }`}>
              <Trophy size={13} />
              {insights.metToday} of {insights.dailyCount} daily budgets met today
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* =============================== 19. SETTINGS VIEW =========================================== */

function SettingsRow({ icon: Icon, title, description, action }) {
  return (
    <div className="flex items-center gap-3.5 py-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</p>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function SettingsView({
  user, mode, cloudLogs, theme, onThemeChange, onSignOut,
  canInstall, onInstall, onExport, onResetAll, onDeleteAll,
}) {
  const email = user && user.email ? user.email : 'unknown';
  const initial = email.slice(0, 1).toUpperCase();
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Settings</h1>

      {/* Account */}
      <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-lg font-bold text-white">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-zinc-900 dark:text-white">{email}</p>
            <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              mode === 'cloud'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/10 text-amber-500'
            }`}>
              {mode === 'cloud' ? <Activity size={11} /> : <CloudOff size={11} />}
              {mode === 'cloud' ? (cloudLogs ? 'Cloud sync · realtime history' : 'Cloud sync · on-device history') : 'Demo mode · on-device data'}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </div>

      {/* Appearance */}
      <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Appearance</h2>
        <Segmented
          ariaLabel="Theme"
          value={theme}
          onChange={onThemeChange}
          options={[
            { value: 'dark', label: 'Dark', icon: Moon },
            { value: 'light', label: 'Light', icon: Sun },
          ]}
        />
      </div>

      {/* App */}
      <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">App</h2>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {canInstall && (
            <SettingsRow
              icon={Smartphone}
              title="Install as app"
              description="Add ChronosPulse to your home screen for a full-screen, offline-capable experience."
              action={(
                <button
                  type="button"
                  onClick={onInstall}
                  className="h-9 shrink-0 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-zinc-950 transition hover:bg-emerald-400 active:scale-95"
                >
                  Install
                </button>
              )}
            />
          )}
          <SettingsRow
            icon={Download}
            title="Export data"
            description="Download all budgets and history as a JSON file."
            action={(
              <button
                type="button"
                onClick={onExport}
                className="h-9 shrink-0 rounded-xl border border-zinc-200 px-4 text-xs font-bold text-zinc-600 transition hover:bg-zinc-100 active:scale-95 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Export
              </button>
            )}
          />
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-3xl border border-rose-500/25 bg-rose-500/[0.03] p-5 dark:border-rose-500/20 dark:bg-rose-500/[0.04]">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-rose-500">Danger zone</h2>
        <div className="divide-y divide-rose-500/10">
          <SettingsRow
            icon={RotateCcw}
            title="Reset all progress"
            description="Every budget returns to zero for its current period. History is preserved."
            action={(
              <button
                type="button"
                onClick={onResetAll}
                className="h-9 shrink-0 rounded-xl border border-rose-500/30 px-4 text-xs font-bold text-rose-500 transition hover:bg-rose-500/10 active:scale-95"
              >
                Reset
              </button>
            )}
          />
          <SettingsRow
            icon={Trash2}
            title="Delete all budgets"
            description="Permanently removes every budget and its entire history."
            action={(
              <button
                type="button"
                onClick={onDeleteAll}
                className="h-9 shrink-0 rounded-xl bg-rose-500 px-4 text-xs font-bold text-white transition hover:bg-rose-400 active:scale-95"
              >
                Delete
              </button>
            )}
          />
        </div>
      </div>

      <p className="pb-2 text-center text-xs leading-relaxed text-zinc-400 dark:text-zinc-600">
        {APP_NAME} v{APP_VERSION} · React + Supabase · tasks schema v1
        <br />
        Budget your time. Hit your pulse.
      </p>
    </div>
  );
}

/* =============================== 20. APP SHELL =============================================== */

const NAV_ITEMS = [
  { id: 'budgets', label: 'Budgets', icon: Gauge },
  { id: 'history', label: 'History', icon: History },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function TimerBar({ timer }) {
  const s = timer.session;
  if (!s) return null;
  const paused = !!s.paused;
  return (
    <div
      className="fixed inset-x-4 bottom-24 z-40 md:inset-x-auto md:bottom-6 md:right-6 md:w-96"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="cp-anim-up flex items-center gap-2.5 rounded-2xl border border-emerald-500/40 bg-zinc-900/95 p-3 pl-4 text-white shadow-2xl shadow-black/40 backdrop-blur">
        <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
          {!paused && <span className="cp-pulse-ring absolute h-3 w-3 rounded-full bg-emerald-400/70" />}
          <span className={`relative h-2.5 w-2.5 rounded-full ${paused ? 'bg-zinc-500' : 'bg-emerald-400'}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-zinc-400" title={s.title}>{s.title}</p>
          <p className="cp-tabular text-lg font-bold leading-tight">{fmtStopwatch(timer.elapsedMs)}</p>
        </div>
        <button
          type="button"
          aria-label={paused ? 'Resume session' : 'Pause session'}
          onClick={paused ? timer.resume : timer.pause}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 transition hover:bg-white/20 active:scale-95"
        >
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button
          type="button"
          aria-label="Stop and log this session"
          onClick={timer.stop}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-zinc-950 transition hover:bg-emerald-400 active:scale-95"
        >
          <Check size={16} />
        </button>
        <button
          type="button"
          aria-label="Discard session"
          onClick={timer.discard}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-white/10 hover:text-rose-400 active:scale-95"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

/* =============================== 21. ROOT APP ================================================ */

export default function App() {
  const { toasts, push, dismiss } = useToasts();
  const chronos = useChronos(push);
  const { canInstall, promptInstall } = useAppBootstrap();
  const [theme, setTheme] = useState('dark');
  const [view, setView] = useState('budgets');
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [logTask, setLogTask] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const timer = useSessionTimer({ onStop: (taskId, minutes) => chronos.logTime(taskId, minutes) });

  // Theme bootstrap + persistence
  useEffect(() => {
    try {
      const t = lsGet(LS.theme);
      // Sync theme from the external localStorage store (external system -> state)
      if (t === 'light' || t === 'dark') setTheme(t); // eslint-disable-line react-hooks/set-state-in-effect
    } catch (err) { /* ignore */ }
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    try { lsSet(LS.theme, theme); } catch (err) { /* ignore */ }
  }, [theme]);

  const copyCode = useCallback(async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      push('Copied to clipboard', { type: 'success' });
    } catch (err) {
      push('Copy failed — please select the code manually', { type: 'error' });
    }
  }, [push]);

  const runToastAction = useCallback((t) => {
    if (t.action && typeof t.action.run === 'function') t.action.run();
  }, []);

  const openAdd = () => { setEditingTask(null); setTaskModalOpen(true); };
  const openEdit = (t) => { setEditingTask(t); setTaskModalOpen(true); };
  const closeTaskModal = () => { setTaskModalOpen(false); setEditingTask(null); };

  const saveTask = async (data) => {
    if (editingTask) await chronos.updateTaskBudget(editingTask.id, data);
    else await chronos.addTask(data);
    closeTaskModal();
  };

  const askResetTask = (t) => setConfirmState({
    title: 'Reset progress',
    message: `Zero out the ${fmtDur(t.logged_minutes)} logged for ${t.title} in this ${t.cadence} period? The history view keeps every entry.`,
    label: 'Reset progress',
    onConfirm: () => chronos.updateTaskBudget(t.id, { logged_minutes: 0 }, { notice: 'Progress reset for this period' }),
  });

  const askDeleteTask = (t) => setConfirmState({
    title: 'Delete budget',
    message: `${t.title} and its entire history will be permanently removed. This cannot be undone.`,
    label: 'Delete budget',
    danger: true,
    onConfirm: () => chronos.deleteTask(t.id),
  });

  const askResetAll = () => setConfirmState({
    title: 'Reset all progress',
    message: 'Every budget returns to zero for its current period. History entries are preserved.',
    label: 'Reset all',
    onConfirm: chronos.resetAllProgress,
  });

  const askDeleteAll = () => setConfirmState({
    title: 'Delete all budgets',
    message: 'Every budget and its entire history will be permanently removed. This cannot be undone.',
    label: 'Delete everything',
    danger: true,
    onConfirm: chronos.deleteAllTasks,
  });

  const exportData = () => {
    try {
      const payload = {
        app: APP_NAME,
        version: APP_VERSION,
        exported_at: new Date().toISOString(),
        user: chronos.user ? chronos.user.email : null,
        tasks: chronos.tasks,
        logs: chronos.logs,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chronospulse-export-${ymd(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      push('Export downloaded', { type: 'success' });
    } catch (err) {
      push('Export failed', { type: 'error' });
    }
  };

  const toastStack = <ToastStack toasts={toasts} dismiss={dismiss} onAction={runToastAction} />;

  if (chronos.phase === 'boot') {
    return <div className="cp-app"><Splash />{toastStack}</div>;
  }
  if (chronos.phase === 'setup') {
    return <div className="cp-app"><SetupScreen onEnterDemo={chronos.enterDemo} onCopy={copyCode} />{toastStack}</div>;
  }
  if (chronos.phase === 'auth') {
    return <div className="cp-app"><AuthScreen onSignIn={chronos.signIn} onSignUp={chronos.signUp} />{toastStack}</div>;
  }

  const email = chronos.user && chronos.user.email ? chronos.user.email : '';
  const initial = email ? email.slice(0, 1).toUpperCase() : '?';
  const themeToggle = (
    <button
      type="button"
      onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="rounded-full p-2.5 text-zinc-500 transition hover:bg-zinc-100 active:scale-95 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );

  return (
    <div className="cp-app min-h-dvh bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-72 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(16,185,129,0.09),transparent)]"
      />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-zinc-200 bg-white/70 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-900/60 md:flex">
        <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
          <PulseLogo size={32} />
          <span className="text-[15px] font-bold tracking-tight">{APP_NAME}</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
                  active
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                }`}
              >
                <item.icon size={18} strokeWidth={active ? 2.4 : 2} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
          {themeToggle}
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-sm font-bold text-white">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold" title={email}>{email}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                {chronos.mode === 'cloud' ? 'Cloud sync' : 'Demo mode'}
              </p>
            </div>
            <button
              type="button"
              onClick={chronos.signOut}
              aria-label="Sign out"
              className="rounded-full p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-rose-500 active:scale-95 dark:hover:bg-zinc-800"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-200/70 bg-zinc-50/90 px-4 backdrop-blur-lg dark:border-zinc-800/70 dark:bg-zinc-950/90 md:hidden">
        <div className="flex items-center gap-2.5">
          <PulseLogo size={28} />
          <span className="text-[15px] font-bold tracking-tight">{APP_NAME}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {themeToggle}
          <Menu
            items={[
              { header: true, label: email || 'Signed in' },
              { label: 'Settings', icon: Settings, onClick: () => setView('settings') },
              { label: 'Sign out', icon: LogOut, danger: true, onClick: chronos.signOut },
            ]}
          />
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10 md:pl-60">
        <main
          className={`mx-auto w-full max-w-4xl px-4 pt-5 md:px-8 md:pt-8 ${
            timer.session ? 'pb-48 md:pb-24' : 'pb-36 md:pb-16'
          }`}
        >
          <div key={view} className="cp-anim-up">
            {view === 'budgets' && (
              <>
                <div className="mb-5 flex items-end justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight">{greeting()}</h1>
                    <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{longDate(new Date())}</p>
                  </div>
                  <button
                    type="button"
                    onClick={openAdd}
                    className="hidden h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 active:scale-[0.98] md:flex"
                  >
                    <Plus size={16} />
                    New budget
                  </button>
                </div>
                <DashboardView
                  tasks={chronos.tasks}
                  logs={chronos.logs}
                  busy={chronos.busy}
                  isDemo={chronos.mode === 'demo'}
                  timer={timer}
                  onAdd={openAdd}
                  onEdit={openEdit}
                  onLog={(t, m) => chronos.logTime(t.id, m)}
                  onCustomLog={(t) => setLogTask(t)}
                  onReset={askResetTask}
                  onDelete={askDeleteTask}
                  onLoadSample={chronos.loadSampleData}
                />
              </>
            )}
            {view === 'history' && (
              <HistoryView tasks={chronos.tasks} logs={chronos.logs} onDeleteEntry={chronos.deleteLogEntry} />
            )}
            {view === 'analytics' && <AnalyticsView tasks={chronos.tasks} logs={chronos.logs} />}
            {view === 'settings' && (
              <SettingsView
                user={chronos.user}
                mode={chronos.mode}
                cloudLogs={chronos.cloudLogs}
                theme={theme}
                onThemeChange={setTheme}
                onSignOut={chronos.signOut}
                canInstall={canInstall}
                onInstall={promptInstall}
                onExport={exportData}
                onResetAll={askResetAll}
                onDeleteAll={askDeleteAll}
              />
            )}
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-around rounded-full border border-zinc-200 bg-white/95 p-1.5 shadow-xl shadow-zinc-300/40 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 dark:shadow-black/50 md:hidden"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        {NAV_ITEMS.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-2 text-[10px] font-bold transition active:scale-95 ${
                active
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'text-zinc-400 dark:text-zinc-500'
              }`}
            >
              <item.icon size={19} strokeWidth={active ? 2.4 : 2} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Floating action button (mobile) */}
      {view === 'budgets' && (
        <button
          type="button"
          onClick={openAdd}
          aria-label="New budget"
          className={`fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-zinc-950 shadow-xl shadow-emerald-500/30 transition hover:bg-emerald-400 active:scale-95 md:hidden ${
            timer.session ? 'bottom-44' : 'bottom-24'
          }`}
        >
          <Plus size={24} />
        </button>
      )}

      <TimerBar timer={timer} />

      <AddEditTaskModal
        open={taskModalOpen}
        task={editingTask}
        onClose={closeTaskModal}
        onSave={saveTask}
      />
      <LogTimeModal
        open={!!logTask}
        task={logTask}
        timerSessionTaskId={timer.session ? timer.session.taskId : null}
        onClose={() => setLogTask(null)}
        onLog={(t, m) => chronos.logTime(t.id, m)}
        onStartTimer={timer.start}
      />
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />

      {toastStack}
    </div>
  );
}

