export const checkCreditScore = async (customerId: string): Promise<Record<string, unknown>> => {
  // Mocking an external tool call
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        customerId,
        creditScore: Math.floor(Math.random() * 300) + 500, // 500 to 800
        status: "APPROVED_FOR_CHECK"
      });
    }, 500);
  });
};
