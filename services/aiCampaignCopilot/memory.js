import { pool } from "../../db/pool.js";
import { ensureAiCampaignCopilotTables } from "./schema.js";
import { getFirmId } from "./utils.js";
import { DEFAULT_AGENT, AI_AGENTS } from "./agents.js";

export async function getRecentThreadMessages({ firmId, threadId }) {
  if (!threadId) return [];

  try {
    const result = await pool.query(
      `
        SELECT role, content, created_at
        FROM ai_campaign_copilot_messages
        WHERE firm_id = $1 AND thread_id = $2
        ORDER BY created_at DESC
        LIMIT 12
      `,
      [firmId, threadId]
    );

    return result.rows || [];
  } catch (error) {
    console.warn("[ai-campaign-copilot] recent messages skipped:", error.message);
    return [];
  }
}

export async function createThread({ firmId, workspaceId, title, userId }) {
  const result = await pool.query(
    `
      INSERT INTO ai_campaign_copilot_threads (
        firm_id, workspace_id, title, created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,NOW(),NOW())
      RETURNING *
    `,
    [firmId, workspaceId || null, title || "Campaign Co-Pilot Conversation", userId || null]
  );

  return result.rows[0];
}

export async function touchThread({ firmId, threadId }) {
  await pool.query(
    `
      UPDATE ai_campaign_copilot_threads
      SET updated_at = NOW()
      WHERE id = $1 AND firm_id = $2
    `,
    [threadId, firmId]
  );
}

export async function storeMessage({
  firmId,
  threadId,
  role,
  content,
  contextSnapshot,
  userId,
  answerType,
  sources,
  confidence,
  agentProfile,
}) {
  const result = await pool.query(
    `
      INSERT INTO ai_campaign_copilot_messages (
        firm_id,
        thread_id,
        role,
        content,
        context_snapshot,
        created_by,
        answer_type,
        sources,
        confidence,
        agent_key,
        agent_label,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$10,$11,NOW())
      RETURNING *
    `,
    [
      firmId,
      threadId,
      role,
      content,
      JSON.stringify(contextSnapshot || {}),
      userId || null,
      answerType || "platform_intelligence",
      JSON.stringify(sources || []),
      confidence || 88,
      agentProfile?.key || DEFAULT_AGENT,
      agentProfile?.label || AI_AGENTS[DEFAULT_AGENT].label,
    ]
  );

  return result.rows[0];
}

export async function listThreads({ user = {} }) {
  await ensureAiCampaignCopilotTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const result = await pool.query(
    `
      SELECT *
      FROM ai_campaign_copilot_threads
      WHERE firm_id = $1
      ORDER BY updated_at DESC
      LIMIT 50
    `,
    [firmId]
  );

  return result.rows;
}

export async function readThread({ user = {}, threadId }) {
  await ensureAiCampaignCopilotTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const thread = await pool.query(
    `
      SELECT *
      FROM ai_campaign_copilot_threads
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [threadId, firmId]
  );

  if (!thread.rows[0]) throw new Error("Thread not found.");

  const messages = await pool.query(
    `
      SELECT *
      FROM ai_campaign_copilot_messages
      WHERE firm_id = $1 AND thread_id = $2
      ORDER BY created_at ASC
    `,
    [firmId, threadId]
  );

  return {
    thread: thread.rows[0],
    messages: messages.rows,
  };
}
