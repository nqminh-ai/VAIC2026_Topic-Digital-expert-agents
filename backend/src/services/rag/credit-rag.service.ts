export const queryCreditPolicies = async (query: string): Promise<string[]> => {
  // Mock RAG response
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        "Policy C-101: Requires minimum credit score of 650 for uncollateralized loans.",
        "Policy C-102: Subject must have no prior defaults."
      ]);
    }, 400);
  });
};
