import OpenAI from "openai";
import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";
import { buildExecutiveIntelligencePlan } from "./executiveIntelligenceToolPlanner.service.js";
import { mergeExecutiveEvidence } from "./executiveIntelligenceEvidenceMerger.service.js";
import { scoreExecutiveIntelligenceConfidence } from "./executiveIntelligenceConfidence.service.js";
import {
  createProviderDiagnostics,
  runProviderWithDiagnostics,
} from "./executiveIntelligenceProviderDiagnostics.service.js";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function toolArguments(tool, context) {
  return {
    question: context.question,
    query: context.question,
    prompt: context.question,
    workspace_id: context.workspace_id,
    candidate: context.candidate_name || undefined,
    candidate_name: context.candidate_name || undefined,
    state: context.state || undefined,
    state_code: context.state || undefined,
    office: context.office || undefined,
    cycle: context.cycle || undefined,
    locality: context.locality || undefined,
    limit: context.limit,
    tool,
  };
}

function fallbackBrief({ context, evidence, confidence, diagnostics }) {
  if (!evidence.length) {
    return {
      answer:
        `I could not verify live intelligence for ${context.candidate_name || context.state || "this request"}. ` +
        `The orchestration layer completed, but ${diagnostics.successful_provider_count || 0} of ${diagnostics.provider_count || 0} providers returned usable evidence. ` +
        "Review provider diagnostics before treating this as an absence of political activity.",
      executive_summary: "No verified evidence was available from the configured intelligence providers.",
      key_findings: [],
      recommended_actions: [
        "Review failed provider diagnostics.",
        "Confirm candidate and cycle resolution.",
        "Retry without forcing an election cycle unless the user explicitly supplied one.",
      ],
    };
  }

  const findings = evidence.slice(0, 5).map((item) => item.summary || item.content || item.title);
  return {
    answer: [
      `Executive intelligence confidence is ${confidence.score}% (${confidence.label}).`,
      ...findings.map((item, index) => `${index + 1}. ${item}`),
    ].join("\n"),
    executive_summary: findings[0] || "Verified intelligence was returned.",
    key_findings: findings,
    recommended_actions: [
      "Review the highest-ranked evidence and source dates.",
      "Confirm any high-impact claim with the linked primary source before operational action.",
    ],
  };
}

async function synthesizeWithOpenAI({ context, evidence, confidence, diagnostics }) {
  if (!openai || evidence.length === 0) return null;

  const evidencePayload = evidence.slice(0, 14).map((item, index) => ({
    index: index + 1,
    title: item.title,
    summary: item.summary || item.content,
    source: item.source,
    url: item.url,
    published_at: item.published_at,
    verified: item.verified,
  }));

  const response = await openai.responses.create({
    model: process.env.EXECUTIVE_INTELLIGENCE_MODEL || "gpt-4.1-mini",
    temperature: 0.2,
    max_output_tokens: 1200,
    input: [
      {
        role: "system",
        content:
          "You are the VoterSpheres Executive Intelligence synthesizer. Use only the supplied evidence. Distinguish verified facts from inference. Never claim a provider returned data when it did not. Return concise JSON with answer, executive_summary, key_findings, risks, and recommended_actions.",
      },
      {
        role: "user",
        content: JSON.stringify({
          question: context.question,
          resolved_context: context,
          confidence,
          provider_health: diagnostics.health,
          evidence: evidencePayload,
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "executive_intelligence_brief",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            answer: { type: "string" },
            executive_summary: { type: "string" },
            key_findings: { type: "array", items: { type: "string" } },
            risks: { type: "array", items: { type: "string" } },
            recommended_actions: { type: "array", items: { type: "string" } },
          },
          required: ["answer", "executive_summary", "key_findings", "risks", "recommended_actions"],
        },
      },
    },
  });

  const text = response.output_text || "";
  if (!text) return null;
  return JSON.parse(text);
}

export async function planExecutiveIntelligence(input = {}) {
  if (!String(input.question || input.prompt || "").trim()) {
    throw Object.assign(new Error("question is required"), { status: 400 });
  }
  return buildExecutiveIntelligencePlan(input);
}

export async function runExecutiveIntelligenceBrief(input = {}) {
  const plan = await planExecutiveIntelligence(input);
  const diagnostics = createProviderDiagnostics();

  const executions = await Promise.all(
    plan.tools.map(async ({ tool }) => {
      const providerResult = await runProviderWithDiagnostics({
        diagnostics,
        provider: tool,
        tool,
        timeoutMs: Number(process.env.EXECUTIVE_PROVIDER_TIMEOUT_MS || 12000),
        execute: async () =>
          executeExecutiveVoiceTool(tool, toolArguments(tool, plan.context)),
      });

      return {
        ...providerResult,
        provider: tool,
        tool,
      };
    })
  );

  const diagnosticSummary = diagnostics.summarize();
  const merged = mergeExecutiveEvidence(executions, plan.context);
  const confidence = scoreExecutiveIntelligenceConfidence({
    evidence: merged.evidence,
    diagnostics: diagnosticSummary,
    context: plan.context,
  });

  let briefing = null;
  let synthesis = "fallback";

  try {
    briefing = await synthesizeWithOpenAI({
      context: plan.context,
      evidence: merged.evidence,
      confidence,
      diagnostics: diagnosticSummary,
    });
    if (briefing) synthesis = "openai";
  } catch (error) {
    console.error("[Executive Intelligence] OpenAI synthesis failed:", error);
  }

  if (!briefing) {
    briefing = fallbackBrief({
      context: plan.context,
      evidence: merged.evidence,
      confidence,
      diagnostics: diagnosticSummary,
    });
  }

  return {
    ok: true,
    service: "executive-intelligence-orchestrator",
    version: "3.6.1-phase-1",
    question: plan.context.question,
    context: plan.context,
    plan,
    answer: briefing.answer,
    briefing,
    evidence: merged.evidence,
    sources: merged.sources,
    provider_coverage: merged.provider_coverage,
    confidence,
    diagnostics: diagnosticSummary,
    synthesis,
    generated_at: new Date().toISOString(),
  };
}

export function getExecutiveIntelligenceOrchestratorConfig() {
  return {
    ok: true,
    service: "executive-intelligence-orchestrator",
    version: "3.6.1-phase-1",
    openai_configured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.EXECUTIVE_INTELLIGENCE_MODEL || "gpt-4.1-mini",
    provider_timeout_ms: Number(process.env.EXECUTIVE_PROVIDER_TIMEOUT_MS || 12000),
    timestamp: new Date().toISOString(),
  };
}
