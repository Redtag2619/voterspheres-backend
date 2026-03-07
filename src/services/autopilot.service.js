export function generateCampaignStrategy(data) {

  const {
    state,
    office,
    party,
    opponent,
    budget
  } = data;

  const strategy = {

    campaignOverview: `AI strategy for a ${party} candidate running for ${office} in ${state}.`,

    voterTargets: [
      "Suburban persuadable voters",
      "Independent voters",
      "Low turnout party voters",
      "Issue-based voters"
    ],

    messagingStrategy: [
      "Economic growth and job creation",
      "Public safety and community investment",
      "Education and workforce training",
      "Local infrastructure improvements"
    ],

    fundraisingPlan: {
      strategy: "Hybrid grassroots and major donor fundraising",
      digitalChannels: [
        "Email fundraising",
        "SMS fundraising",
        "Online advertising donation funnels"
      ],
      projectedRaise: budget ? budget * 2 : 5000000
    },

    mediaPlan: [
      "Targeted Facebook and YouTube ads",
      "Local television buys",
      "Podcast and streaming ads",
      "Influencer and grassroots digital outreach"
    ],

    fieldOperations: [
      "Volunteer door knocking",
      "Precinct captain program",
      "Community town halls",
      "Election day turnout program"
    ],

    riskAssessment: [
      `Opponent to monitor: ${opponent}`,
      "Polling volatility",
      "Fundraising gap risk",
      "National political climate shifts"
    ]

  };

  return strategy;

}
