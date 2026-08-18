/**
 * dsh-pricing — host half.
 *
 * Fetches the official DeepSeek pricing page (https://api-docs.deepseek.com/zh-cn/quick_start/pricing/),
 * parses the pricing table into structured JSON, caches it with a 1-hour TTL, and serves it to the
 * web client over the local `webServer` route `/pricing.json` (same-origin, no CORS involved).
 * `GET /pricing.json?refresh=1` forces a re-fetch; otherwise a fresh cached copy (<= TTL) is returned.
 *
 * Pure Node side — no dependency on `ctx.web`; uses the Node 22 global `fetch`.
 */

const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
const TTL_MS = 60 * 60 * 1000; // 1 hour

export const inject = ["webServer"];

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/** Minimal HTML text cleanup for table cells. */
function stripTags(text) {
	return text
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

/** Extract the cell texts of one `<tr>` row. */
function cellsOf(rowHtml) {
	const cells = [];
	for (const match of rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)) {
		const text = stripTags(match[1]);
		if (text.length > 0) cells.push(text);
	}
	return cells;
}

/** Parse "9:00 - 12:00、14:00 - 18:00" into [{start, end}, ...] hour windows. */
function parsePeakWindows(raw) {
	const windows = [];
	for (const segment of raw.split(/[、,，]/)) {
		const match = segment.match(/(\d{1,2})\s*[:：]?\s*\d{0,2}\s*[-–—至~]\s*(\d{1,2})/);
		if (match === null) continue;
		const start = Number.parseInt(match[1], 10);
		const end = Number.parseInt(match[2], 10);
		if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) windows.push({ start, end });
	}
	return windows;
}

function parseNumber(text) {
	const value = Number.parseFloat(text.replace(/[^\d.]/g, ""));
	return Number.isNaN(value) ? null : value;
}

/**
 * Parse the pricing page HTML into a structured pricing document.
 * Throws when the expected table is missing (page moved / structure changed).
 */
export function parsePricing(html) {
	if (typeof html !== "string" || html.length === 0) throw new Error("empty pricing page");
	const tableStart = html.indexOf("<table");
	if (tableStart === -1) throw new Error("pricing table not found on page");
	const tableEnd = html.indexOf("</table>", tableStart);
	const table = html.slice(tableStart, tableEnd === -1 ? html.length : tableEnd + 8);

	const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);

	const models = {};
	const order = [];
	let ids = [];
	let contextWindow = null;
	let maxOutputTokens = null;
	let kind = null; // last seen price-kind label: cacheHit | cacheMiss | output

	for (const row of rows) {
		const cells = cellsOf(row);
		if (cells.length === 0) continue;

		// Model ids row: 模型 | deepseek-v4-flash | deepseek-v4-pro
		if (cells[0] === "模型" && cells.length >= 3) {
			ids = cells.slice(1).map((id) => id.trim());
			for (const id of ids) {
				if (!(id in models)) {
					models[id] = { name: id, cacheHit: {}, cacheMiss: {}, output: {}, concurrency: null };
					order.push(id);
				}
			}
			continue;
		}
		// Model version row: 模型版本 | DeepSeek-V4-Flash-0731 | DeepSeek-V4-Pro-0813
		if (cells[0].includes("模型版本") && cells.length >= 3) {
			const versions = cells.slice(1);
			ids.forEach((id, index) => {
				if (id in models && versions[index] !== undefined) models[id].name = versions[index];
			});
			continue;
		}
		// Context / output limits
		if (cells[0].includes("上下文长度")) {
			contextWindow = cells[1] ?? null;
			continue;
		}
		if (cells[0].includes("输出长度")) {
			maxOutputTokens = cells[1] ?? null;
			continue;
		}
		// Price kind labels (they also carry the first 空闲/高峰 row after the 价格 header)
		if (cells.some((cell) => cell.includes("缓存命中"))) kind = "cacheHit";
		else if (cells.some((cell) => cell.includes("缓存未命中"))) kind = "cacheMiss";
		else if (cells[0] === "百万tokens输出") kind = "output";

		// Price rows: [..., 空闲时段|高峰时段, flash, pro]
		const periodIndex = cells.findIndex((cell) => /^(空闲|高峰)时段$/.test(cell));
		if (periodIndex !== -1 && kind !== null) {
			const period = cells[periodIndex] === "高峰时段" ? "peak" : "offPeak";
			const flash = parseNumber(cells[periodIndex + 1] ?? "");
			const pro = parseNumber(cells[periodIndex + 2] ?? "");
			if (ids[0] in models && flash !== null) models[ids[0]][kind][period] = flash;
			if (ids[1] in models && pro !== null) models[ids[1]][kind][period] = pro;
			continue;
		}
		// Concurrency row: 并发限制 | 2500 | 500
		if (cells[0].includes("并发限制") && cells.length >= 3) {
			const flash = parseNumber(cells[1] ?? "");
			const pro = parseNumber(cells[2] ?? "");
			if (ids[0] in models && flash !== null) models[ids[0]].concurrency = flash;
			if (ids[1] in models && pro !== null) models[ids[1]].concurrency = pro;
		}
	}

	if (order.length === 0 || !models[order[0]].cacheHit?.offPeak) {
		throw new Error("pricing table parsed but no price rows found (page structure changed?)");
	}

	// Peak-hour windows from the footnote: (1) 空闲时段价格为高峰时段价格的一半。高峰时段为北京时间 9:00 - 12:00、14:00 - 18:00（其余为空闲时段）。
	const footnote = html.match(/高峰时段为北京时间\s*([^（(<。\n]+)/);
	const peakHoursText = footnote ? footnote[1].trim() : "";
	const peakWindows = parsePeakWindows(peakHoursText);

	return {
		models: Object.fromEntries(order.map((id) => [id, models[id]])),
		modelOrder: order,
		contextWindow,
		maxOutputTokens,
		peakHoursText,
		peakWindows
	};
}

