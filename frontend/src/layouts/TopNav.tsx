import { Activity, ArrowUpRight, BrainCircuit, ChartNoAxesCombined, ClipboardList, LogOut, SlidersHorizontal, Sparkles } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { useSessionStore } from "../store/sessionStore";
import type { UserRole } from "../types/api";
import styles from "./TopNav.module.css";

const NAV_ITEMS: Array<{ to: string; label: string; icon: typeof Sparkles; roles: UserRole[] }> = [
  { to: "/", label: "Thẩm định", icon: Sparkles, roles: ["CREDIT_OFFICER", "CREDIT_APPROVER"] },
  { to: "/dossiers", label: "Hồ sơ chờ duyệt", icon: ClipboardList, roles: ["CUSTOMER", "CREDIT_OFFICER", "CREDIT_APPROVER", "ADMIN", "AUDITOR"] },
  { to: "/agents", label: "Agent flow", icon: BrainCircuit, roles: ["CREDIT_OFFICER", "CREDIT_APPROVER"] },
  { to: "/policy", label: "Chính sách", icon: SlidersHorizontal, roles: ["CREDIT_APPROVER"] },
  { to: "/metrics", label: "Hiệu năng", icon: ChartNoAxesCombined, roles: ["CREDIT_OFFICER", "CREDIT_APPROVER", "ADMIN", "AUDITOR"] },
];

export const TopNav = () => {
  const { role } = useSessionStore();
  const visibleItems = role ? NAV_ITEMS.filter(item => item.roles.includes(role)) : NAV_ITEMS;
  return (
  <header className={styles.header}>
    <div className={styles.inner}>
      <Link to="/" className={styles.brand} aria-label="Về trang chủ">
        <span className={styles.mark}><Activity size={19} strokeWidth={2.4} /></span>
        <span>
          <strong>VAIC</strong>
          <small>Credit Intelligence</small>
        </span>
      </Link>

      <nav className={styles.nav} aria-label="Điều hướng chính">
        {visibleItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => [styles.navItem, isActive ? styles.active : ""].filter(Boolean).join(" ")}
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className={styles.homeLink}>
        <span style={{
          padding: "3px 8px",
          backgroundColor: "#123c32",
          color: "#ffffff",
          borderRadius: "6px",
          fontSize: "9px",
          letterSpacing: "0.05em",
          fontWeight: 700
        }}>
          CREDIT APPROVER
        </span>
      </div>
    </div>
  </header>
  );
};
