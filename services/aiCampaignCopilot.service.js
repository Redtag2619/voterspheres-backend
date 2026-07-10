import { ensureAiCampaignCopilotTables } from "./schema.js";
import { getAgentProfile, listAgents } from "./agents.js";
import { classifyQuestion } from "./classifier.js";
import { getPlatformContext } from "./context.js";
import { buildGeneralFallbackAnswer, buildStaticPlatformAnswer } from "./fallback.js";
import { askOpenAI, hasOpenAI } from "./openaiClient.js";
import {
  createThread,
  getRecentThreadMessages,
  listThreads,
  readThread,
  storeMessage,
  touchThread,
} from "./memory.js";
import {
  clean,
  getFirmId,
  getUserId,
  normalizeWorkspaceId,
  unique,
} from "./utils.js";

export async function askAiCampaignCopilot({ user = {}, payload = {} }) {
  await ensureAiCampaignCopilotTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);

  if (!firmId) throw new Error("Missing firm context.");

  const prompt = clean(payload.prompt || payload.message || "");
  if (!prompt) throw new Error("Prompt is required.");

  const workspaceId = normalizeWorkspaceId(payload.workspace_id);
  const agentProfile = getAgentProfile(payload.agent || payload.agent_key || payload.mode);
  let threadId = payload.thread_id || null;

  if (!threadId) {
    const thread = await createThread({
      firmId,
      workspaceId,
      title: prompt.slice(0, 80) || "Campaign Co-Pilot Conversation",
      userId,
    });

    threadId = thread.id;
  }

  const classification = classifyQuestion(prompt, { hasOpenAI: hasOpenAI() });
  const recentMessages = await getRecentThreadMessages({ firmId, threadId });

  let platformContext = null;

  if (classification.needsPlatform) {
    platformContext = await getPlatformContext({ user, firmId, workspaceId });
  }

  let generated = null;
  let answer = "";
  let confidence = 82;
  let citations = {};
  let sources = classification.sources || [];

  if (classification.needsLLM) {
    try {
      const llmAnswer = await askOpenAI({
        prompt,
        classification,
        platformContext,
        recentMessages,
        agentProfile,
      });

      if (llmAnswer) {
        generated = {
          answer: llmAnswer,
          confidence: classification.needsLiveResearch ? 72 : 92,
          sources: classification.sources,
        };
      }
    } catch (error) {
      console.warn("[ai-campaign-copilot] OpenAI failed, using fallback:", error.message);
    }
  }

  if (!generated && classification.needsPlatform && platformContext) {
    generated = buildStaticPlatformAnswer({ prompt, platformContext });
  }

  if (!generated) {
    generated = buildGeneralFallbackAnswer({ prompt, classification });
  }

  answer = generated.answer;
  confidence = generated.confidence || confidence;
  citations = generated.citations || {};
  sources = unique(generated.sources || sources || []);

  const contextSnapshot = {
    classification,
    agent: agentProfile,
    answer_type: classification.answerType,
    sources,
    confidence,
    platform_context_available: Boolean(platformContext),
    platform_summary: platformContext
      ? {
          mission_summary: platformContext.mission?.summary || {},
          advisor_summary: platformContext.advisor?.summary || {},
          war_room_summary: platformContext.warRoom?.summary || {},
        }
      : {},
    generated_at: new Date().toISOString(),
  };

  await storeMessage({
    firmId,
    threadId,
    role: "user",
    content: prompt,
    contextSnapshot,
    userId,
    answerType: "user_prompt",
    sources: [],
    confidence: 100,
    agentProfile,
  });

  const assistantMessage = await storeMessage({
    firmId,
    threadId,
    role: "assistant",
    content: answer,
    contextSnapshot,
    userId,
    answerType: classification.answerType,
    sources,
    confidence,
    agentProfile,
  });

  await touchThread({ firmId, threadId });

  return {
    thread_id: Number(threadId),
    message: assistantMessage,
    answer,
    intent: classification.intent,
    agent: agentProfile.key,
    agent_label: agentProfile.label,
    answer_type: classification.answerType,
    needs_live_research: classification.needsLiveResearch,
    live_research_connected: false,
    sources,
    confidence,
    citations,
    updated_at: new Date().toISOString(),
  };
}

export async function listAiCampaignCopilotThreads({ user = {} }) {
  return listThreads({ user });
}

export async function getAiCampaignCopilotThread({ user = {}, threadId }) {
  return readThread({ user, threadId });
}

export function listAiCampaignCopilotAgents() {
  return listAgents();
}

export {
  askAiCampaignCopilot,
  getAiCampaignCopilotThread,
  listAiCampaignCopilotAgents,
  listAiCampaignCopilotThreads,
} from "./aiCampaignCopilot/service.js";

export { ensureAiCampaignCopilotTables } from "./aiCampaignCopilot/schema.js";
