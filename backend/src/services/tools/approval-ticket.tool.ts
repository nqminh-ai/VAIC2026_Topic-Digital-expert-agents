export const createApprovalTicket = async (details: Record<string, unknown>): Promise<Record<string, unknown>> => {
  // Mocking an external tool call for operations
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ticketId: `TKT-${Math.floor(Math.random() * 10000)}`,
        status: "CREATED",
        details
      });
    }, 600);
  });
};
