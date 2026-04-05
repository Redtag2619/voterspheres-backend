export function getDemoCampaignBundle() {
  return {
    campaign: {
      id: 1,
      campaign_name: "Stephens for Senate",
      candidate_name: "Mark Stephens",
      state: "Georgia",
      office: "U.S. Senate",
      stage: "General Election",
      status: "Active",
      firm_name: "Red Tag Strategies",
      owner_name: "Mark Stephens"
    },

    commandCenter: {
      metrics: [
        { label: "National Win Index", value: "61.8", delta: "+3.1", tone: "up" },
        { label: "Active Threats", value: "4", delta: "2 require action", tone: "down" },
        { label: "Fundraising Pulse", value: "$12.8M", delta: "+9.4%", tone: "up" },
        { label: "Persuasion Opportunity", value: "8.9", delta: "+0.8", tone: "up" }
      ],
      battlegrounds: [
        { race: "GA Senate", probability: "57%", momentum: "+2.4", risk: "Elevated", priority: "Tier 1" },
        { race: "PA Senate", probability: "54%", momentum: "+1.8", risk: "Watch", priority: "Tier 1" },
        { race: "AZ Senate", probability: "51%", momentum: "+1.1", risk: "Watch", priority: "Tier 2" }
      ],
      actions: [
        {
          title: "Deploy suburban affordability contrast",
          owner: "War Room",
          due: "Now",
          detail: "Shift message weight into metro persuadable voter clusters."
        },
        {
          title: "Escalate mail delay response",
          owner: "MailOps",
          due: "45 min",
          detail: "Coordinate with vendor and USPS contact to protect weekend delivery."
        },
        {
          title: "Refresh surrogate briefing memo",
          owner: "Comms",
          due: "2 hrs",
          detail: "Update talking points around education and cost-of-living."
        }
      ],
      feed: [
        {
          id: 1,
          time: "08:12",
          title: "Opposition affordability attack accelerating",
          source: "War Room",
          severity: "High",
          type: "warroom.threat_detected"
        },
        {
          id: 2,
          time: "08:41",
          title: "Mail delay detected at Atlanta NDC",
          source: "Mail Intelligence",
          severity: "High",
          type: "mail.delay_detected"
        },
        {
          id: 3,
          time: "09:05",
          title: "Forecast updated for GA Senate",
          source: "Forecast Engine",
          severity: "Medium",
          type: "forecast.updated"
        }
      ]
    },

    warRoom: {
      metrics: [
        { label: "Active Threats", value: "4", delta: "2 high severity", tone: "down" },
        { label: "Narrative Spikes", value: "6", delta: "Live media crossover", tone: "up" },
        { label: "Response Window", value: "38 min", delta: "Target pace", tone: "neutral" },
        { label: "Signal Confidence", value: "92%", delta: "+ live fusion", tone: "up" }
      ],
      threats: [
        {
          id: 1,
          title: "Cost-of-living attack cluster accelerating in Atlanta media buy",
          severity: "High",
          source: "Ad monitoring",
          velocity: "+44%",
          recommendation: "Push affordability rebuttal package immediately."
        },
        {
          id: 2,
          title: "Education narrative gaining traction in local press",
          severity: "Medium",
          source: "Media monitoring",
          velocity: "+21%",
          recommendation: "Deploy validator-driven education contrast."
        }
      ],
      queue: [
        {
          id: 1,
          priority: "P1",
          owner: "Rapid Response",
          item: "Draft affordability contrast memo",
          eta: "30 min"
        },
        {
          id: 2,
          priority: "P2",
          owner: "Comms",
          item: "Refresh surrogate talking points",
          eta: "2 hrs"
        }
      ],
      signals: [
        {
          id: 1,
          time: "09:14",
          channel: "Local TV",
          text: "Opposition narrative crossed persuadable voter threshold."
        },
        {
          id: 2,
          time: "09:26",
          channel: "Digital Monitoring",
          text: "Education attack language repeating across paid and organic channels."
        }
      ]
    },

    forecast: {
      metrics: [
        { label: "Tracked Races", value: "12", delta: "Live modeled states", tone: "up" },
        { label: "High Confidence", value: "5", delta: "Stable lanes", tone: "up" },
        { label: "Toss-ups", value: "3", delta: "Competitive map", tone: "down" },
        { label: "Battlegrounds", value: "7", delta: "Priority states", tone: "up" }
      ],
      races: [
        { race: "GA Senate", winProb: 57, change: "+2.4", rating: "Lean D", status: "Improving" },
        { race: "PA Senate", winProb: 54, change: "+1.8", rating: "Lean D", status: "Competitive" },
        { race: "AZ Senate", winProb: 51, change: "+1.1", rating: "Toss-up", status: "Watch" }
      ],
      scenarios: [
        {
          title: "Base Case",
          probability: "46%",
          summary: "Suburban turnout holds, affordability message remains dominant."
        },
        {
          title: "Upside Breakout",
          probability: "24%",
          summary: "Education contrast sticks and mail execution improves late vote returns."
        }
      ],
      notes: [
        {
          title: "Georgia remains the clearest upside path",
          detail: "Metro persuasion plus turnout quality is the strongest route to control."
        }
      ]
    },

    fundraising: {
      leaderboard: [
        {
          rank: 1,
          candidate_id: 1,
          name: "Mark Stephens",
          state: "Georgia",
          office: "Senate",
          party: "Democratic",
          receipts: 12850000,
          cash_on_hand: 6100000
        },
        {
          rank: 2,
          candidate_id: 2,
          name: "Jane Thompson",
          state: "Pennsylvania",
          office: "Senate",
          party: "Democratic",
          receipts: 11120000,
          cash_on_hand: 5400000
        }
      ]
    },

    vendors: {
      results: [
        {
          id: 1,
          vendor_name: "Precision Mail Group",
          category: "Direct Mail",
          status: "active",
          state: "Georgia",
          campaign_name: "Stephens for Senate",
          candidate_name: "Mark Stephens",
          firm_name: "Red Tag Strategies",
          contract_value: 85000
        },
        {
          id: 2,
          vendor_name: "Capitol Digital Media",
          category: "Digital",
          status: "active",
          state: "Georgia",
          campaign_name: "Stephens for Senate",
          candidate_name: "Mark Stephens",
          firm_name: "Red Tag Strategies",
          contract_value: 120000
        }
      ]
    }
  };
}

export function isDemoModeEnabled() {
  return String(process.env.BILLING_TEST_MODE || "false").toLowerCase() === "true";
}
