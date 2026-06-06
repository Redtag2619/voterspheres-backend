import { getConsultantBusinessSuiteDashboard } from "./consultantBusinessSuite.service.js";

function money(value = 0) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function riskTone(score = 0) {
  if (score >= 80) return "Strong";
  if (score >= 60) return "Stable";
  if (score >= 40) return "Watch";
  return "At Risk";
}

function recommendation(title, category, priority, why, action) {
  return { title, category, priority, why, action };
}

export async function getExecutiveRevenueIntelligence({ user = {} }) {
  const business = await getConsultantBusinessSuiteDashboard({ user });

  const summary = business.summary || {};
  const clients = business.clients || [];
  const projects = business.projects || [];
  const invoices = business.invoices || [];
  const staff = business.staff_utilization || [];
  const clientHealth = business.client_health || [];

  const mrr = money(summary.monthly_retainer_revenue || 0);
  const arr = money(mrr * 12);
  const paidRevenue = money(summary.paid_revenue || 0);
  const openReceivables = money(summary.open_receivables || 0);
  const projectedRevenue = money(summary.projected_revenue || 0);
  const actualCost = money(summary.actual_cost || 0);
  const profitability = money(summary.profitability || 0);

  const grossMargin =
    projectedRevenue + paidRevenue + mrr > 0
      ? Math.round(((projectedRevenue + paidRevenue + mrr - actualCost) / (projectedRevenue + paidRevenue + mrr)) * 100)
      : 0;

  const forecast30 = money(mrr + openReceivables + projectedRevenue * 0.25);
  const forecast90 = money(mrr * 3 + openReceivables + projectedRevenue * 0.5);
  const forecastAnnual = money(arr + projectedRevenue + paidRevenue);

  const atRiskClients = clientHealth.filter((c) =>
    ["At Risk", "Watch"].includes(c.health_status)
  );

  const overdueInvoices = invoices.filter((i) =>
    String(i.status || "").toLowerCase() === "overdue"
  );

  const lowUtilizationStaff = staff.filter((s) => Number(s.utilization_rate || 0) < 55);
  const overloadedStaff = staff.filter((s) => Number(s.utilization_rate || 0) > 85);

  const projectMargins = projects.map((project) => {
    const revenue = Number(project.projected_revenue || 0);
    const cost = Number(project.actual_cost || 0);
    const margin = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0;

    return {
      id: project.id,
      project_name: project.project_name,
      client_name: project.client_name,
      owner: project.owner || "Unassigned",
      status: project.status || "active",
      projected_revenue: money(revenue),
      actual_cost: money(cost),
      margin,
      risk: margin >= 45 ? "Strong" : margin >= 25 ? "Stable" : margin >= 10 ? "Watch" : "At Risk",
    };
  });

  const revenueByClient = clientHealth.map((client) => {
    const clientInvoices = invoices.filter((i) => String(i.client_id || "") === String(client.id));
    const invoiceRevenue = clientInvoices.reduce((sum, i) => sum + Number(i.amount || 0), 0);

    return {
      id: client.id,
      client_name: client.client_name,
      organization: client.organization,
      state: client.state,
      health_status: client.health_status,
      health_score: client.health_score,
      monthly_retainer: money(client.monthly_retainer),
      invoice_revenue: money(invoiceRevenue),
      unpaid_balance: money(client.unpaid_balance),
      total_value: money(Number(client.monthly_retainer || 0) * 12 + invoiceRevenue),
      risk: client.health_status,
    };
  }).sort((a, b) => Number(b.total_value || 0) - Number(a.total_value || 0));

  const recommendations = [];

  if (openReceivables > 0) {
    recommendations.push(
      recommendation(
        "Collect open receivables",
        "Revenue",
        overdueInvoices.length ? "High" : "Medium",
        `${openReceivables.toLocaleString()} in receivables is still open.`,
        "Review unpaid invoices and follow up with clients this week."
      )
    );
  }

  if (atRiskClients.length) {
    recommendations.push(
      recommendation(
        "Schedule retention reviews",
        "Client Health",
        "High",
        `${atRiskClients.length} clients are marked Watch or At Risk.`,
        "Schedule executive check-ins and review deliverables, reports, and portal activity."
      )
    );
  }

  if (projectMargins.some((p) => p.risk === "At Risk")) {
    recommendations.push(
      recommendation(
        "Review project margin risk",
        "Profitability",
        "High",
        "One or more projects have weak or negative margin.",
        "Audit project scope, costs, staffing, and client billing assumptions."
      )
    );
  }

  if (lowUtilizationStaff.length) {
    recommendations.push(
      recommendation(
        "Rebalance staff utilization",
        "Staffing",
        "Medium",
        `${lowUtilizationStaff.length} staff members are under 55% utilization.`,
        "Shift work from overloaded staff or assign new billable work."
      )
    );
  }

  if (overloadedStaff.length) {
    recommendations.push(
      recommendation(
        "Reduce staff overload",
        "Staffing",
        "Medium",
        `${overloadedStaff.length} staff members are above 85% utilization.`,
        "Protect delivery quality by redistributing work or adding support."
      )
    );
  }

  if (!recommendations.length) {
    recommendations.push(
      recommendation(
        "Revenue operation is stable",
        "Executive",
        "Low",
        "No major revenue or utilization risks detected.",
        "Continue monitoring receivables, margins, and client health weekly."
      )
    );
  }

  const healthScore = Math.max(
    0,
    Math.min(
      100,
      75 +
        (mrr > 0 ? 8 : 0) +
        (grossMargin >= 35 ? 8 : grossMargin >= 20 ? 3 : -8) -
        overdueInvoices.length * 5 -
        atRiskClients.length * 4
    )
  );

  return {
    summary: {
      revenue_health_score: Math.round(healthScore),
      revenue_health_status: riskTone(healthScore),
      mrr,
      arr,
      paid_revenue: paidRevenue,
      open_receivables: openReceivables,
      projected_revenue: projectedRevenue,
      actual_cost: actualCost,
      profitability,
      gross_margin: grossMargin,
      forecast_30: forecast30,
      forecast_90: forecast90,
      forecast_annual: forecastAnnual,
      at_risk_clients: atRiskClients.length,
      overdue_invoices: overdueInvoices.length,
      low_utilization_staff: lowUtilizationStaff.length,
      overloaded_staff: overloadedStaff.length,
    },
    revenue_by_client: revenueByClient,
    project_margins: projectMargins,
    staff_utilization: staff,
    at_risk_clients: atRiskClients,
    overdue_invoices: overdueInvoices,
    recommendations,
    source_summary: summary,
    updated_at: new Date().toISOString(),
  };
}
