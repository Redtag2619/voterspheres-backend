import { PLATFORM_SOURCE_LABELS } from "./classifier.js";
import { clean, detectState, includesAny, lower, summarizeTop } from "./utils.js";
import { buildSafetyAnswer } from "./safety.js";

export function buildStaticPlatformAnswer({ prompt, platformContext }) {
  const normalizedPrompt = lower(prompt);

  const warRoom = platformContext.warRoom || {};
  const advisor = platformContext.advisor || {};
  const mission = platformContext.mission || {};
  const reports = platformContext.reports || [];

  const recommendations = advisor.recommendations || [];
  const threats = warRoom.threats || [];
  const queue = warRoom.queue || [];
  const signals = warRoom.signals || [];
  const workspaces = warRoom.command_cards || mission.workspace_health || [];
  const tasks = mission.open_tasks || [];
  const crm = mission.crm_followups || [];
  const vendorGaps = mission.vendor_gaps || [];

  const wantsState = detectState(prompt);

  const stateFilter = (item) => {
    if (!wantsState) return true;
    return String(item.state || "").toUpperCase() === wantsState;
  };

  const scopedRecommendations = recommendations.filter(stateFilter);
  const scopedThreats = threats.filter(stateFilter);
  const scopedQueue = queue.filter(stateFilter);
  const scopedSignals = signals.filter(stateFilter);
  const scopedWorkspaces = workspaces.filter(stateFilter);
  const scopedTasks = tasks.filter(stateFilter);
  const scopedCrm = crm.filter(stateFilter);

  let intent = "general";
  if (includesAny(normalizedPrompt, ["what should", "next", "do", "recommend", "strategy", "plan"])) intent = "strategy";
  if (includesAny(normalizedPrompt, ["signal", "threat", "risk", "narrative", "attack"])) intent = "signals";
  if (includesAny(normalizedPrompt, ["task", "owner", "execution", "backlog"])) intent = "tasks";
  if (includesAny(normalizedPrompt, ["crm", "contact", "stakeholder", "follow up", "client"])) intent = "crm";
  if (includesAny(normalizedPrompt, ["report", "brief", "memo", "summary"])) intent = "reports";
  if (includesAny(normalizedPrompt, ["vendor", "mail", "digital", "field"])) intent = "vendors";

  const scopeText = wantsState ? ` for ${wantsState}` : "";

  const topActions = summarizeTop(
    scopedRecommendations.length ? scopedRecommendations : recommendations,
    (item, index) =>
      `${index + 1}. ${clean(item.title)} — ${clean(
        item.expected_impact || item.why || "Assign owner and track outcome."
      )}`,
    5
  );

  const topThreats = summarizeTop(
    scopedThreats.length ? scopedThreats : threats,
    (item, index) =>
      `${index + 1}. ${clean(item.title)} — ${item.severity || item.risk || "Signal"} from ${
        item.source || "War Room"
      }.`,
    5
  );

  const topQueue = summarizeTop(
    scopedQueue.length ? scopedQueue : queue,
    (item, index) =>
      `${index + 1}. ${clean(item.item)} — Owner: ${item.owner || "Command Team"}; ETA: ${
        item.eta || "Today"
      }.`,
    5
  );

  const topTasks = summarizeTop(
    scopedTasks.length ? scopedTasks : tasks,
    (item, index) =>
      `${index + 1}. ${clean(item.title || "Task")} — ${item.priority || "Medium"} priority; ${
        item.assigned_to || "Unassigned"
      }.`,
    5
  );

  const topCrm = summarizeTop(
    scopedCrm.length ? scopedCrm : crm,
    (item, index) =>
      `${index + 1}. ${clean(item.title || "CRM follow-up")} — ${clean(
        item.contact_name || item.outcome || "Follow up required"
      )}.`,
    5
  );

  const topWorkspaces = summarizeTop(
    scopedWorkspaces.length ? scopedWorkspaces : workspaces,
    (item, index) =>
      `${index + 1}. ${clean(item.title || item.name || "Workspace")} — ${
        item.risk || "Stable"
      } risk; ${item.pressure_score || 0}% pressure.`,
    5
  );

  const latestReports = summarizeTop(
    reports,
    (item, index) => `${index + 1}. ${clean(item.title)} — ${item.report_type || "report"}; ${item.state || "National"}.`,
    4
  );

  const lines = ["Source label: Platform intelligence", ""];

  if (intent === "strategy") {
    lines.push(`Here is the recommended campaign plan${scopeText} for the next operating cycle:`);
    lines.push("", "Priority actions:");
    lines.push(...(topActions.length ? topActions : ["1. No urgent recommendations detected. Continue monitoring Mission Control."]));
    lines.push("", "War Room queue:");
    lines.push(...(topQueue.length ? topQueue : ["1. No active response queue items."]));
    lines.push("", "Workspace pressure:");
    lines.push(...(topWorkspaces.length ? topWorkspaces : ["1. No workspace pressure records available."]));
  } else if (intent === "signals") {
    lines.push(`Signal and threat assessment${scopeText}:`, "", "Top threats:");
    lines.push(...(topThreats.length ? topThreats : ["1. No active threats detected."]));
    lines.push("", "Signal stream:");
    lines.push(
      ...summarizeTop(
        scopedSignals.length ? scopedSignals : signals,
        (item, index) =>
          `${index + 1}. ${clean(item.text || item.title)} — ${item.channel || "Signal"}; ${
            item.risk || "Watch"
          }.`,
        5
      )
    );
  } else if (intent === "tasks") {
    lines.push(`Execution task assessment${scopeText}:`, "", "Open tasks:");
    lines.push(...(topTasks.length ? topTasks : ["1. No open execution tasks detected."]));
    lines.push("", "Response queue:");
    lines.push(...(topQueue.length ? topQueue : ["1. No response queue items."]));
  } else if (intent === "crm") {
    lines.push(`CRM and stakeholder follow-up assessment${scopeText}:`, "", "Open CRM follow-ups:");
    lines.push(...(topCrm.length ? topCrm : ["1. No open CRM follow-ups detected."]));
    lines.push("", "Recommended CRM move:");
    lines.push("1. Log all stakeholder outcomes and connect important touches to the relevant workspace.");
  } else if (intent === "reports") {
    lines.push(`Available reporting intelligence${scopeText}:`, "", "Recent reports:");
    lines.push(...(latestReports.length ? latestReports : ["1. No generated reports found. Generate a Daily Intelligence Brief."]));
    lines.push("", "Recommended next report:");
    lines.push(`1. Generate a ${wantsState ? `${wantsState} ` : ""}Daily Intelligence Brief from the Reports page.`);
  } else if (intent === "vendors") {
    lines.push(`Vendor and operational capacity assessment${scopeText}:`, "", "Vendor gaps:");
    lines.push(
      ...(vendorGaps.length
        ? summarizeTop(
            vendorGaps.filter(stateFilter),
            (item, index) =>
              `${index + 1}. ${clean(item.name || item.vendor_name || "Vendor gap")} — ${
                item.state || "National"
              }; ${item.risk || item.coverage_tier || "Review"}.`,
            5
          )
        : ["1. No vendor gaps detected."])
    );
    lines.push("", "Recommended move:");
    lines.push("1. Confirm backup vendor coverage before launching mail, field, or digital actions.");
  } else {
    lines.push(`Current campaign operating assessment${scopeText}:`, "");
    lines.push(`Mission risk: ${mission.summary?.mission_risk || warRoom.summary?.mission_risk || "Stable"}`);
    lines.push(`Pressure score: ${mission.summary?.pressure_score || warRoom.summary?.pressure_score || 0}%`);
    lines.push("", "Top recommended actions:");
    lines.push(...(topActions.length ? topActions : ["1. No urgent advisor actions detected."]));
    lines.push("", "Top threats:");
    lines.push(...(topThreats.length ? topThreats : ["1. No active threats detected."]));
  }

  lines.push("", "Suggested next step:");
  lines.push(
    scopedRecommendations[0]?.title
      ? `Assign an owner for: ${clean(scopedRecommendations[0].title)}`
      : "Open Mission Control and review the highest-priority action queue."
  );

  return {
    answer: lines.join("\n"),
    intent,
    state: wantsState || null,
    confidence: 84,
    sources: PLATFORM_SOURCE_LABELS,
    citations: {
      recommendations: scopedRecommendations.slice(0, 5),
      threats: scopedThreats.slice(0, 5),
      queue: scopedQueue.slice(0, 5),
      tasks: scopedTasks.slice(0, 5),
      crm_followups: scopedCrm.slice(0, 5),
      reports: reports.slice(0, 5),
    },
  };
}

