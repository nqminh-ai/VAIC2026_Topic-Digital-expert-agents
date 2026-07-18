import { executeOrchestration } from "./services/orchestration/planner.service";

async function main() {
  try {
    const prompt = "Chi tiết Hồ sơ Khách hàng Khách hàng: Nguyễn Văn Hùng (34 tuổi, đã kết hôn). Mục đích vay: Vay thế chấp mua căn hộ thuộc dự án Vinhomes Ocean Park 3";
    console.log("Calling executeOrchestration inside container with prompt:", prompt);
    const result = await executeOrchestration(prompt, "officer.tam");
    console.log("\nRESULT SUCCESS!");
    console.log("Final Answer:", result.finalAnswer);
    if ("traces" in result) {
      console.log("Traces Summary:");
      result.traces.forEach(t => {
        console.log(`- Agent [${t.agent}]: ${t.summary}`);
      });
    } else {
      console.log(`Advisory mode: ${result.mode}`);
    }
  } catch (error) {
    console.error("Error during execution:", error);
  }
}

main();
