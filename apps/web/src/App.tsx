import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/shell';
import { TenantsPage } from './pages/tenants';
import { FlowsPage } from './pages/flows';
import { FlowEditorPage } from './features/editor/editor-page';
import { WebhooksPage } from './pages/webhooks';
import { OverridesPage } from './pages/overrides';
import { ExecutionsPage } from './pages/executions';
import { BlocksPage } from './pages/blocks';
import { TablesPage } from './pages/tables';

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/fluxos" replace />} />
        <Route path="/fluxos" element={<FlowsPage />} />
        <Route path="/fluxos/:id" element={<FlowEditorPage />} />
        <Route path="/webhooks" element={<WebhooksPage />} />
        <Route path="/overrides" element={<OverridesPage />} />
        <Route path="/execucoes" element={<ExecutionsPage />} />
        <Route path="/blocos" element={<BlocksPage />} />
        <Route path="/tabelas" element={<TablesPage />} />
        <Route path="/empresas" element={<TenantsPage />} />
        <Route path="*" element={<Navigate to="/fluxos" replace />} />
      </Route>
    </Routes>
  );
}
