import "dotenv/config";
import { pool } from "../db/pool.js";

const CENSUS_URL = "https://api.census.gov/data/2024/geoinfo";

const STATE_NAMES = {
  "01": ["AL", "Alabama"], "02": ["AK", "Alaska"], "04": ["AZ", "Arizona"],
  "05": ["AR", "Arkansas"], "06": ["CA", "California"], "08": ["CO", "Colorado"],
  "09": ["CT", "Connecticut"], "10": ["DE", "Delaware"], "11": ["DC", "District of Columbia"],
  "12": ["FL", "Florida"], "13": ["GA", "Georgia"], "15": ["HI", "Hawaii"],
  "16": ["ID", "Idaho"], "17": ["IL", "Illinois"], "18": ["IN", "Indiana"],
  "19": ["IA", "Iowa"], "20": ["KS", "Kansas"], "21": ["KY", "Kentucky"],
  "22": ["LA", "Louisiana"], "23": ["ME", "Maine"], "24": ["MD", "Maryland"],
  "25": ["MA", "Massachusetts"], "26": ["MI", "Michigan"], "27": ["MN", "Minnesota"],
  "28": ["MS", "Mississippi"], "29": ["MO", "Missouri"], "30": ["MT", "Montana"],
  "31": ["NE", "Nebraska"], "32": ["NV", "Nevada"], "33": ["NH", "New Hampshire"],
  "34": ["NJ", "New Jersey"], "35": ["NM", "New Mexico"], "36": ["NY", "New York"],
  "37": ["NC", "North Carolina"], "38": ["ND", "North Dakota"], "39": ["OH", "Ohio"],
  "40": ["OK", "Oklahoma"], "41": ["OR", "Oregon"], "42": ["PA", "Pennsylvania"],
  "44": ["RI", "Rhode Island"], "45": ["SC", "South Carolina"], "46": ["SD", "South Dakota"],
  "47": ["TN", "Tennessee"], "48": ["TX", "Texas"], "49": ["UT", "Utah"],
  "50": ["VT", "Vermont"], "51": ["VA", "Virginia"], "53": ["WA", "Washington"],
  "54": ["WV", "West Virginia"], "55": ["WI", "Wisconsin"], "56": ["WY", "Wyoming"],
};

function localityTypeFromName(name, stateCode) {
  if (stateCode === "LA") return "Parish";
  if (name.includes("Borough")) return "Borough";
  if (name.includes("Census Area")) return "Census Area";
  if (name.includes("City and Borough")) return "City and Borough";
  if (name.includes("Municipality")) return "Municipality";
  if (name.toLowerCase().includes("city")) return "Independent City";
  if (name.includes("District of Columbia")) return "District";
  return "County";
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS state_localities (
      id SERIAL PRIMARY KEY,
      state_code TEXT NOT NULL,
      state_name TEXT NOT NULL,
      state_fips TEXT NOT NULL,
      county_fips TEXT NOT NULL,
      name TEXT NOT NULL,
      locality_type TEXT DEFAULT 'County',
      full_fips TEXT GENERATED ALWAYS AS (state_fips || county_fips) STORED,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(state_fips, county_fips)
    );

    CREATE INDEX IF NOT EXISTS idx_state_localities_state_code
    ON state_localities(state_code);

    CREATE INDEX IF NOT EXISTS idx_state_localities_full_fips
    ON state_localities(full_fips);
  `);
}

<<<<<<< HEAD
async function fetchAllCounties() {
  const params = new URLSearchParams({
    get: "NAME",
    for: "county:*",
    in: "state:*",
  });

=======
async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "VoterSpheres/1.0",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${text.slice(0, 800)}`);
  }

  if (text.trim().startsWith("<")) {
    throw new Error(`Expected JSON but got HTML: ${text.slice(0, 800)}`);
  }

  return JSON.parse(text);
}

async function fetchAllCounties() {
  const params = new URLSearchParams();
  params.set("get", "NAME");
  params.set("for", "county:*");
  params.set("in", "state:*");

>>>>>>> d22fad5 (Fix Census locality import script)
  if (process.env.CENSUS_API_KEY) {
    params.set("key", process.env.CENSUS_API_KEY);
  }

<<<<<<< HEAD
  const url = `${CENSUS_GEOINFO_URL}?${params.toString()}`;
  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Census request failed ${response.status}: ${text.slice(0, 500)}`);
  }

  if (text.trim().startsWith("<")) {
    throw new Error(`Census returned HTML instead of JSON: ${text.slice(0, 500)}`);
  }

  return JSON.parse(text);
=======
  const url = `${CENSUS_URL}?${params.toString()}`;
  console.log(`?? Census URL: ${url.replace(process.env.CENSUS_API_KEY || "", "REDACTED")}`);

  return fetchJson(url);
>>>>>>> d22fad5 (Fix Census locality import script)
}

async function main() {
  try {
<<<<<<< HEAD
    console.log("🚀 Preparing state_localities table...");
    await ensureTable();

    console.log("🚀 Importing all counties/parishes from Census GEOINFO...");

    const rows = await fetchAllCounties();
=======
    console.log("?? Preparing state_localities table...");
    await ensureTable();

    console.log("?? Importing all counties/parishes from Census GEOINFO...");
    const rows = await fetchAllCounties();

>>>>>>> d22fad5 (Fix Census locality import script)
    const [headers, ...records] = rows;

    const nameIndex = headers.indexOf("NAME");
    const stateIndex = headers.indexOf("state");
    const countyIndex = headers.indexOf("county");
<<<<<<< HEAD
=======

    if (nameIndex === -1 || stateIndex === -1 || countyIndex === -1) {
      throw new Error(`Unexpected Census headers: ${headers.join(", ")}`);
    }
>>>>>>> d22fad5 (Fix Census locality import script)

    let total = 0;

    for (const row of records) {
      const name = row[nameIndex];
      const stateFips = row[stateIndex];
      const countyFips = row[countyIndex];

      const [stateCode, stateName] = STATE_NAMES[stateFips] || [stateFips, stateFips];

      await pool.query(
        `
          INSERT INTO state_localities (
            state_code,
            state_name,
            state_fips,
            county_fips,
            name,
            locality_type,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (state_fips, county_fips)
          DO UPDATE SET
            state_code = EXCLUDED.state_code,
            state_name = EXCLUDED.state_name,
            name = EXCLUDED.name,
            locality_type = EXCLUDED.locality_type,
            updated_at = NOW()
        `,
        [
          stateCode,
          stateName,
          stateFips,
          countyFips,
          name,
          localityTypeFromName(name, stateCode),
        ]
      );

      total += 1;
    }

<<<<<<< HEAD
    console.log(`✅ Import complete. Total localities imported: ${total}`);
=======
    console.log(`? Import complete. Total localities imported: ${total}`);
>>>>>>> d22fad5 (Fix Census locality import script)

    const verify = await pool.query(`
      SELECT state_code, COUNT(*)::int AS count
      FROM state_localities
      GROUP BY state_code
      ORDER BY state_code
<<<<<<< HEAD
      LIMIT 15
=======
      LIMIT 20
>>>>>>> d22fad5 (Fix Census locality import script)
    `);

    console.table(verify.rows);
  } catch (error) {
<<<<<<< HEAD
    console.error("❌ Import failed:", error);
=======
    console.error("? Import failed:", error.message || error);
>>>>>>> d22fad5 (Fix Census locality import script)
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
