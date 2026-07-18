import { BookText, Landmark } from "lucide-react";
import { Card } from "../../components/Card";
import { Badge } from "../../components/Badge";
import styles from "./RegulatoryBaseline.module.css";

interface BaselineRule {
  label: string;
  value: string;
  citation: string;
}

const RULES: BaselineRule[] = [
  {
    label: "Tỷ lệ an toàn vốn tối thiểu (CAR)",
    value: "≥ 8% (vốn lõi cấp 1 ≥ 4,5%, vốn cấp 1 ≥ 6%)",
    citation: "Thông tư 41/2016/TT-NHNN, cập nhật bởi Thông tư 14/2025/TT-NHNN",
  },
  {
    label: "Phân loại nợ & trích lập dự phòng",
    value: "5 nhóm nợ · trích lập 0% / 5% / 20% / 50% / 100% + dự phòng chung 0,75%",
    citation: "Thông tư 11/2021/TT-NHNN",
  },
  {
    label: "Hệ số rủi ro tín dụng bất động sản (theo LTV/DSC)",
    value: "30% – 200% tuỳ tỷ lệ cho vay/tài sản đảm bảo và mục đích vay",
    citation: "Thông tư 22/2019/TT-NHNN",
  },
];

/**
 * Sàn/trần quy định của NHNN áp dụng chung toàn ngành — không thể chỉnh sửa qua console này.
 * Chính sách riêng của từng ngân hàng (bên dưới) chỉ được siết chặt hơn, không được nới lỏng hơn mức này.
 */
export const RegulatoryBaseline = () => (
  <Card
    title={
      <span className={styles.titleRow}>
        <Landmark size={15} /> Quy định bắt buộc toàn ngành
      </span>
    }
    className={styles.card}
  >
    <p className={styles.intro}>
      Áp dụng cho mọi ngân hàng tại Việt Nam theo quy định hiện hành của Ngân hàng Nhà nước. Ngân hàng chỉ có thể siết
      chặt hơn (thận trọng hơn), không được nới lỏng vượt các sàn/trần này.
    </p>
    <ul className={styles.list}>
      {RULES.map(rule => (
        <li key={rule.label} className={styles.rule}>
          <div className={styles.ruleHeader}>
            <span className={styles.ruleLabel}>{rule.label}</span>
            <Badge tone="neutral">{rule.value}</Badge>
          </div>
          <span className={styles.citation}>
            <BookText size={11} /> {rule.citation}
          </span>
        </li>
      ))}
    </ul>
  </Card>
);
