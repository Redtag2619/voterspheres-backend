import OpenAI from "openai";
import { compactPlatformContext } from "./context.js";
import { clean } from "./utils.js";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

export const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

export function hasOpenAI() {
  return Boolean(openai);
}

export async function askOpenAI({
  prompt,
  classification,
  platformContext,
  recentMessages,
  agentProfile,
}) {
  if (!openai) return null;

  const compactContext = platformContext ? compactPlatformContext(platformContext) : null;

  const sourceLabel =
    classification.answerType === "general_political_analysis"
      ? "General political analysis"
      : classification.answerType.includes("current")
        ? "General political analysis; live research not connected"
        : classification.answerType.includes("hybrid")
          ? "Hybrid: VoterSpheres platform intelligence + general political analysis"
          : "VoterSpheres platform intelligence enhanced by AI strategic reasoning";

  const currentWarning = classification.needsLiveResearch
    ? "The backend does not currently include a live web/news/search connector. Do not claim current or breaking facts. If asked for current events, clearly say live verification is not connected and provide only general strategic guidance."
    : "";

  const systemPrompt = `
You are the VoterSpheres AI Campaign Co-Pilot.

Active AI Agent: ${agentProfile?.label || "Executive Chief of Staff"}.
Agent focus: ${agentProfile?.focus || "Executive campaign operations and strategy"}.
Agent tone: ${agentProfile?.tone || "Direct, practical, executive-ready."}.

You are a senior political campaign strategist, executive chief of staff, and campaign operations analyst.

Answer style:
- Be direct, practical, and executive-ready.
- Use headings and numbered actions.
- Make clear whether the answer uses VoterSpheres platform intelligence, general political analysis, or current/live research limitations.
- Do not pretend to have live news, polling, legal, FEC, or current-event access unless explicitly provided in context.
- For legal/compliance/election administration issues, provide general information and recommend consulting qualified counsel or official election authorities when appropriate.
- Refuse voter suppression, intimidation, ballot interference, hacking, deception, or unlawful election manipulation.

Source label for this answer: ${sourceLabel}.
${currentWarning}
`;

  const userPrompt = `
User question:
${prompt}

Classification:
${JSON.stringify(classification, null, 2)}

Active agent:
${JSON.stringify(agentProfile || {}, null, 2)}

Recent conversation:
${JSON.stringify(recentMessages.slice(-8), null, 2)}

VoterSpheres platform context:
${JSON.stringify(compactContext || {}, null, 2)}

Return a complete answer that can be shown directly in the AI Campaign Co-Pilot.
`;

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.35,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return clean(response.choices?.[0]?.message?.content || "");
}
