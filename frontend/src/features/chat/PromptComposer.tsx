import { useState, type FormEvent } from "react";
import { CheckCircle2, CircleDollarSign, FileCheck2, Landmark, Plus, Send, Trash2, UserRound } from "lucide-react";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { useAgentStream } from "../../hooks/useAgentStream";
import styles from "./PromptComposer.module.css";

type Income = { type: "salary" | "freelance" | "rental"; amount: string; evidence: string };
type Debt = { type: "auto" | "credit_card" | "other"; monthlyOwed: string; outstandingAmount: string; limit: string; evidence: string };
type FormErrors = Record<string, string>;

const initialIncome = (): Income => ({ type: "salary", amount: "", evidence: "" });
const initialDebt = (): Debt => ({ type: "other", monthlyOwed: "", outstandingAmount: "", limit: "", evidence: "" });
const positiveNumber = (value: string) => Number(value) > 0;
const nonNegativeNumber = (value: string) => value !== "" && Number(value) >= 0;

export const PromptComposer = () => {
  const { run, phase } = useAgentStream();
  const isRunning = phase === "running";
  const [errors, setErrors] = useState<FormErrors>({});
  const [hasDebt, setHasDebt] = useState(false);
  const [incomes, setIncomes] = useState<Income[]>([initialIncome()]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [form, setForm] = useState({
    name: "", age: "", maritalStatus: "single", cccd: "", phone: "", email: "",
    loanType: "mortgage", loanAmount: "", tenureYears: "", refinancePrincipal: "", refinanceMonthlyPayment: "",
    propertyType: "apartment", propertyValue: "", propertyStatus: "completed", projectCode: "", propertyEvidence: "",
    creditCheck: false, taxIncomeCheck: false, socialInsuranceCheck: false, marketing: false,
    insurancePreference: "declined",
  });

  const setField = (field: keyof typeof form, value: string | boolean) => {
    setForm(current => ({ ...current, [field]: value }));
    setErrors(current => { const next = { ...current }; delete next[field]; return next; });
  };
  const updateIncome = (index: number, field: keyof Income, value: string) => setIncomes(current => current.map((item, idx) => idx === index ? { ...item, [field]: value } : item));
  const updateDebt = (index: number, field: keyof Debt, value: string) => setDebts(current => current.map((item, idx) => idx === index ? { ...item, [field]: value } : item));

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    if (!form.name.trim()) next.name = "Vui lòng nhập họ tên khách hàng.";
    if (!positiveNumber(form.age) || Number(form.age) < 18 || Number(form.age) > 100) next.age = "Tuổi phải từ 18 đến 100.";
    if (!/^\d{9,12}$/.test(form.cccd.trim())) next.cccd = "CCCD phải gồm 9–12 chữ số.";
    if (!/^(0|\+84)\d{9,10}$/.test(form.phone.replace(/\s/g, ""))) next.phone = "Số điện thoại không hợp lệ.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = "Email không hợp lệ.";
    incomes.forEach((income, index) => {
      if (!positiveNumber(income.amount)) next[`income-${index}`] = "Thu nhập phải lớn hơn 0.";
      if (!income.evidence.trim()) next[`incomeEvidence-${index}`] = "Cần nêu nguồn chứng minh thu nhập.";
    });
    if (hasDebt && debts.length === 0) next.debts = "Thêm ít nhất một khoản nợ hoặc chọn Không có.";
    debts.forEach((debt, index) => {
      if (!nonNegativeNumber(debt.monthlyOwed) || !nonNegativeNumber(debt.outstandingAmount)) next[`debt-${index}`] = "Dư nợ và nghĩa vụ tháng phải là số không âm.";
      if (debt.type === "credit_card" && !nonNegativeNumber(debt.limit)) next[`debtLimit-${index}`] = "Cần nhập hạn mức thẻ.";
      if (!debt.evidence.trim()) next[`debtEvidence-${index}`] = "Cần nêu nguồn chứng minh nghĩa vụ nợ.";
    });
    if (!positiveNumber(form.loanAmount)) next.loanAmount = "Số tiền vay phải lớn hơn 0.";
    if (!positiveNumber(form.tenureYears) || Number(form.tenureYears) > 30) next.tenureYears = "Thời hạn vay phải từ 1 đến 30 năm.";
    if (form.loanType === "refinance" && !positiveNumber(form.refinancePrincipal)) next.refinancePrincipal = "Cần nhập dư nợ khoản vay được tái cấp vốn.";
    if (form.loanType === "refinance" && !positiveNumber(form.refinanceMonthlyPayment)) next.refinanceMonthlyPayment = "Cần nhập nghĩa vụ trả nợ hiện tại.";
    if (!positiveNumber(form.propertyValue)) next.propertyValue = "Giá trị tài sản phải lớn hơn 0.";
    if (!form.propertyEvidence.trim()) next.propertyEvidence = "Cần nêu nguồn định giá/chứng từ tài sản.";
    if (form.propertyStatus === "future_project" && !form.projectCode.trim()) next.projectCode = "Dự án hình thành trong tương lai cần mã dự án.";
    if (!form.creditCheck) next.creditCheck = "Đồng thuận tra cứu tín dụng là bắt buộc.";
    if (!form.taxIncomeCheck) next.taxIncomeCheck = "Đồng thuận xác minh thu nhập là bắt buộc.";
    return next;
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isRunning) return;
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      document.querySelector("[data-form-error='true']")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const payload = {
      demographic: { name: form.name.trim(), age: Number(form.age), maritalStatus: form.maritalStatus, cccd: form.cccd.trim(), phone: form.phone.trim(), email: form.email.trim() },
      incomeSources: incomes.map(item => ({ type: item.type, amount: Number(item.amount), evidence: item.evidence.trim() })),
      currentDebts: hasDebt ? debts.map(item => ({ type: item.type, monthlyOwed: Number(item.monthlyOwed), outstandingAmount: Number(item.outstandingAmount), ...(item.type === "credit_card" ? { limit: Number(item.limit) } : {}), evidence: item.evidence.trim() })) : [],
      requestedLoan: { type: form.loanType, amount: Number(form.loanAmount), tenureYears: Number(form.tenureYears) },
      ...(form.loanType === "refinance" ? { refinanceAutoLoan: { remainingPrincipal: Number(form.refinancePrincipal), monthlyPayment: Number(form.refinanceMonthlyPayment) } } : {}),
      property: { type: form.propertyType, value: Number(form.propertyValue), status: form.propertyStatus, ...(form.projectCode.trim() ? { projectCode: form.projectCode.trim() } : {}), evidence: form.propertyEvidence.trim() },
      consent: { credit_check: form.creditCheck, tax_income_check: form.taxIncomeCheck, social_insurance_check: form.socialInsuranceCheck, marketing: form.marketing },
      insurancePreference: form.insurancePreference,
    };
    void run(JSON.stringify(payload));
  };

  const error = (key: string) => errors[key] ? <span className={styles.error} data-form-error="true">{errors[key]}</span> : null;

  return (
    <Card title="Yêu cầu thẩm định">
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.formIntro}><div><strong>Hồ sơ tín dụng có cấu trúc</strong><span>Điền các trường bắt buộc (*) để hệ thống thẩm định nhất quán và hạn chế yêu cầu bổ sung.</span></div><span className={styles.requiredNote}>* Bắt buộc</span></div>

        <fieldset disabled={isRunning} className={styles.section}><legend><UserRound size={16} />1. Thông tin khách hàng</legend><div className={styles.grid}>
          <label className={styles.wide}>Họ và tên *<input value={form.name} onChange={e => setField("name", e.target.value)} placeholder="Nguyễn Văn An" />{error("name")}</label>
          <label>Tuổi *<input type="number" min="18" max="100" value={form.age} onChange={e => setField("age", e.target.value)} />{error("age")}</label>
          <label>Tình trạng hôn nhân *<select value={form.maritalStatus} onChange={e => setField("maritalStatus", e.target.value)}><option value="single">Độc thân</option><option value="married">Đã kết hôn</option></select></label>
          <label>CCCD *<input inputMode="numeric" value={form.cccd} onChange={e => setField("cccd", e.target.value.replace(/\D/g, ""))} />{error("cccd")}</label>
          <label>Số điện thoại *<input type="tel" value={form.phone} onChange={e => setField("phone", e.target.value)} />{error("phone")}</label>
          <label className={styles.wide}>Email *<input type="email" value={form.email} onChange={e => setField("email", e.target.value)} />{error("email")}</label>
        </div></fieldset>

        <fieldset disabled={isRunning} className={styles.section}><legend><CircleDollarSign size={16} />2. Nguồn thu nhập</legend>
          {incomes.map((income, index) => <div className={styles.repeatCard} key={index}><div className={styles.repeatHeader}><strong>Nguồn thu {index + 1}</strong>{incomes.length > 1 && <button type="button" onClick={() => setIncomes(items => items.filter((_, idx) => idx !== index))}><Trash2 size={14} /> Xóa</button>}</div><div className={styles.grid}>
            <label>Loại thu nhập *<select value={income.type} onChange={e => updateIncome(index, "type", e.target.value)}><option value="salary">Lương</option><option value="freelance">Kinh doanh/tự do</option><option value="rental">Cho thuê</option></select></label>
            <label>Thu nhập hàng tháng (VND) *<input type="number" min="0" value={income.amount} onChange={e => updateIncome(index, "amount", e.target.value)} />{error(`income-${index}`)}</label>
            <label className={styles.full}>Chứng từ/nguồn xác minh *<input value={income.evidence} onChange={e => updateIncome(index, "evidence", e.target.value)} placeholder="Sao kê lương 6 tháng, hợp đồng lao động…" />{error(`incomeEvidence-${index}`)}</label>
          </div></div>)}
          <button className={styles.addButton} type="button" onClick={() => setIncomes(items => [...items, initialIncome()])}><Plus size={14} /> Thêm nguồn thu</button>
        </fieldset>

        <fieldset disabled={isRunning} className={styles.section}><legend><Landmark size={16} />3. Nghĩa vụ nợ hiện tại</legend>
          <div className={styles.segmented}><button type="button" className={!hasDebt ? styles.active : ""} onClick={() => { setHasDebt(false); setDebts([]); }}>Không có khoản nợ</button><button type="button" className={hasDebt ? styles.active : ""} onClick={() => { setHasDebt(true); if (!debts.length) setDebts([initialDebt()]); }}>Có khoản nợ</button></div>{error("debts")}
          {hasDebt && debts.map((debt, index) => <div className={styles.repeatCard} key={index}><div className={styles.repeatHeader}><strong>Khoản nợ {index + 1}</strong><button type="button" onClick={() => setDebts(items => items.filter((_, idx) => idx !== index))}><Trash2 size={14} /> Xóa</button></div><div className={styles.grid}>
            <label>Loại nghĩa vụ *<select value={debt.type} onChange={e => updateDebt(index, "type", e.target.value)}><option value="auto">Vay ô tô</option><option value="credit_card">Thẻ tín dụng</option><option value="other">Khác</option></select></label>
            <label>Nghĩa vụ trả hàng tháng *<input type="number" min="0" value={debt.monthlyOwed} onChange={e => updateDebt(index, "monthlyOwed", e.target.value)} />{error(`debt-${index}`)}</label>
            <label>Dư nợ còn lại *<input type="number" min="0" value={debt.outstandingAmount} onChange={e => updateDebt(index, "outstandingAmount", e.target.value)} /></label>
            {debt.type === "credit_card" && <label>Hạn mức thẻ *<input type="number" min="0" value={debt.limit} onChange={e => updateDebt(index, "limit", e.target.value)} />{error(`debtLimit-${index}`)}</label>}
            <label className={styles.full}>Nguồn xác minh *<input value={debt.evidence} onChange={e => updateDebt(index, "evidence", e.target.value)} placeholder="CIC, sao kê khoản vay…" />{error(`debtEvidence-${index}`)}</label>
          </div></div>)}
          {hasDebt && <button className={styles.addButton} type="button" onClick={() => setDebts(items => [...items, initialDebt()])}><Plus size={14} /> Thêm khoản nợ</button>}
        </fieldset>

        <fieldset disabled={isRunning} className={styles.section}><legend><Landmark size={16} />4. Khoản vay đề xuất</legend><div className={styles.grid}>
          <label>Sản phẩm *<select value={form.loanType} onChange={e => setField("loanType", e.target.value)}><option value="mortgage">Vay mua nhà</option><option value="refinance">Tái cấp vốn</option></select></label>
          <label>Số tiền đề nghị (VND) *<input type="number" min="0" value={form.loanAmount} onChange={e => setField("loanAmount", e.target.value)} />{error("loanAmount")}</label>
          <label>Thời hạn (năm) *<input type="number" min="1" max="30" value={form.tenureYears} onChange={e => setField("tenureYears", e.target.value)} />{error("tenureYears")}</label>
          {form.loanType === "refinance" && <><label>Dư nợ cần tái cấp vốn *<input type="number" min="0" value={form.refinancePrincipal} onChange={e => setField("refinancePrincipal", e.target.value)} />{error("refinancePrincipal")}</label><label>Nghĩa vụ trả hàng tháng hiện tại *<input type="number" min="0" value={form.refinanceMonthlyPayment} onChange={e => setField("refinanceMonthlyPayment", e.target.value)} />{error("refinanceMonthlyPayment")}</label></>}
        </div></fieldset>

        <fieldset disabled={isRunning} className={styles.section}><legend><FileCheck2 size={16} />5. Tài sản bảo đảm</legend><div className={styles.grid}>
          <label>Loại tài sản *<select value={form.propertyType} onChange={e => setField("propertyType", e.target.value)}><option value="apartment">Căn hộ</option><option value="house">Nhà ở</option><option value="land">Đất</option></select></label>
          <label>Giá trị tài sản (VND) *<input type="number" min="0" value={form.propertyValue} onChange={e => setField("propertyValue", e.target.value)} />{error("propertyValue")}</label>
          <label>Trạng thái pháp lý *<select value={form.propertyStatus} onChange={e => setField("propertyStatus", e.target.value)}><option value="completed">Đã hoàn thiện</option><option value="future_project">Hình thành trong tương lai</option></select></label>
          {form.propertyStatus === "future_project" && <label>Mã dự án *<input value={form.projectCode} onChange={e => setField("projectCode", e.target.value)} />{error("projectCode")}</label>}
          <label className={styles.full}>Chứng từ/nguồn định giá *<input value={form.propertyEvidence} onChange={e => setField("propertyEvidence", e.target.value)} placeholder="Chứng thư định giá, hợp đồng mua bán…" />{error("propertyEvidence")}</label>
        </div></fieldset>

        <fieldset disabled={isRunning} className={styles.section}><legend><CheckCircle2 size={16} />6. Chấp thuận và bảo hiểm</legend><div className={styles.checkGrid}>
          <label><input type="checkbox" checked={form.creditCheck} onChange={e => setField("creditCheck", e.target.checked)} /><span><strong>Tra cứu thông tin tín dụng *</strong><small>Cho phép truy vấn CIC và lịch sử tín dụng.</small></span></label>
          <label><input type="checkbox" checked={form.taxIncomeCheck} onChange={e => setField("taxIncomeCheck", e.target.checked)} /><span><strong>Xác minh thu nhập/thuế *</strong><small>Đối chiếu nguồn thu nhập khai báo.</small></span></label>
          <label><input type="checkbox" checked={form.socialInsuranceCheck} onChange={e => setField("socialInsuranceCheck", e.target.checked)} /><span><strong>Tra cứu bảo hiểm xã hội</strong><small>Hỗ trợ xác minh lịch sử việc làm.</small></span></label>
          <label><input type="checkbox" checked={form.marketing} onChange={e => setField("marketing", e.target.checked)} /><span><strong>Nhận thông tin tiếp thị</strong><small>Không ảnh hưởng tới quyết định tín dụng.</small></span></label>
        </div>{error("creditCheck")}{error("taxIncomeCheck")}
          <label className={styles.insurance}>Nhu cầu bảo hiểm<select value={form.insurancePreference} onChange={e => setField("insurancePreference", e.target.value)}><option value="declined">Không đăng ký</option><option value="accepted">Có nhu cầu tự nguyện</option></select><small>Bảo hiểm không phải điều kiện bắt buộc để được cấp tín dụng.</small></label>
        </fieldset>

        {Object.keys(errors).length > 0 && <div className={styles.errorSummary} role="alert">Hồ sơ còn {Object.keys(errors).length} thông tin cần kiểm tra. Vui lòng xem các trường được đánh dấu.</div>}
        <div className={styles.footer}><span>Dữ liệu định danh sẽ được masking trong trace và dashboard.</span><Button type="submit" isLoading={isRunning}><Send size={15} />{isRunning ? "Đang điều phối…" : "Bắt đầu thẩm định"}</Button></div>
      </form>
    </Card>
  );
};
