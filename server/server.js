const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const cors = require("cors");
const { pool } = require("./db");

const app = express();
const PORT = 3001;

// --- Middleware ---
app.use(cors()); // Allow requests from your React app

// --- RAG Proxy: /api/rag/* → FastAPI at :8000/api/v1/* ---
// Must be registered BEFORE express.json() — the body parser consumes the request stream,
// which breaks POST forwarding (proxy has nothing to pipe) and multipart uploads.
app.use(
	"/api/rag",
	createProxyMiddleware({
		// rag-backend runs natively on the host (not containerized — see docker-compose.yml),
		// so from inside the server container "localhost" won't reach it; RAG_BACKEND_URL
		// overrides to host.docker.internal there.
		target: process.env.RAG_BACKEND_URL || "http://localhost:8000",
		changeOrigin: true,
		pathRewrite: { "^/": "/api/v1/" },
		on: {
			error: (err, req, res) => {
				console.error("RAG proxy error:", err.message);
				res.status(502).json({ error: "RAG backend unavailable. Is the FastAPI server running on :8000?" });
			},
		},
	}),
);

// --- Price Scraper Proxy: /api/prices/* → FastAPI at :8001/api/v1/* ---
app.use(
	"/api/prices",
	createProxyMiddleware({
		target: process.env.PRICE_SCRAPER_URL || "http://localhost:8001",
		changeOrigin: true,
		pathRewrite: { "^/": "/api/v1/sync/" },
		on: {
			error: (err, req, res) => {
				console.error("Price scraper proxy error:", err.message);
				res.status(502).json({ error: "Price scraper unavailable. Is that service running?" });
			},
		},
	}),
);

// --- Deposit Parser Proxy: /api/deposits/* → FastAPI at :8002/api/v1/deposits/* ---
app.use(
	"/api/deposits",
	createProxyMiddleware({
		target: process.env.DEPOSIT_PARSER_URL || "http://localhost:8002",
		changeOrigin: true,
		pathRewrite: { "^/": "/api/v1/deposits/" },
		on: {
			error: (err, req, res) => {
				console.error("Deposit parser proxy error:", err.message);
				res.status(502).json({ error: "Deposit parser unavailable. Is that service running?" });
			},
		},
	}),
);

// --- Share Parser Proxy: /api/share-parser/* → FastAPI at :8003/api/v1/shares/* ---
// Must also stay before express.json() — /upload forwards multipart PDF uploads.
app.use(
	"/api/share-parser",
	createProxyMiddleware({
		target: process.env.SHARE_PARSER_URL || "http://localhost:8003",
		changeOrigin: true,
		pathRewrite: { "^/": "/api/v1/shares/" },
		on: {
			error: (err, req, res) => {
				console.error("Share parser proxy error:", err.message);
				res.status(502).json({ error: "Share parser unavailable. Is that service running?" });
			},
		},
	}),
);

app.use(express.json({ limit: "10mb" })); // Allow larger payloads for portfolio data

// --- Helper Functions ---

// --- Share Market Portfolio (PostgreSQL: financeos DB, share_* tables) ---
// Single-document API: the frontend GETs the whole portfolio and POSTs the whole
// (debounced) document back on every edit. Each POST replaces the full
// ticker/trade/sell/sector/weekly-price set inside one transaction, mirroring
// the client's in-memory model — see database/004_share_market.sql.

const numOrNull = (v) => (v === null || v === undefined ? null : parseFloat(v));

