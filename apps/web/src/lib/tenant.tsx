import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, setApiTenant, type Tenant } from './api';

interface TenantCtx {
  tenants: Tenant[];
  current: Tenant | null;
  setCurrentId: (id: string) => void;
  loading: boolean;
  error: Error | null;
}

const Ctx = createContext<TenantCtx | null>(null);
const STORAGE_KEY = 'motor-fiscal:tenant';

const readStored = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export function TenantProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<Tenant[]>('/api/tenants') });
  const [selected, setSelected] = useState<string | null>(readStored);

  const tenants = data ?? [];
  const current = tenants.find((t) => t.id === selected) ?? tenants[0] ?? null;
  // o header X-Tenant-Id é definido de forma síncrona para que as queries da página já saiam com ele
  setApiTenant(current?.id ?? null);

  useEffect(() => {
    if (current) {
      try {
        localStorage.setItem(STORAGE_KEY, current.id);
      } catch {
        /* armazenamento indisponível: segue sem lembrar */
      }
    }
  }, [current?.id]);

  const value = useMemo<TenantCtx>(
    () => ({ tenants, current, setCurrentId: setSelected, loading: isLoading, error: error as Error | null }),
    [tenants, current, isLoading, error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTenant() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTenant fora do TenantProvider');
  return c;
}
