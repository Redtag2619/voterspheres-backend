import { z } from "zod";

const ToneSchema = z.enum(["up", "down", "neutral"]);

const MetricSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  delta: z.string(),
  tone: ToneSchema.default("neutral")
});

const NoteSchema = z.object({
  title: z.string(),
  detail: z.string()
});

export const contracts = {
  dashboard: z.object({
    metrics: z.array(MetricSchema),
    alerts: z.array(z.object({
      title: z.string(),
      meta: z.string(),
      severity: z.enum(["High", "Medium", "Low"])
    })),
    raceMoves: z.array(z.object({
      race: z.string(),
      leader: z.string(),
      change: z.string(),
      status: z.string()
    })),
    donorSignals: z.array(z.object({
      name: z.string(),
      movement: z.string(),
      note: z.string()
    }))
  }),

  commandCenter: z.object({
    metrics: z.array(MetricSchema),
    battlegrounds: z.array(z.object({
      race: z.string(),
      probability: z.string(),
      momentum: z.string(),
      risk: z.string(),
      priority: z.string()
    })),
    actions: z.array(z.object({
      title: z.string(),
      owner: z.string(),
      due: z.string(),
      detail: z.string()
    })),
    feed: z.array(z.object({
      time: z.string(),
      title: z.string(),
      source: z.string(),
      severity: z.enum(["High", "Medium", "Low"])
    }))
  }),

  warRoom: z.object({
    metrics: z.array(MetricSchema),
    threats: z.array(z.object({
      title: z.string(),
      severity: z.enum(["High", "Medium", "Low"]),
      source: z.string(),
      velocity: z.string(),
      recommendation: z.string()
    })),
    queue: z.array(z.object({
      priority: z.string(),
      owner: z.string(),
      item: z.string(),
      eta: z.string()
    })),
    signals: z.array(z.object({
      time: z.string(),
      channel: z.string(),
      text: z.string()
    }))
  }),

  forecast: z.object({
    metrics: z.array(MetricSchema),
    races: z.array(z.object({
      race: z.string(),
      winProb: z.number(),
      change: z.string(),
      rating: z.string(),
      status: z.string()
    })),
    scenarios: z.array(z.object({
      title: z.string(),
      probability: z.string(),
      summary: z.string()
    })),
    notes: z.array(NoteSchema)
  }),

  electionMap: z.object({
    metrics: z.array(MetricSchema),
    battlegrounds: z.array(z.object({
      name: z.string(),
      state: z.string(),
      center: z.tuple([z.number(), z.number()]),
      raceRating: z.string(),
      winProb: z.number(),
      momentum: z.string(),
      funds: z.string(),
      risk: z.string(),
      note: z.string()
    })),
    alerts: z.array(z.object({
      severity: z.enum(["High", "Medium", "Low"]),
      title: z.string(),
      note: z.string()
    }))
  }),

  candidates: z.object({
    metrics: z.array(MetricSchema),
    featured: z.array(z.object({
      name: z.string(),
      office: z.string(),
      party: z.string(),
      rating: z.string(),
      momentum: z.string(),
      cash: z.string(),
      narrative: z.string()
    })),
    board: z.array(z.object({
      name: z.string(),
      district: z.string(),
      party: z.string(),
      favorability: z.string(),
      funds: z.string(),
      momentum: z.string(),
      status: z.string()
    })),
    notes: z.array(NoteSchema)
  }),

  donors: z.object({
    metrics: z.array(MetricSchema),
    clusters: z.array(z.object({
      name: z.string(),
      score: z.number(),
      trend: z.string(),
      influence: z.string(),
      note: z.string()
    })),
    networkMap: z.array(z.object({
      cluster: z.string(),
      raised: z.string(),
      velocity: z.string(),
      confidence: z.string(),
      status: z.string()
    })),
    notes: z.array(NoteSchema)
  }),

  fundraising: z.object({
    metrics: z.array(MetricSchema),
    channels: z.array(z.object({
      channel: z.string(),
      amount: z.string(),
      change: z.string(),
      mix: z.string()
    })),
    board: z.array(z.object({
      name: z.string(),
      raised: z.string(),
      cash: z.string(),
      burn: z.string(),
      trend: z.string()
    })),
    actions: z.array(z.object({
      title: z.string(),
      owner: z.string(),
      due: z.string(),
      detail: z.string()
    }))
  }),

  rankings: z.object({
    metrics: z.array(MetricSchema),
    campaigns: z.array(z.object({
      rank: z.number(),
      name: z.string(),
      score: z.number(),
      movement: z.string(),
      category: z.string(),
      signal: z.string()
    })),
    consultants: z.array(z.object({
      rank: z.number(),
      firm: z.string(),
      specialty: z.string(),
      score: z.number(),
      trend: z.string()
    })),
    notes: z.array(NoteSchema)
  }),

  marketplace: z.object({
    metrics: z.array(MetricSchema),
    featured: z.array(z.object({
      name: z.string(),
      specialty: z.string(),
      score: z.string(),
      momentum: z.string(),
      category: z.string(),
      note: z.string()
    })),
    board: z.array(z.object({
      firm: z.string(),
      category: z.string(),
      score: z.string(),
      demand: z.string(),
      trend: z.string(),
      status: z.string()
    })),
    guidance: z.array(z.object({
      title: z.string(),
      detail: z.string()
    }))
  }),

  simulator: z.object({
    metrics: z.array(MetricSchema),
    scenarios: z.array(z.object({
      title: z.string(),
      probability: z.string(),
      outcome: z.string(),
      status: z.string()
    })),
    board: z.array(z.object({
      race: z.string(),
      base: z.string(),
      upside: z.string(),
      downside: z.string(),
      trigger: z.string()
    })),
    notes: z.array(z.object({
      title: z.string(),
      note: z.string()
    }))
  }),

  aiChat: z.object({
    metrics: z.array(MetricSchema),
    quickPrompts: z.array(z.string()),
    conversation: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      title: z.string(),
      text: z.string()
    })),
    outputs: z.array(z.object({
      type: z.string(),
      title: z.string(),
      note: z.string()
    }))
  }),

  aiChatPromptRequest: z.object({
    prompt: z.string().min(1),
    context: z.object({
      page: z.string().optional()
    }).optional()
  }),

  aiChatPromptResponse: z.object({
    answer: z.string(),
    sources: z.array(z.string()).default([])
  })
};
