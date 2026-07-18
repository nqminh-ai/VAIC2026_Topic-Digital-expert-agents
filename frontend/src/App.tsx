import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layouts/AppShell";
import { LandingPage } from "./pages/LandingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentsPage } from "./pages/AgentsPage";
import { MetricsPage } from "./pages/MetricsPage";
import { RolesPage } from "./pages/RolesPage";
import { DossierQueuePage } from "./pages/DossierQueuePage";
import { DossierDetailPage } from "./pages/DossierDetailPage";

export const App = () => (
  <BrowserRouter>
    <Routes>
      <Route index element={<LandingPage />} />
      <Route element={<AppShell />}>
        <Route path="workspace" element={<DashboardPage />} />
        <Route path="dossiers" element={<DossierQueuePage />} />
        <Route path="dossiers/:id" element={<DossierDetailPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="metrics" element={<MetricsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);
