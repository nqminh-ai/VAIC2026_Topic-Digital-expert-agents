export const queryLegalRequirements = async (query: string): Promise<string[]> => {
  // Mock RAG response
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        "Reg L-22: All automated decisions must be logged and explainable.",
        "Reg L-23: Customer consent is required for credit score lookup."
      ]);
    }, 450);
  });
};
