const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of JS Date objects
// (which pg would otherwise construct in local time, risking off-by-one-day bugs).
types.setTypeParser(1082, (val) => val);

// DATABASE_URL is the single source of truth for the Postgres connection,
// shared with the Python RAG backend via rag/.env (see database/migrate.py).
function loadDatabaseUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	const envPath = path.join(__dirname, "..", "rag", ".env");
	if (fs.existsSync(envPath)) {
		for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
			const [key, ...rest] = trimmed.split("=");
			if (key.trim() === "DATABASE_URL") {
				return rest.join("=").trim().replace(/^["']|["']$/g, "");
			}
		}
	}
	throw new Error("DATABASE_URL is not set (checked env and rag/.env)");
}

const pool = new Pool({ connectionString: loadDatabaseUrl() });

module.exports = { pool };
