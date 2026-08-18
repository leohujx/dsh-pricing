// dsh-pricing 本地冒烟测试 — 可在任何安装了 DSH Desktop 的机器上运行
// 用法（在 dsh-pricing-dist 目录下）:
//   node test.mjs
// 验证客户端 bundle 可加载、组件可渲染、Host 解析器正确。
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const fallback = join(homedir(), ".dsh", "profiles", "node_modules");
if (!existsSync(join(fallback, "react", "package.json"))) {
	console.error("未找到 DSH 运行时依赖（~/.dsh/profiles/node_modules）。请先启动过一次 DSH Desktop。");
	process.exit(1);
}
const req = createRequire(join(fallback, "react", "package.json"));

let failures = 0;
const check = (name, ok) => {
	console.log((ok ? "  ✓ " : "  ✗ ") + name);
	if (!ok) failures++;
};

console.log("== 1. 客户端 bundle ==");
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (s) => { captured = s; } } };
globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, fetchedAt: Date.now(), ttlMs: 3600000, data: null, diagnostics: {} }) });
// 兼容两种布局：仓库根（lib/）与发布包（dsh-pricing/lib/）
const clientPath = ["lib/client.js", join("dsh-pricing", "lib", "client.js")].find((p) => existsSync(p));
const hostPath = ["lib/index.js", join("dsh-pricing", "lib", "index.js")].find((p) => existsSync(p));
if (!clientPath || !hostPath) {
	console.error("未找到 lib/client.js 或 lib/index.js（请在仓库根或 dsh-pricing-dist 目录下运行）");
	process.exit(1);
}
eval(readFileSync(clientPath, "utf8"));
check("已通过 __ModuleLoader__.load 注册", captured !== null && typeof captured.factory === "function");
const mod = captured.factory((id) => req(id));
check("导出 apply / inject", typeof mod.apply === "function" && Array.isArray(mod.inject));
check("导出组件与工具", typeof mod.PricingBadge === "function" && typeof mod.PricingTable === "function" && typeof mod.currentPeriod === "function");
// 模拟北京时间（UTC+8）验证峰谷判断
const realNow = Date.now;
const setBeijingTime = (hour) => {
	Date.now = () => new Date(Date.UTC(2026, 7, 17, hour - 8)).getTime();
};
const windows = [{ start: 9, end: 12 }, { start: 14, end: 18 }];
setBeijingTime(9.5);
check("时段判断：09:30 北京 = 高峰", mod.currentPeriod(windows) === "peak");
setBeijingTime(13);
check("时段判断：13:00 北京 = 空闲", mod.currentPeriod(windows) === "offPeak");
setBeijingTime(15);
check("时段判断：15:00 北京 = 高峰", mod.currentPeriod(windows) === "peak");
setBeijingTime(7);
check("时段判断：07:00 北京 = 空闲", mod.currentPeriod(windows) === "offPeak");
Date.now = realNow;

const React = req("react");
const { renderToStaticMarkup } = req("react-dom/server");
const warnings = [];
const origErr = console.error;
console.error = (...a) => warnings.push(a.join(" "));
const sessions = {
	list: { getSnapshot: () => ({ current: "s1" }), subscribe: () => () => {} },
	models: () => Promise.resolve({ result: { ok: true, value: { current: { model: "deepseek-v4-flash" } } } })
};
renderToStaticMarkup(React.createElement(mod.PricingBadge, { sessions }));
const table = {
	modelOrder: ["deepseek-v4-flash", "deepseek-v4-pro"],
	models: {
		"deepseek-v4-flash": { name: "DeepSeek-V4-Flash-0731", cacheHit: { offPeak: 0.05, peak: 0.1 }, cacheMiss: { offPeak: 1.5, peak: 3 }, output: { offPeak: 4.5, peak: 9 }, concurrency: 2500 },
		"deepseek-v4-pro": { name: "DeepSeek-V4-Pro-0813", cacheHit: { offPeak: 0.15, peak: 0.3 }, cacheMiss: { offPeak: 4.5, peak: 9 }, output: { offPeak: 13.5, peak: 27 }, concurrency: 500 }
	},
	peakHoursText: "9:00 - 12:00、14:00 - 18:00",
	peakWindows: [{ start: 9, end: 12 }, { start: 14, end: 18 }],
	contextWindow: "1M",
	maxOutputTokens: "最大 384K"
};
const html = renderToStaticMarkup(React.createElement(mod.PricingTable, { table, period: "peak" }));
console.error = origErr;
check("定价表 SSR 渲染（含高峰高亮）", html.includes("dshp-now") && html.includes("27"));
check("渲染无 React 警告", warnings.length === 0);

console.log("== 2. Host 解析器 ==");
const host = await import(join(process.cwd(), hostPath));
check("导出 apply / parsePricing", typeof host.apply === "function" && typeof host.parsePricing === "function");
const SAMPLE_HTML = `<div style="font-size:14px"><b><table style="text-align:center">
<tr><td colspan="3">模型</td><td>deepseek-v4-flash</td><td>deepseek-v4-pro</td></tr>
<tr><td colspan="3">模型版本</td><td>DeepSeek-V4-Flash-0731</td><td>DeepSeek-V4-Pro-0813</td></tr>
<tr><td colspan="3">上下文长度</td><td colspan="2">1M</td></tr>
<tr><td colspan="3">输出长度</td><td colspan="2">最大 384K</td></tr>
<tr><td rowspan="6">价格<sup>(1)</sup></td><td rowspan="2">百万tokens输入（缓存命中）</td><td>空闲时段</td><td>0.05元</td><td>0.15元</td></tr>
<tr><td>高峰时段</td><td>0.10元</td><td>0.30元</td></tr>
<tr><td rowspan="2">百万tokens输入（缓存未命中）</td><td>空闲时段</td><td>1.5元</td><td>4.5元</td></tr>
<tr><td>高峰时段</td><td>3.0元</td><td>9.0元</td></tr>
<tr><td rowspan="2">百万tokens输出</td><td>空闲时段</td><td>4.5元</td><td>13.5元</td></tr>
<tr><td>高峰时段</td><td>9.0元</td><td>27.0元</td></tr>
<tr><td colspan="3">并发限制<sup>(2)</sup></td><td>2500</td><td>500</td></tr>
</table></b></div>
<p>(1) 空闲时段价格为高峰时段价格的一半。高峰时段为北京时间 9:00 - 12:00、14:00 - 18:00（其余为空闲时段）。</p>`;
let parsed;
try {
	parsed = host.parsePricing(SAMPLE_HTML);
} catch (error) {
	parsed = null;
	check("解析器不抛异常", false);
	console.error("  " + String(error && error.message || error));
}
if (parsed) {
	check("解析出 flash / pro", parsed.models["deepseek-v4-flash"] !== undefined && parsed.models["deepseek-v4-pro"] !== undefined);
	check("价格解析正确（Flash 未命中输入 空闲=1.5，Pro 输出 高峰=27）",
		parsed.models["deepseek-v4-flash"].cacheMiss.offPeak === 1.5 && parsed.models["deepseek-v4-pro"].output.peak === 27);
	check("峰谷时段解析", JSON.stringify(parsed.peakWindows) === JSON.stringify([{ start: 9, end: 12 }, { start: 14, end: 18 }]));
	check("元数据解析（1M / 最大 384K / 并发 2500）",
		parsed.contextWindow === "1M" && parsed.maxOutputTokens === "最大 384K" && parsed.models["deepseek-v4-flash"].concurrency === 2500);
}

console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
