export async function getAIChatData() {
  return {
    metrics: [],
    quickPrompts: [],
    conversation: [],
    outputs: []
  };
}

export async function runAIChatPrompt(body) {
  return {
    answer: `Received prompt: ${body?.prompt || ""}`,
    sources: ["ai-chat"]
  };
}