export function buildGeneralFallbackAnswer({ prompt, classification }) {
  if (classification.intent === "unsafe") return buildSafetyAnswer();

  const lines = ["Source label: General political analysis", ""];

  if (classification.needsLiveResearch) {
    lines.push(
      "I do not have a live news/search feed connected in this backend service yet, so I cannot verify current facts, latest polls, breaking news, filings, or today’s developments from here."
    );
    lines.push("");
  }

  lines.push("Here is a campaign-safe strategic answer based on general political knowledge:", "");

  if (includesAny(prompt, ["turnout", "midterm"])) {
    lines.push(
      "Midterm turnout is usually lower than presidential turnout because there is less national media attention, fewer casual voters participate, and campaigns must work harder to identify, persuade, and mobilize lower-propensity voters."
    );
    lines.push("", "Campaign implication:");
    lines.push("1. Invest early in voter identification.");
    lines.push("2. Segment persuasion and turnout universes separately.");
    lines.push("3. Use repeated contact for lower-propensity supporters.");
    lines.push("4. Build local urgency around offices, issues, and consequences.");
  } else if (includesAny(prompt, ["ranked choice", "ranked-choice"])) {
    lines.push(
      "Ranked-choice voting lets voters rank candidates in order of preference. If no candidate wins an outright majority, the lowest-performing candidate is eliminated and their voters’ next choices are redistributed until someone reaches a majority."
    );
    lines.push("", "Campaign implication:");
    lines.push("1. Avoid alienating supporters of adjacent candidates.");
    lines.push("2. Compete for second-choice support.");
    lines.push("3. Educate voters clearly on how to rank their ballot.");
  } else {
    lines.push(
      "For most campaign questions, the best answer starts by separating the problem into four parts: audience, geography, timing, and available resources."
    );
    lines.push("", "Recommended framework:");
    lines.push("1. Define the persuadable or turnout universe.");
    lines.push("2. Identify the geography that can move the outcome.");
    lines.push("3. Match message and channel to the target audience.");
    lines.push("4. Assign owners, deadlines, and measurable outcomes.");
    lines.push("5. Reassess weekly based on polling, field data, fundraising, and media pressure.");
  }

  lines.push("", "To make this more specific, ask with a state, race type, audience, budget, and timeline.");

  return {
    answer: lines.join("\n"),
    confidence: classification.needsLiveResearch ? 68 : 82,
    sources: classification.needsLiveResearch
      ? ["General Political Analysis", "Live Research Not Connected"]
      : ["General Political Analysis"],
  };
}
