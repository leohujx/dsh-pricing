/**
 * dsh-pricing — client half (hand-written `__ModuleLoader__` bundle).
 *
 * Renders a compact pricing badge into the session header's title row,
 * immediately to the LEFT of the "Session log" download button, by
 * registering into `conversation.session.header.utilities` with an order
 * lower than the Session log entry. Clicking the badge opens a dark
 * popover (downward, fixed-position) with the full pricing table. Data
 * comes from the host route `/pricing.json` (same-origin, no CORS).
 * Auto-refreshes after the 1h TTL and offers a manual refresh button.
 */
window.__ModuleLoader__.load({
	id: "dsh-pricing",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require("react");
		const { jsx: _jsx, jsxs: _jsxs } = require("react/jsx-runtime");

		/* ------------------------------------------------------------ */
		/* Pure helpers                                                 */
		/* ------------------------------------------------------------ */

		const PRICING_ENDPOINT = "/pricing.json";
		const TTL_MS = 60 * 60 * 1000;

		/**
		 * Current peak/off-peak period in Beijing time (UTC+8).
		 * @param peakWindows - [{start, end}, ...] hour windows.
		 * @returns "peak" | "offPeak"
		 */
		function currentPeriod(peakWindows) {
			const hour = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
			const windows = Array.isArray(peakWindows) ? peakWindows : [];
			return windows.some((w) => hour >= w.start && hour < w.end) ? "peak" : "offPeak";
		}

		function formatPrice(value) {
			if (value === null || value === undefined) return "—";
			return "¥" + String(value);
		}

		function formatTime(ms) {
			if (!ms) return "";
			const date = new Date(ms);
			const pad = (n) => String(n).padStart(2, "0");
			return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}

		/* ------------------------------------------------------------ */
		/* Styles (installed once)                                      */
		/* ------------------------------------------------------------ */

		let stylesInstalled = false;
		function installStyles() {
			if (stylesInstalled || typeof document === "undefined") return;
			stylesInstalled = true;
			const style = document.createElement("style");
			style.textContent = [
				".dshp-badge{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:999px;font-size:12px;line-height:1;cursor:pointer;user-select:none;white-space:nowrap;vertical-align:middle;",
				"border:1px solid var(--dsw-alias-line-normal,rgba(127,127,127,.45));",
				"background:var(--dsw-alias-fill-secondary,rgba(127,127,127,.16));",
				"color:var(--dsw-alias-label-primary,inherit);transition:opacity .12s ease}",
				".dshp-badge:hover{opacity:.82}",
				".dshp-badge__dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#34d399)}",
				".dshp-badge--peak .dshp-badge__dot{background:var(--dsw-alias-state-warn-primary,#f59e0b)}",
				".dshp-badge__model{font-weight:600}",
				".dshp-badge__price{font-variant-numeric:tabular-nums}",
				".dshp-badge__period{font-size:11px;opacity:.75}",
				".dshp-backdrop{position:fixed;inset:0;z-index:2147483000}",
				".dshp-popover{position:fixed;z-index:2147483001;overflow-y:auto;padding:12px 14px;border-radius:12px;box-sizing:border-box;",
				"background:var(--dsw-alias-tooltip-bg,rgba(30,33,40,.98));color:var(--dsw-alias-label-primary-inverted,#f4f4f5);",
				"border:1px solid rgba(255,255,255,.16);",
				"box-shadow:0 12px 32px rgba(0,0,0,.4);font-size:12px;line-height:1.5;text-align:left}",
				".dshp-popover__head{display:flex;align-items:center;gap:8px;margin-bottom:8px}",
				".dshp-popover__title{font-size:13px;font-weight:700}",
				".dshp-pill{padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}",
				".dshp-pill--peak{background:rgba(245,158,11,.22);color:#fbbf24}",
				".dshp-pill--off{background:rgba(52,211,153,.2);color:#34d399}",
				".dshp-popover__meta{font-size:11px;opacity:.6;margin-left:auto}",
				".dshp-note{font-size:11px;opacity:.75;margin-bottom:8px}",
				".dshp-table{width:100%;border-collapse:collapse;margin-bottom:8px}",
				".dshp-table th,.dshp-table td{padding:4px 6px;text-align:center;border-bottom:1px solid rgba(255,255,255,.16);font-variant-numeric:tabular-nums}",
				".dshp-table th{font-weight:600;opacity:.8}",
				".dshp-table td:first-child,.dshp-table th:first-child{text-align:left;opacity:.95}",
				".dshp-table .dshp-now{background:rgba(96,165,250,.3);border-radius:6px;font-weight:700}",
				".dshp-table .dshp-dim{opacity:.5}",
				".dshp-foot{display:flex;align-items:center;gap:10px;font-size:11px;opacity:.85}",
				".dshp-refresh{display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(255,255,255,.45);background:transparent;color:inherit;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer}",
				".dshp-refresh:hover{opacity:.8}",
				".dshp-refresh:disabled{opacity:.4;cursor:default}",
				".dshp-error{color:#f87171;font-size:11px;margin-top:6px}",
				".dshp-link{color:inherit;opacity:.85}",
				".dshp-view{box-sizing:border-box;width:100%;padding:16px 20px;overflow-y:auto}",
				".dshp-view .dshp-popover__head{margin-bottom:10px}",
				".dshp-view .dshp-note{margin-bottom:10px}"

			].join("");
			document.head.appendChild(style);
		}

		/* ------------------------------------------------------------ */
		/* Hooks                                                        */
		/* ------------------------------------------------------------ */

		/** Fetch /pricing.json with 1h TTL auto-refresh. Returns [state, reload]. */
		function usePricing() {
			const [state, setState] = React.useState({ loading: true, stale: false, payload: null, error: null });
			const load = React.useCallback(async (refresh) => {
				setState((s) => ({ ...s, loading: true, error: null }));
				try {
					const res = await fetch(PRICING_ENDPOINT + (refresh ? "?refresh=1" : ""), { cache: "no-store" });
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const payload = await res.json();
					setState({
						loading: false,
						stale: false,
						payload,
						error: payload.ok ? null : (payload.error || "获取失败")
					});
				} catch (error) {
					setState((s) => ({
						...s,
						loading: false,
						error: error && error.message ? error.message : String(error)
					}));
				}
			}, []);
			React.useEffect(() => { load(false); }, [load]);
			React.useEffect(() => {
				const timer = setInterval(() => {
					setState((s) => {
						if (s.payload && s.payload.fetchedAt && Date.now() - s.payload.fetchedAt >= TTL_MS) {
							return { ...s, stale: true };
						}
						return s;
					});
				}, 60 * 1000);
				return () => clearInterval(timer);
			}, []);
			React.useEffect(() => {
				if (state.stale && !state.loading) load(false);
			}, [state.stale, state.loading, load]);
			return [state, load];
		}

		/** Current session id from the `sessions` service list store. */
		function useCurrentSessionId(sessions) {
			const getSnapshot = () => (sessions && sessions.list && sessions.list.getSnapshot()
				? sessions.list.getSnapshot().current ?? null
				: null);
			return React.useSyncExternalStore(
				sessions && sessions.list ? sessions.list.subscribe : () => () => {},
				getSnapshot,
				getSnapshot
			);
		}

		/**
		 * Resolve the session's current model id.
		 *
		 * Primary source: the shared per-session model-directory store from the
		 * `modelDirectories` service (the same store the model picker writes to),
		 * subscribed via useSyncExternalStore — so switching the model in the
		 * composer updates the badge immediately. The store is seeded with a
		 * directory load on first use; if the service is unavailable, falls back
		 * to a one-shot `sessions.models` RPC.
		 */
		function useCurrentModel(modelDirectories, sessions, sessionId) {
			let directory = null;
			if (modelDirectories && sessionId) {
				try {
					directory = modelDirectories.directoryFor(sessionId);
				} catch {}
			}
			const store = directory ? directory.store : null;
			const getSnapshot = () => (store ? store.getSnapshot() : null);
			const snapshot = React.useSyncExternalStore(
				store ? store.subscribe : () => () => {},
				getSnapshot,
				getSnapshot
			);
			React.useEffect(() => {
				if (directory && snapshot && snapshot.status !== "loading" && snapshot.status !== "ready") {
					directory.load().catch(() => {});
				}
			}, [directory, snapshot]);
			const [fallbackModel, setFallbackModel] = React.useState(null);
			React.useEffect(() => {
				if (store) return undefined;
				let alive = true;
				if (!sessions || !sessionId) return undefined;
				try {
					sessions.models({ sessionId }).then(({ result }) => {
						if (!alive) return;
						if (result && result.ok && result.value && result.value.current) {
							setFallbackModel(result.value.current.model);
						}
					}).catch(() => {});
				} catch {}
				return () => { alive = false; };
			}, [store, sessions, sessionId]);
			const current = snapshot && snapshot.current ? snapshot.current : null;
			return current && current.model ? current.model : fallbackModel;
		}

		/* ------------------------------------------------------------ */
		/* Components                                                   */
		/* ------------------------------------------------------------ */

		function PricingTable({ table, period }) {
			const kinds = [
				["cacheHit", "输入（缓存命中）"],
				["cacheMiss", "输入（缓存未命中）"],
				["output", "输出"]
			];
			const ids = table.modelOrder && table.modelOrder.length > 0
				? table.modelOrder
				: ["deepseek-v4-flash", "deepseek-v4-pro"];
			const periods = ["offPeak", "peak"];
			return _jsx("table", { className: "dshp-table", children: [
				_jsx("thead", { children: _jsx("tr", { children: [
					_jsx("th", { children: "价格项（元/百万 tokens）" }, "label"),
					...ids.map((id) => periods.map((p) =>
						_jsx("th", { className: p === period ? "dshp-now" : "", children: `${table.models[id].name.replace(/^DeepSeek-V4-/, "").replace(/-.*$/, "")} ${p === "peak" ? "高峰" : "空闲"}` }, `${id}-${p}`)
					))
				] }) }, "head"),
				_jsx("tbody", { children: kinds.map(([key, label]) => _jsx("tr", { children: [
					_jsx("td", { children: label }, "label"),
					...ids.map((id) => periods.map((p) => {
						const value = table.models[id][key] ? table.models[id][key][p] : null;
						return _jsx("td", { className: p === period ? "dshp-now" : "dshp-dim", children: formatPrice(value) }, `${id}-${key}-${p}`);
					}))
				] }, key)) }, "body"),
			] });
		}

		/** The full pricing content shared by the popover and the standalone view. */
		function PricingContent({ state, load }) {
			const payload = state.payload;
			const table = payload && payload.data ? payload.data : null;
			const period = table ? currentPeriod(table.peakWindows) : null;
			const periodLabel = period === "peak" ? "高峰" : period === "offPeak" ? "空闲" : null;
			const peakHoursText = table && table.peakHoursText ? table.peakHoursText : "";

			const children = [];
			children.push(_jsx("div", { className: "dshp-popover__head", children: [
				_jsx("span", { className: "dshp-popover__title", children: "DeepSeek API 定价" }, "title"),
				period ? _jsx("span", { className: "dshp-pill dshp-pill--" + (period === "peak" ? "peak" : "off"), children: `当前：${periodLabel}时段` }, "pill") : null,
				payload && payload.fetchedAt
					? _jsx("span", { className: "dshp-popover__meta", children: `更新于 ${formatTime(payload.fetchedAt)}` }, "meta")
					: null
			] }, "head"));
			if (table) {
				if (peakHoursText) children.push(_jsx("div", { className: "dshp-note", children: `高峰时段：北京时间 ${peakHoursText}（其余为空闲，空闲价格为高峰的一半）` }, "note"));
				children.push(_jsx(PricingTable, { table, period }, "table"));
				children.push(_jsx("div", { className: "dshp-note", children: `并发限制：Flash ${table.models["deepseek-v4-flash"] ? table.models["deepseek-v4-flash"].concurrency : "—"} / Pro ${table.models["deepseek-v4-pro"] ? table.models["deepseek-v4-pro"].concurrency : "—"} · 上下文 ${table.contextWindow ?? "—"} · 输出 ${table.maxOutputTokens ?? "—"}` }, "limits"));
			}
			if (!table && state.loading) children.push(_jsx("div", { className: "dshp-note", children: "加载中…" }, "loading"));
			if (!table && state.error) children.push(_jsx("div", { className: "dshp-error", children: `获取失败：${state.error}` }, "error"));
			if (table && state.error) children.push(_jsx("div", { className: "dshp-error", children: `刷新失败（显示上次数据）：${state.error}` }, "error"));
			children.push(_jsx("div", { className: "dshp-foot", children: [
				_jsx("button", {
					type: "button",
					className: "dshp-refresh",
					disabled: state.loading,
					onClick: () => load(true),
					children: state.loading ? "刷新中…" : "↻ 刷新"
				}, "refresh"),
				_jsx("span", { children: "每 1 小时自动更新" }, "auto"),
				_jsx("a", { className: "dshp-link", href: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/", target: "_blank", rel: "noopener noreferrer", children: "数据源 ↗" }, "link")
			] }, "foot"));
			return _jsx("div", { className: "dshp-content", children: children });
		}

		/**
		 * Compact pricing badge shown in the session header's tab row.
		 * Rendered as a <span role="button"> because it lives inside the
		 * tab <button>; clicks stop propagation so the view never switches.
		 * @param sessions - the client `sessions` service.
		 */
		function PricingBadge({ sessions, modelDirectories }) {
			const [state, load] = usePricing();
			const sessionId = useCurrentSessionId(sessions);
			const currentModel = useCurrentModel(modelDirectories, sessions, sessionId);
			const [open, setOpen] = React.useState(false);
			const [popoverPos, setPopoverPos] = React.useState(null);
			const badgeRef = React.useRef(null);
			React.useEffect(() => { installStyles(); }, []);

			const payload = state.payload;
			const table = payload && payload.data ? payload.data : null;
			const period = table ? currentPeriod(table.peakWindows) : null;

			let modelId = null;
			if (table) {
				if (currentModel && table.models[currentModel]) modelId = currentModel;
				else if (table.models["deepseek-v4-flash"]) modelId = "deepseek-v4-flash";
			}
			const model = modelId && table ? table.models[modelId] : null;
			const inputPrice = model && period ? model.cacheMiss[period] : null;
			const outputPrice = model && period ? model.output[period] : null;
			const label = modelId ? modelId.replace(/^deepseek-v4-/, "") : null;
			const periodLabel = period === "peak" ? "高峰" : period === "offPeak" ? "空闲" : null;

			const badgeChildren = [];
			badgeChildren.push(_jsx("span", { className: "dshp-badge__dot" }, "dot"));
			if (label) badgeChildren.push(_jsx("span", { className: "dshp-badge__model", children: label  }, "model"));
			badgeChildren.push(inputPrice !== null && outputPrice !== null
				? _jsx("span", { className: "dshp-badge__price", children: `${formatPrice(inputPrice)}/${formatPrice(outputPrice)}` }, "price")
				: _jsx("span", { className: "dshp-badge__price", children: "定价"  }, "price"));
			if (periodLabel) badgeChildren.push(_jsx("span", { className: "dshp-badge__period", children: `· ${periodLabel}` }, "period"));

			return _jsx("span", {
				className: "dshp-badge" + (period === "peak" ? " dshp-badge--peak" : ""),
				role: "button",
				tabIndex: 0,
				title: "DeepSeek 定价（点击查看完整表格）",
				"aria-label": "DeepSeek 定价",
				ref: badgeRef,
				onClick: (event) => {
					event.stopPropagation();
					setOpen((v) => {
						if (!v && badgeRef.current) {
							const r = badgeRef.current.getBoundingClientRect();
							const width = Math.min(400, window.innerWidth - 16);
							setPopoverPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width });
						}
						return !v;
					});
				},
				onKeyDown: (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						event.stopPropagation();
						setOpen((v) => {
							if (!v && badgeRef.current) {
								const r = badgeRef.current.getBoundingClientRect();
								const width = Math.min(400, window.innerWidth - 16);
								setPopoverPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width });
							}
							return !v;
						});
					}
				},
				children: [
					badgeChildren,
					open ? _jsx("span", { className: "dshp-backdrop", onClick: (event) => { event.stopPropagation(); setOpen(false); } }, "backdrop") : null,
					open && popoverPos ? _jsx("span", { className: "dshp-popover", style: { top: popoverPos.top + "px", left: popoverPos.left + "px", width: popoverPos.width + "px", maxHeight: "calc(100vh - " + (popoverPos.top + 16) + "px)" }, onClick: (event) => event.stopPropagation(), children: _jsx(PricingContent, { state, load }) }, "popover") : null
				]
			});
		}

		PricingBadge.displayName = "PricingBadge";

		/* ------------------------------------------------------------ */
		/* Plugin body                                                  */
		/* ------------------------------------------------------------ */

		const inject = ["slots", "sessions"];

		function apply(ctx) {
			try {
				ctx.inject(["slots", "sessions"], (scope) => {
					scope.slots.inject("conversation.session.header.utilities", () => scope.slots.register({
						name: "conversation.session.header.utilities",
						// List slot: stable id required. order -10 sorts before the
						// "Session log" download button (order 0) — the badge lands
						// on the SAME title row, immediately left of Session log.
						id: "dsh-pricing",
						order: -10,
						inject: () => ({
							sessions: scope.sessions,
							modelDirectories: scope.get("modelDirectories")
						})
					}, PricingBadge));
				});
			} catch (error) {
				console.error("[dsh-pricing]", (error && error.message) || error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		// Pure helpers exported for smoke tests.
		exports.currentPeriod = currentPeriod;
		exports.formatPrice = formatPrice;
		exports.formatTime = formatTime;
		exports.PricingBadge = PricingBadge;
		exports.PricingTable = PricingTable;
		return module.exports;
	}
});
