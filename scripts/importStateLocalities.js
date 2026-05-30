import { pool } from "../db/pool.js";

const CENSUS_GEOINFO_URL = "https://api.census.gov/data/2024/geoinfo";

const STATES = [
  ["AL", "Alabama", "01"], ["AK", "Alaska", "02"], ["AZ", "Arizona", "04"],
  ["AR", "Arkansas", "05"], ["CA", "California", "06"], ["CO", "Colorado", "08"],
  ["CT", "Connecticut", "09"], ["DE", "Delaware", "10"], ["DC", "District of Columbia", "11"],
  ["FL", "Florida", "12"], ["GA", "Georgia", "13"], ["HI", "Hawaii", "15"],
  ["ID", "Idaho", "16"], ["IL", "Illinois", "17"], ["IN", "Indiana", "18"],
  ["IA", "Iowa", "19"], ["KS", "Kansas", "20"], ["KY", "Kentucky", "21"],
  ["LA", "Louisiana", "22"], ["ME", "Maine", "23"], ["MD", "Maryland", "24"],
  ["MA", "Massachusetts", "25"], ["MI", "Michigan", "26"], ["MN", "Minnesota", "27"],
  ["MS", "Mississippi", "28"], ["MO", "Missouri", "29"], ["MT", "Montana", "30"],
  ["NE", "Nebraska", "31"], ["NV", "Nevada", "32"], ["NH", "New Hampshire", "33"],
  ["NJ", "New Jersey", "34"], ["NM", "New Mexico", "35"], ["NY", "New York", "36"],
  ["NC", "North Carolina", "37"], ["ND", "North Dakota", "38"], ["OH", "Ohio", "39"],
  ["OK", "Oklahoma", "40"], ["OR", "Oregon", "41"], ["PA", "Pennsylvania", "42"],
  ["RI", "Rhode Island", "44"], ["SC", "South Carolina", "45"], ["SD", "South Dakota", "46"],
  ["TN", "Tennessee", "47"], ["TX", "Texas", "48"], ["UT", "Utah", "49"],
  ["VT", "Vermont", "50"], ["VA", "Virginia", "51"], ["WA", "Washington", "53"],
  ["WV", "West Virginia", "54"], ["WI", "Wisconsin", "55"], ["WY", "Wyoming", "56"],
];

function localityTypeFromName(name, stateCode) {
  if (stateCode === "LA") return "Parish";
  if (name.includes("Borough")) return "Borough";
  if (name.includes("Census Area")) return "Census Area";
  if (name.includes("City and Borough")) return "City and Borough";
  if (name.includes("Municipality")) return "Municipality";
  if (name.includes("city")) return "Independent City";
  if (name.includes("District of Columbia")) return "District";
  return "County";
}

async function fetchCountiesForState([stateCode, stateName, stateFips]) {
  const url = `${CENSUS_GEOINFO_URL}?get=NAME&for=county:*&in=state:${stateFips}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Census request failed for ${stateCode}: ${response.status}`);
  }

  const rows = await response.json();
  const [headers, ...records] = rows;

  const nameIndex = headers.indexOf("NAME");
  const stateIndex = headers.indexOf("state");
  const countyIndex = headers.indexOf("county");

  return records.map((row) => {
    const name = row[nameIndex];
    const censusStateFips = row[stateIndex];
    const countyFips = row[countyIndex];

    return {
      stateCode,
      stateName,
      stateFips: censusStateFips,
      countyFips,
      name,
      localityType: localityTypeFromName(name, stateCode),
    };
  });
}

async function upsertLocality(client, locality) {
  await client.query(
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
      locality.stateCode,
      locality.stateName,
      locality.stateFips,
      locality.countyFips,
      locality.name,
      locality.localityType,
    ]
  );
}

async function main() {
  const client = await pool.connect();

  try {
    console.log("🚀 Importing state localities from Census GEOINFO...");

    let total = 0;

    for (const state of STATES) {
      const [stateCode] = state;
      const localities = await fetchCountiesForState(state);

      await client.query("BEGIN");

      for (const locality of localities) {
        await upsertLocality(client, locality);
      }

      await client.query("COMMIT");

      total += localities.length;
      console.log(`✅ ${stateCode}: ${localities.length} localities imported`);
    }

    console.log(`✅ Import complete. Total localities imported: ${total}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Import failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