// GET /api/portfolio - Load the full share market portfolio document
app.get("/api/portfolio", async (req, res) => {
	const client = await pool.connect();
	try {
		const [settingsRes, sectorsRes, tickersRes, tradesRes, sellsRes, weeksRes, pricesRes] = await Promise.all([
			client.query("SELECT key, value FROM share_settings"),
			client.query("SELECT name FROM share_sectors ORDER BY sort_order"),
			client.query(
				'SELECT ticker, company_name AS "companyName", exchange, sector, currency, current_price AS "currentPrice", notes FROM share_tickers ORDER BY ticker',
			),
			client.query(
				'SELECT id, ticker, buy_date AS "buyDate", qty, buy_price AS "buyPrice", fees_total AS "feesTotal", notes FROM share_trades ORDER BY id',
			),
			client.query(
				'SELECT id, ticker, sell_date AS "sellDate", qty, sell_price AS "sellPrice", commission, notes FROM share_sells ORDER BY id',
			),
			client.query("SELECT week_ending AS \"weekEnding\" FROM share_weeks ORDER BY week_ending"),
			client.query('SELECT week_ending AS "weekEnding", ticker, price FROM share_weekly_prices'),
		]);

		const feeRateRow = settingsRes.rows.find((r) => r.key === "sellSideFeeRate");
		const sellSideFeeRate = feeRateRow ? parseFloat(feeRateRow.value) : 0.0112;

		const pricesByWeek = {};
		weeksRes.rows.forEach((w) => {
			pricesByWeek[w.weekEnding] = {};
		});
		pricesRes.rows.forEach((p) => {
			if (!pricesByWeek[p.weekEnding]) pricesByWeek[p.weekEnding] = {};
			pricesByWeek[p.weekEnding][p.ticker] = numOrNull(p.price);
		});
		const weeklyPrices = Object.keys(pricesByWeek)
			.sort()
			.map((weekEnding) => ({ weekEnding, prices: pricesByWeek[weekEnding] }));

		res.json({
			settings: { sellSideFeeRate },
			sectorList: sectorsRes.rows.map((r) => r.name),
			tickers: tickersRes.rows.map((r) => ({ ...r, currentPrice: numOrNull(r.currentPrice) })),
			trades: tradesRes.rows.map((r) => ({ ...r, qty: numOrNull(r.qty), buyPrice: numOrNull(r.buyPrice), feesTotal: numOrNull(r.feesTotal) })),
			sells: sellsRes.rows.map((r) => ({ ...r, qty: numOrNull(r.qty), sellPrice: numOrNull(r.sellPrice), commission: numOrNull(r.commission) })),
			weeklyPrices,
		});
	} catch (error) {
		console.error("Error reading portfolio:", error);
		res.status(500).json({ message: "Error reading portfolio database." });
	} finally {
		client.release();
	}
});

// POST /api/portfolio - Save the full share market portfolio document
app.post("/api/portfolio", async (req, res) => {
	const data = req.body;
	if (!data || !Array.isArray(data.tickers) || !Array.isArray(data.trades)) {
		return res.status(400).json({ message: "Invalid data format. Expected a portfolio document." });
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const feeRate = data.settings && typeof data.settings.sellSideFeeRate === "number" ? data.settings.sellSideFeeRate : 0.0112;
		await client.query(
			`INSERT INTO share_settings (key, value) VALUES ('sellSideFeeRate', $1)
			 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
			[String(feeRate)],
		);

		await client.query("DELETE FROM share_weekly_prices");
		await client.query("DELETE FROM share_weeks");
		await client.query("DELETE FROM share_sells");
		await client.query("DELETE FROM share_trades");
		await client.query("DELETE FROM share_tickers");
		await client.query("DELETE FROM share_sectors");

		const sectorList = Array.isArray(data.sectorList) ? data.sectorList : [];
		for (let i = 0; i < sectorList.length; i++) {
			await client.query("INSERT INTO share_sectors (name, sort_order) VALUES ($1, $2)", [sectorList[i], i]);
		}

		for (const t of data.tickers) {
			await client.query(
				`INSERT INTO share_tickers (ticker, company_name, exchange, sector, currency, current_price, notes)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[t.ticker, t.companyName, t.exchange || "CSE", t.sector || null, t.currency || "LKR", t.currentPrice, t.notes || ""],
			);
		}

		for (const t of data.trades) {
			await client.query(
				`INSERT INTO share_trades (id, ticker, buy_date, qty, buy_price, fees_total, notes)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[t.id, t.ticker, t.buyDate, t.qty, t.buyPrice, t.feesTotal || 0, t.notes || ""],
			);
		}

		const sells = Array.isArray(data.sells) ? data.sells : [];
		for (const s of sells) {
			await client.query(
				`INSERT INTO share_sells (id, ticker, sell_date, qty, sell_price, commission, notes)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[s.id, s.ticker, s.sellDate, s.qty, s.sellPrice, s.commission || 0, s.notes || ""],
			);
		}

		const weeklyPrices = Array.isArray(data.weeklyPrices) ? data.weeklyPrices : [];
		for (const w of weeklyPrices) {
			await client.query("INSERT INTO share_weeks (week_ending) VALUES ($1)", [w.weekEnding]);
			const prices = w.prices || {};
			for (const ticker of Object.keys(prices)) {
				await client.query("INSERT INTO share_weekly_prices (week_ending, ticker, price) VALUES ($1, $2, $3)", [
					w.weekEnding,
					ticker,
					prices[ticker],
				]);
			}
		}

		await client.query("COMMIT");
		res.status(200).json({ message: "Portfolio saved successfully." });
	} catch (error) {
		await client.query("ROLLBACK");
		console.error("Error saving portfolio:", error);
		res.status(500).json({ message: "Error writing portfolio database." });
	} finally {
		client.release();
	}
});

