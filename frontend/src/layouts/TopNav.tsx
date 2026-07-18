import { Activity, ArrowUpRight, BrainCircuit, ChartNoAxesCombined, ClipboardList, House, SlidersHorizontal, Sparkles } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import styles from "./TopNav.module.css";

const NAV_ITEMS = [
  { to: "/workspace", label: "Thẩm định", icon: Sparkles },
  { to: "/dossiers", label: "Hồ sơ chờ duyệt", icon: ClipboardList },
  { to: "/agents", label: "Agent flow", icon: BrainCircuit },
  { to: "/policy", label: "Chính sách", icon: SlidersHorizontal },
  { to: "/metrics", label: "Hiệu năng", icon: ChartNoAxesCombined },
];

export const TopNav = () => (
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
        {NAV_ITEMS.map(item => (
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

      <Link to="/" className={styles.homeLink}>
        <House size={15} />
        <span>Giới thiệu</span>
        <ArrowUpRight size={14} />
      </Link>
    </div>
  </header>
);