/* ------------------------------------------------------------------ */
/* Plugin body                                                         */
/* ------------------------------------------------------------------ */

/**
 * Host plugin apply: register the `/pricing.json` route with fetch + TTL cache.
 * @param ctx - cordis context with the `webServer` service injected.
 */
export function apply(ctx) {
	const state = { data: null, fetchedAt: 0, error: null, inflight: null };

	/** Snapshot of the current cache state (what the client receives). */
	function snapshot() {
		return {
			ok: state.data !== null,
			fetchedAt: state.fetchedAt,
			ttlMs: TTL_MS,
			source: PRICING_URL,
			data: state.data,
			error: state.error
		};
	}

	/**
	 * Return cached data when fresh; otherwise fetch, parse and cache.
	 * Concurrent calls share one in-flight request.
	 * @param force - bypass the TTL and re-fetch.
	 */
	async function load(force) {
		if (!force && state.data !== null && Date.now() - state.fetchedAt < TTL_MS) return snapshot();
		if (state.inflight !== null) return state.inflight;
		state.inflight = (async () => {
			try {
				const response = await fetch(PRICING_URL, {
					headers: { "user-agent": "dsh-pricing/0.1 (+https://api-docs.deepseek.com)" }
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const html = await response.text();
				const data = parsePricing(html);
				state.data = data;
				state.fetchedAt = Date.now();
				state.error = null;
			} catch (error) {
				// Keep the previous data (if any); surface the error to the client.
				state.error = error instanceof Error ? error.message : String(error);
			} finally {
				state.inflight = null;
			}
			return snapshot();
		})();
		return state.inflight;
	}

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/pricing.json",
		handler: async (req, res) => {
			const raw = req.url ?? "";
			const force = raw.includes("refresh=1");
			const body = await load(force);
			const payload = JSON.stringify(body);
			res.writeHead(200, {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store",
				"Content-Length": Buffer.byteLength(payload)
			});
			res.end(payload);
		}
	}), "dsh-pricing: /pricing.json route");
}
