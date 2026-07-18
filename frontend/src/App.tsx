import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { AppShell } from "./layouts/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentsPage } from "./pages/AgentsPage";
import { MetricsPage } from "./pages/MetricsPage";
import { DossierQueuePage } from "./pages/DossierQueuePage";
import { DossierDetailPage } from "./pages/DossierDetailPage";
import { PolicyConsolePage } from "./pages/PolicyConsolePage";
import { getDemoApproverSession } from "./services/authService";
import { useSessionStore } from "./store/sessionStore";

const AutoLoginWrapper = ({ children }: { children: React.ReactNode }) => {
  const { accessToken, setSession } = useSessionStore();
  const [loading, setLoading] = useState(!accessToken);

  useEffect(() => {
    if (!accessToken) {
      getDemoApproverSession()
        .then(session => {
          setSession({
            accessToken: session.accessToken,
            role: session.role,
            tenantId: session.tenantId
          });
          setLoading(false);
        })
        .catch(err => {
          console.error("Auto login failed:", err);
          setLoading(false);
        });
    }
  }, [accessToken, setSession]);

  if (loading) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#0d0e12",
        color: "#ffffff",
        fontFamily: "Inter, sans-serif"
      }}>
        <div style={{
          width: "30px",
          height: "30px",
          border: "3px solid #1f2937",
          borderTop: "3px solid #10b981",
          borderRadius: "50%",
          animation: "spin 1s linear infinite"
        }} />
        <p style={{ marginTop: "15px", fontSize: "14px", color: "#9ca3af" }}>Đang khởi tạo phiên làm việc...</p>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return <>{children}</>;
};

export const App = () => (
  <AutoLoginWrapper>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="dossiers" element={<DossierQueuePage />} />
          <Route path="dossiers/:id" element={<DossierDetailPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="policy" element={<PolicyConsolePage />} />
          <Route path="metrics" element={<MetricsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </AutoLoginWrapper>
);