// --- Funds & NAV History (PostgreSQL: financeos DB, funds/transactions/nav_history tables) ---
// Same single-document-per-save shape the frontend already expects from the CSV/JSON days:
// GET returns the whole fund list (with nested transactions), POST replaces it wholesale.

const FUNDS_SELECT = `
	SELECT
		f.id,
		f.name,
		f.type,
		f.current_nav AS "currentNav",
		COALESCE(
			(SELECT json_agg(json_build_object('date', t.date, 'amount', t.amount, 'nav', t.nav, 'units', t.units) ORDER BY t.date)
			 FROM transactions t WHERE t.fund_id = f.id),
			'[]'
		) AS transactions
	FROM funds f
	WHERE f.deleted_at IS NULL
	ORDER BY f.created_at
`;

async function loadFunds(client) {
	const result = await client.query(FUNDS_SELECT);
	return result.rows.map((r) => ({ ...r, currentNav: numOrNull(r.currentNav) }));
}

// GET /api/health - Simple health check endpoint, including a DB ping
app.get("/api/health", async (req, res) => {
	try {
		await pool.query("SELECT 1");
		res.json({ status: "ok" });
	} catch (error) {
		res.status(500).json({ status: "error", message: "Database unreachable." });
	}
});

// GET /api/nav-history - Serve historical NAV + yearly performance data for all funds
app.get("/api/nav-history", async (req, res) => {
	try {
		const result = await pool.query(`
			SELECT
				f.id,
				f.category,
				f.management_company AS "managementCompany",
				COALESCE(
					(SELECT json_agg(json_build_object('date', n.date, 'nav', n.nav, 'return_pct', n.return_pct) ORDER BY n.date)
					 FROM nav_history n WHERE n.fund_id = f.id),
					'[]'
				) AS monthly_performance,
				COALESCE(
					(SELECT json_object_agg(y.year::text, y.return_pct) FROM yearly_performance y WHERE y.fund_id = f.id),
					'{}'
				) AS yearly_performance
			FROM funds f
			WHERE f.deleted_at IS NULL
		`);

		const data = {};
		result.rows.forEach((r) => {
			data[r.id] = {
				fund_info: { category: r.category, management_company: r.managementCompany },
				monthly_performance: r.monthly_performance,
				yearly_performance: r.yearly_performance,
			};
		});
		res.json(data);
	} catch (error) {
		console.error("Error reading NAV history:", error);
		res.status(500).json({ message: "Error reading NAV history." });
	}
});

// GET /api/funds - Load all non-deleted funds with their transactions
app.get("/api/funds", async (req, res) => {
	try {
		const funds = await loadFunds(pool);
		res.json(funds);
	} catch (error) {
		console.error("Error reading funds:", error);
		res.status(500).json({ message: "Error reading from database." });
	}
});

// POST /api/funds - Replace the full fund list. Funds whose id doesn't match an
// existing row are inserted (covers new funds added client-side with a temporary
// id); funds missing from the payload are soft-deleted. Responds with the fresh
// list so the frontend can pick up server-assigned UUIDs for newly-created funds.
app.post("/api/funds", async (req, res) => {
	const funds = req.body;
	if (!Array.isArray(funds)) {
		return res.status(400).json({ message: "Invalid data format. Expected an array of funds." });
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const existingRes = await client.query("SELECT id FROM funds WHERE deleted_at IS NULL");
		const existingIds = new Set(existingRes.rows.map((r) => r.id));
		const incomingIds = new Set();

		for (const fund of funds) {
			let fundId = fund.id;
			if (existingIds.has(fundId)) {
				await client.query(`UPDATE funds SET name = $1, type = $2, current_nav = $3, updated_at = NOW() WHERE id = $4`, [
					fund.name,
					fund.type,
					fund.currentNav,
					fundId,
				]);
			} else {
				const insertRes = await client.query(`INSERT INTO funds (name, type, current_nav) VALUES ($1, $2, $3) RETURNING id`, [
					fund.name,
					fund.type,
					fund.currentNav,
				]);
				fundId = insertRes.rows[0].id;
			}
			incomingIds.add(fundId);

			await client.query("DELETE FROM transactions WHERE fund_id = $1", [fundId]);
			for (const t of fund.transactions || []) {
				await client.query(`INSERT INTO transactions (fund_id, date, amount, nav, units) VALUES ($1, $2, $3, $4, $5)`, [
					fundId,
					t.date,
					t.amount,
					t.nav,
					t.units,
				]);
			}
		}

		for (const id of existingIds) {
			if (!incomingIds.has(id)) {
				await client.query("UPDATE funds SET deleted_at = NOW() WHERE id = $1", [id]);
			}
		}

		const freshFunds = await loadFunds(client);
		await client.query("COMMIT");
		res.status(200).json(freshFunds);
	} catch (error) {
		await client.query("ROLLBACK");
		console.error("Error saving funds:", error);
		res.status(500).json({ message: "Error writing to database." });
	} finally {
		client.release();
	}
});

