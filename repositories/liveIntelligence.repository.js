import { pool } from "../db/pool.js";

const clean = (value = "") => String(value ?? "").trim();

function quoteIdentifier(value) {
  const identifier = clean(value);

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

export async function tableExists(tableName) {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `,
    [tableName]
  );

  return Boolean(result.rows[0]?.exists);
}

export async function getTableColumns(tableName) {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

export async function resolveFeedTable(feed) {
  for (const tableName of feed.tables) {
    if (await tableExists(tableName)) {
      return tableName;
    }
  }

  return null;
}

export async function readFeedStats(feed) {
  const tableName = await resolveFeedTable(feed);

  if (!tableName) {
    return {
      connected: false,
      tableName: null,
      count: 0,
      lastSeen: null,
      invalidCount: 0,
      duplicateCount: 0,
      failureReason:
        `No configured source table was found (${feed.tables.join(", ")}).`,
    };
  }

  const columns = await getTableColumns(tableName);
  const timestampColumn = feed.timestampColumns.find((column) =>
    columns.has(column)
  );

  const idColumn = columns.has("id") ? "id" : null;
  const quotedTable = quoteIdentifier(tableName);

  const selectParts = [
    "COUNT(*)::bigint AS count",
  ];

  if (timestampColumn) {
    selectParts.push(
      `MAX(${quoteIdentifier(timestampColumn)}) AS last_seen`
    );
  } else {
    selectParts.push("NULL::timestamptz AS last_seen");
  }

  if (idColumn) {
    selectParts.push(
      `
        (
          COUNT(*) -
          COUNT(DISTINCT ${quoteIdentifier(idColumn)})
        )::bigint AS duplicate_count
      `
    );
  } else {
    selectParts.push("0::bigint AS duplicate_count");
  }

  const result = await pool.query(
    `
      SELECT
        ${selectParts.join(",\n")}
      FROM ${quotedTable}
    `
  );

  const row = result.rows[0] || {};

  return {
    connected: true,
    tableName,
    count: Number(row.count || 0),
    lastSeen: row.last_seen || null,
    invalidCount: 0,
    duplicateCount: Number(row.duplicate_count || 0),
    failureReason: "",
  };
}
