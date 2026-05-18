import "dotenv/config";

import {
  syncFundraisingFromFec,
  syncFecCommitteeContactsForCandidates,
} from "../services/fec.service.js";

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function boolArg(name, fallback = true) {
  const value = getArg(name, String(fallback));
  return String(value).toLowerCase() !== "false";
}

async function main() {
  const positionalCycle =
    process.argv[2] && !process.argv[2].startsWith("--")
      ? Number(process.argv[2])
      : undefined;

  const cycle = Number(
    getArg("cycle", positionalCycle || process.env.FEC_DEFAULT_CYCLE || 2026)
  );

  const contactsOnly = boolArg("contacts-only", false);
  const syncContacts = boolArg("contacts", true);
  const contactLimit = Number(
    getArg("contact-limit", process.env.FEC_CONTACT_SYNC_LIMIT || 500)
  );
  const contactOffset = Number(getArg("contact-offset", 0));

  const result = contactsOnly
    ? await syncFecCommitteeContactsForCandidates({
        cycle,
        limit: contactLimit,
        offset: contactOffset,
      })
    : await syncFundraisingFromFec({
        cycle,
        syncContacts,
        contactLimit,
        contactOffset,
      });

  console.log("✅ FEC sync complete");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("❌ FEC sync failed");
  console.error(error);
  process.exit(1);
});
