import { includesAny } from "./utils.js";

export const UNSAFE_ELECTION_WORDS = [
  "hack voting machine",
  "hack ballot",
  "suppress votes",
  "intimidate voters",
  "deceive voters",
  "mislead voters",
  "fake ballot",
  "discard ballots",
  "illegal voting",
  "steal election",
  "voter fraud scheme",
];

export function isUnsafeElectionRequest(prompt = "") {
  return includesAny(prompt, UNSAFE_ELECTION_WORDS);
}

export function buildSafetyAnswer() {
  return {
    answer:
      "I can’t help with voter intimidation, deception, ballot interference, hacking voting systems, or suppressing lawful participation. I can help with lawful voter education, turnout planning, compliance-safe messaging, field operations, and campaign strategy.",
    confidence: 96,
    sources: ["Safety Policy"],
    answerType: "safety_redirect",
  };
}

