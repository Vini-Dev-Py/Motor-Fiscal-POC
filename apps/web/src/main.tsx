import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './App';
import { initTheme } from './components/shell';
import { TenantProvider } from './lib/tenant';
import './index.css';

initTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TenantProvider>
          <App />
          <Toaster position="bottom-right" richColors closeButton />
        </TenantProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