// --- Fixed Deposits (PostgreSQL: financeos DB, fixed_deposits table) ---
// Plain per-entity CRUD, unlike funds/portfolio's whole-document save: fixed
// deposits are a flat list of independent records with no nested sub-collection
// (no transactions, no trades), so there's nothing a bulk replace buys here.

const FD_SELECT_COLUMNS = `
	id, bank_name AS "bankName", principal, interest_rate AS "interestRate",
	start_date AS "startDate", maturity_date AS "maturityDate",
	payout_frequency AS "payoutFrequency", status, notes
`;

// GET /api/fixed-deposits - List all fixed deposits
app.get("/api/fixed-deposits", async (req, res) => {
	try {
		const result = await pool.query(`SELECT ${FD_SELECT_COLUMNS} FROM fixed_deposits ORDER BY start_date DESC`);
		res.json(
			result.rows.map((r) => ({ ...r, principal: numOrNull(r.principal), interestRate: numOrNull(r.interestRate) })),
		);
	} catch (error) {
		console.error("Error reading fixed deposits:", error);
		res.status(500).json({ message: "Error reading from database." });
	}
});

// POST /api/fixed-deposits - Create a fixed deposit
app.post("/api/fixed-deposits", async (req, res) => {
	const fd = req.body;
	try {
		const result = await pool.query(
			`INSERT INTO fixed_deposits (bank_name, principal, interest_rate, start_date, maturity_date, payout_frequency, status, notes)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 RETURNING ${FD_SELECT_COLUMNS}`,
			[
				fd.bankName,
				fd.principal,
				fd.interestRate,
				fd.startDate,
				fd.maturityDate,
				fd.payoutFrequency || "at_maturity",
				fd.status || "active",
				fd.notes || "",
			],
		);
		const created = result.rows[0];
		res.status(201).json({ ...created, principal: numOrNull(created.principal), interestRate: numOrNull(created.interestRate) });
	} catch (error) {
		console.error("Error creating fixed deposit:", error);
		res.status(500).json({ message: "Error writing to database." });
	}
});

// PUT /api/fixed-deposits/:id - Update a fixed deposit
app.put("/api/fixed-deposits/:id", async (req, res) => {
	const fd = req.body;
	try {
		const result = await pool.query(
			`UPDATE fixed_deposits SET
				bank_name = $1, principal = $2, interest_rate = $3, start_date = $4,
				maturity_date = $5, payout_frequency = $6, status = $7, notes = $8, updated_at = NOW()
			 WHERE id = $9
			 RETURNING ${FD_SELECT_COLUMNS}`,
			[
				fd.bankName,
				fd.principal,
				fd.interestRate,
				fd.startDate,
				fd.maturityDate,
				fd.payoutFrequency || "at_maturity",
				fd.status || "active",
				fd.notes || "",
				req.params.id,
			],
		);
		if (result.rows.length === 0) {
			return res.status(404).json({ message: "Fixed deposit not found." });
		}
		const updated = result.rows[0];
		res.json({ ...updated, principal: numOrNull(updated.principal), interestRate: numOrNull(updated.interestRate) });
	} catch (error) {
		console.error("Error updating fixed deposit:", error);
		res.status(500).json({ message: "Error writing to database." });
	}
});

// DELETE /api/fixed-deposits/:id - Remove a fixed deposit
app.delete("/api/fixed-deposits/:id", async (req, res) => {
	try {
		const result = await pool.query("DELETE FROM fixed_deposits WHERE id = $1", [req.params.id]);
		if (result.rowCount === 0) {
			return res.status(404).json({ message: "Fixed deposit not found." });
		}
		res.status(204).send();
	} catch (error) {
		console.error("Error deleting fixed deposit:", error);
		res.status(500).json({ message: "Error writing to database." });
	}
});

// --- Start Server ---
app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
