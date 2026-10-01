import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Activity, Blocks, Building2, FileCode2, Moon, Sun, Table2, Webhook, Workflow,
} from 'lucide-react';
import { useTenant } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { REGIME_LABELS } from '@motor-fiscal/shared';
import { Select, Spinner } from './ui';

const NAV = [
  { to: '/fluxos', label: 'Fluxos', icon: Workflow },
  { to: '/webhooks', label: 'Webhooks', icon: Webhook },
  { to: '/overrides', label: 'Overrides', icon: FileCode2 },
  { to: '/execucoes', label: 'Execuções', icon: Activity },
  { to: '/blocos', label: 'Blocos', icon: Blocks },
  { to: '/tabelas', label: 'Tabelas', icon: Table2 },
  { to: '/empresas', label: 'Empresas', icon: Building2 },
];

type Theme = 'light' | 'dark';
const THEME_KEY = 'motor-fiscal:theme';

export function initTheme() {
  let t: Theme | null = null;
  try {
    t = localStorage.getItem(THEME_KEY) as Theme | null;
  } catch {
    /* sem armazenamento */
  }
  const dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  return (
    <button
      type="button"
      aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}
      className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle('dark', next);
        setDark(next);
        try {
          localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
        } catch {
          /* sem armazenamento */
        }
      }}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function Shell() {
  const { tenants, current, setCurrentId, loading, error } = useTenant();
  const { pathname } = useLocation();
  // o editor de fluxos ocupa a tela inteira
  const bleed = /^\/fluxos\/[^/]+/.test(pathname);

  useEffect(() => {
    document.title = 'Motor Fiscal';
  }, []);

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Workflow className="size-4.5" />
          </div>
          <div className="leading-tight">
            <div className="text-[14px] font-semibold">Motor Fiscal</div>
            <div className="text-[11px] text-faint">POC · Yzidro ERP</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
                  isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3 text-[11.5px] leading-snug text-faint">
          Sem login nesta POC: a empresa escolhida vai no header <code className="font-mono">X-Tenant-Id</code>.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-5">
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Building2 className="size-4" />
            Empresa
          </div>
          <div className="flex items-center gap-3">
            {loading ? (
              <Spinner className="size-4" />
            ) : (
              <Select
                className="h-8 w-72"
                value={current?.id}
                onValueChange={setCurrentId}
                placeholder={error ? 'API indisponível' : 'Nenhuma empresa'}
                options={tenants.map((t) => ({ value: t.id, label: t.razaoSocial, hint: REGIME_LABELS[t.regime] }))}
              />
            )}
            <ThemeToggle />
          </div>
        </header>

        <main className={cn('min-h-0 flex-1', bleed ? 'overflow-hidden' : 'overflow-y-auto')}>
          {error ? (
            <div className="p-8">
              <div className="rounded-xl border border-danger/40 bg-danger-soft p-5 text-danger">
                <div className="font-semibold">Não foi possível falar com a API</div>
                <div className="mt-1 text-[13px]">{error.message}. Confira se o backend está rodando (docker compose up).</div>
              </div>
            </div>
          ) : !loading && !current ? (
            <div className="p-8 text-muted">Nenhuma empresa cadastrada. Crie uma em “Empresas”.</div>
          ) : (
            <motion.div
              key={bleed ? 'editor' : pathname}
              className={bleed ? 'h-full' : 'mx-auto w-full max-w-6xl px-6 py-7'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          )}
        </main>
      </div>
    </div>
  );
}
