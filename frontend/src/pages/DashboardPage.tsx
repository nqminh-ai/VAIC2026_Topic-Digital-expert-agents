import { Activity, BadgeCheck, CircleDollarSign } from "lucide-react";
import { Header } from "../layouts/Header";
import { PromptComposer } from "../features/chat/PromptComposer";
import { FinalAnswerPanel } from "../features/chat/FinalAnswerPanel";
import { useOrchestrationStore } from "../store/orchestrationStore";
import styles from "./DashboardPage.module.css";

export const DashboardPage = () => {
  const phase = useOrchestrationStore(s => s.phase);
  const response = useOrchestrationStore(s => s.response);
  const completedAgents = useOrchestrationStore(s => s.steps.filter(step => step.status === "done").length);

  return (
    <>
      <Header
        eyebrow="AI credit workspace"
        title="Thẩm định hồ sơ, từ yêu cầu đến quyết định."
        subtitle="Chọn một tình huống mẫu hoặc mô tả hồ sơ để nhận kết quả thẩm định."
        action={<span className={styles.systemStatus}><i /> Demo system online</span>}
      />

      <div className={styles.summaryBar}>
        <div><Activity size={17} /><span><small>Phiên hiện tại</small><strong>{phase === "idle" ? "Chưa bắt đầu" : phase === "running" ? "Đang xử lý" : "Đã hoàn tất"}</strong></span></div>
        <div><BadgeCheck size={17} /><span><small>Agent hoàn tất</small><strong>{completedAgents || "—"}</strong></span></div>
        <div><CircleDollarSign size={17} /><span><small>Facility</small><strong>{response?.approvalTicketId ?? "Chưa tạo"}</strong></span></div>
      </div>

      <div className={styles.mainColumn}>
        <PromptComposer />
        <FinalAnswerPanel />
      </div>
    </>
  );
};
