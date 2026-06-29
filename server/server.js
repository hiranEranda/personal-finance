const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;
const DB_DIR = path.join(__dirname, "database");
const ACTIVE_DIR = path.join(DB_DIR, "active_funds");
const DELETED_DIR = path.join(DB_DIR, "deleted_funds");

// --- Middleware ---
app.use(cors()); // Allow requests from your React app

// --- RAG Proxy: /api/rag/* → FastAPI at :8000/api/v1/* ---
// Must be registered BEFORE express.json() — the body parser consumes the request stream,
// which breaks POST forwarding (proxy has nothing to pipe) and multipart uploads.
app.use(
	"/api/rag",
	createProxyMiddleware({
		target: "http://localhost:8000",
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

app.use(express.json({ limit: "10mb" })); // Allow larger payloads for portfolio data

// --- Helper Functions ---

// Ensure the database and its subdirectories exist
if (!fs.existsSync(DB_DIR)) {
	fs.mkdirSync(DB_DIR);
}
if (!fs.existsSync(ACTIVE_DIR)) {
	fs.mkdirSync(ACTIVE_DIR);
}
if (!fs.existsSync(DELETED_DIR)) {
	fs.mkdirSync(DELETED_DIR);
}

// Convert fund object to CSV string format
const fundToCsv = (fund) => {
	// Header for fund metadata
	let csv = "id,name,type,currentNav\n";
	// Data for fund metadata
	csv += `${fund.id},"${fund.name}",${fund.type},${fund.currentNav}\n`;
	// Separator and header for transactions
	csv += "\n#Transactions\n";
	csv += "date,amount,nav,units\n";
	// Data for each transaction
	fund.transactions.forEach((t) => {
		csv += `${t.date},${t.amount},${t.nav},${t.units}\n`;
	});
	return csv;
};

// Parse CSV string back into a fund object
const csvToFund = (csv, id) => {
	const lines = csv.split("\n");
	const fund = { id, transactions: [] };

	// Find the metadata line (should be the second line)
	const metadataLine = lines[1];
	if (metadataLine) {
		const [fundId, name, type, currentNav] = metadataLine.split(",");
		fund.name = name.replace(/"/g, ""); // Remove quotes from name
		fund.type = type;
		fund.currentNav = parseFloat(currentNav);
	}

	// Find where transactions start
	const transactionHeaderIndex = lines.findIndex((line) => line.startsWith("date,amount,nav,units"));
	if (transactionHeaderIndex !== -1) {
		for (let i = transactionHeaderIndex + 1; i < lines.length; i++) {
			if (lines[i].trim()) {
				// Check for empty lines
				const [date, amount, nav, units] = lines[i].split(",");
				fund.transactions.push({
					date,
					amount: parseFloat(amount),
					nav: parseFloat(nav),
					units: parseFloat(units),
				});
			}
		}
	}
	return fund;
};

// --- API Routes ---

const NAV_HISTORY_FILE = path.join(DB_DIR, "nav_history.json");

// GET /api/health - Simple health check endpoint
app.get("/api/health", (req, res) => {
	res.json({ status: "ok" });
});

// GET /api/nav-history - Serve historical NAV data for all funds
app.get("/api/nav-history", (req, res) => {
	try {
		if (!fs.existsSync(NAV_HISTORY_FILE)) {
			return res.json({});
		}
		const data = JSON.parse(fs.readFileSync(NAV_HISTORY_FILE, "utf-8"));
		res.json(data);
	} catch (error) {
		console.error("Error reading NAV history:", error);
		res.status(500).json({ message: "Error reading NAV history." });
	}
});

// GET /api/funds - Load all funds from CSV files in the 'active' directory
app.get("/api/funds", (req, res) => {
	try {
		const files = fs.readdirSync(ACTIVE_DIR);
		const funds = files
			.filter((file) => file.endsWith(".csv"))
			.map((file) => {
				const id = path.basename(file, ".csv");
				const csvContent = fs.readFileSync(path.join(ACTIVE_DIR, file), "utf-8");
				return csvToFund(csvContent, id);
			});
		res.json(funds);
	} catch (error) {
		console.error("Error reading funds:", error);
		res.status(500).json({ message: "Error reading from database." });
	}
});

// POST /api/funds - Save all funds to their respective CSV files
app.post("/api/funds", (req, res) => {
	const funds = req.body;
	if (!Array.isArray(funds)) {
		return res.status(400).json({ message: "Invalid data format. Expected an array of funds." });
	}

	try {
		// Get a list of existing CSV files in the 'active' directory
		const existingFiles = new Set(fs.readdirSync(ACTIVE_DIR).filter((f) => f.endsWith(".csv")));

		// Write a file for each fund in the current state to the 'active' directory
		funds.forEach((fund) => {
			const fileName = `${fund.id}.csv`;
			const csvContent = fundToCsv(fund);
			fs.writeFileSync(path.join(ACTIVE_DIR, fileName), csvContent);
			// Remove the file from the set of existing files, since it's an active fund
			existingFiles.delete(fileName);
		});

		// Any files left in the set are for funds that have been deleted.
		// Move these files from 'active' to the 'deleted_funds' directory.
		existingFiles.forEach((fileToMove) => {
			const sourcePath = path.join(ACTIVE_DIR, fileToMove);
			const destinationPath = path.join(DELETED_DIR, fileToMove);
			fs.renameSync(sourcePath, destinationPath);
			console.log(`Archived deleted fund: ${fileToMove}`);
		});

		res.status(200).json({ message: "Funds saved successfully." });
	} catch (error) {
		console.error("Error saving funds:", error);
		res.status(500).json({ message: "Error writing to database." });
	}
});

// --- Start Server ---
app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
	console.log(`Database directory is: ${DB_DIR}`);
});
