const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const toProxyUrl = (url) => `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;

const extractProxyBody = (text) => {
  const marker = "Markdown Content:";
  const idx = text.indexOf(marker);
  if (idx === -1) return text.trim();
  return text.slice(idx + marker.length).trim();
};

const fetchText = async (url) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

const fetchTextWithProxyFallback = async (url) => {
  try {
    return await fetchText(url);
  } catch {
    const text = await fetchText(toProxyUrl(url));
    return extractProxyBody(text);
  }
};

const parseCsv = (csv) => {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const closeIdx = header.indexOf("Close");
  const dateIdx = header.indexOf("Date");
  if (closeIdx === -1 || dateIdx === -1) return [];
  return lines
      .slice(1)
      .map((line) => line.split(","))
      .map((cols) => ({
        date: cols[dateIdx],
        close: Number(cols[closeIdx]),
      }))
      .filter((row) => row.date && Number.isFinite(row.close));
};

const stddev = (arr) => {
  if (!arr.length) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const v = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(v);
};

const percentileRank = (values, x) => {
  if (!values.length) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sorted.length) * 100;
};

const computeRsi14 = (closes) => {
  if (closes.length < 15) return null;
  const diffs = [];
  for (let i = 1; i < closes.length; i++) diffs.push(closes[i] - closes[i - 1]);
  const gains = diffs.map((d) => (d > 0 ? d : 0));
  const losses = diffs.map((d) => (d < 0 ? -d : 0));

  let avgGain = gains.slice(0, 14).reduce((s, x) => s + x, 0) / 14;
  let avgLoss = losses.slice(0, 14).reduce((s, x) => s + x, 0) / 14;

  for (let i = 14; i < gains.length; i++) {
    avgGain = (avgGain * 13 + gains[i]) / 14;
    avgLoss = (avgLoss * 13 + losses[i]) / 14;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

const getBucket = (score) => {
  if (score <= 20) return { key: "danger", label: "极度恐慌" };
  if (score <= 40) return { key: "warning", label: "恐慌" };
  if (score <= 60) return { key: "neutral", label: "中性" };
  if (score <= 80) return { key: "good", label: "贪婪" };
  return { key: "great", label: "极度贪婪" };
};

const formatUpdatedAt = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
};

const translateAltClassification = (s) => {
  const v = String(s || "").toLowerCase();
  if (v.includes("extreme fear")) return "极度恐慌";
  if (v === "fear") return "恐慌";
  if (v === "neutral") return "中性";
  if (v === "greed") return "贪婪";
  if (v.includes("extreme greed")) return "极度贪婪";
  return "—";
};

const translateCnnRating = (s) => {
  const v = String(s || "").toLowerCase();
  if (v === "extreme fear") return "极度恐慌";
  if (v === "fear") return "恐慌";
  if (v === "neutral") return "中性";
  if (v === "greed") return "贪婪";
  if (v === "extreme greed") return "极度贪婪";
  return "—";
};

const renderCard = (item) => {
  const scoreValue = item.score;
  const score = Number.isFinite(scoreValue) ? clamp(Number(scoreValue), 0, 100) : null;
  const bucket = score === null ? { key: "neutral", label: "—" } : getBucket(score);
  const labelId = `label-${item.id}`;
  const srId = `sr-${item.id}`;

  const el = document.createElement("section");
  el.className = "card";
  el.setAttribute("aria-labelledby", labelId);
  el.innerHTML = `
    <div class="cardHeader">
      <h2 class="name" id="${labelId}">${item.name}</h2>
      <div class="marketTag">${item.tag ?? ""}</div>
    </div>
    <div class="valueRow">
      <div class="value">
        <div class="score">${score === null ? "—" : score}</div>
        <div class="scale">/ 100</div>
      </div>
      <div class="label">
        <strong class="bucket bucket-${bucket.key}">${item.classification ?? bucket.label}</strong>
        <div>${score === null ? "加载中" : score <= 50 ? "偏恐慌" : "偏贪婪"}</div>
      </div>
    </div>
    <div class="barWrap" role="group" aria-label="0 到 100 进度">
      <div class="bar" aria-hidden="true">
        <div class="fill" style="width: ${score === null ? 0 : score}%;"></div>
      </div>
      <div class="ticks" aria-hidden="true">
        <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
      </div>
      <div class="srOnly" id="${srId}">
        当前数值 ${score === null ? "未知" : score}，属于 ${item.classification ?? bucket.label}
      </div>
    </div>
    <div class="meta">
      <span>${item.source ?? ""}</span>
      <span>${item.dataTime ? `数据时间：${item.dataTime}` : ""}</span>
    </div>
  `;
  return el;
};

const DEFAULT_ITEMS = [
  { id: "us", name: "美股恐慌贪婪指数", tag: "US" },
  { id: "hk", name: "港股恐慌贪婪指数", tag: "HK" },
  { id: "cn", name: "A股恐慌贪婪指数", tag: "CN" },
  { id: "crypto", name: "加密货币恐慌贪婪指数", tag: "Crypto" },
];

const STATE = {
  refreshedAt: null,
  items: DEFAULT_ITEMS.map((x) => ({
    ...x,
    score: null,
    classification: null,
    source: "加载中…",
    dataTime: "",
  })),
};

const render = () => {
  const grid = document.getElementById("grid");
  const updatedAt = document.getElementById("updatedAt");
  if (!grid || !updatedAt) return;

  updatedAt.textContent = `最后刷新：${STATE.refreshedAt ? formatUpdatedAt(STATE.refreshedAt) : "—"}`;
  grid.replaceChildren(...STATE.items.map(renderCard));
};

const setItem = (id, patch) => {
  STATE.items = STATE.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
  render();
};

const fetchCrypto = async () => {
  const url = "https://api.alternative.me/fng/?limit=1&format=json";
  const json = JSON.parse(await fetchTextWithProxyFallback(url));
  const d = json?.data?.[0];
  const score = d ? Number(d.value) : null;
  const ts = d ? Number(d.timestamp) : null;
  return {
    id: "crypto",
    score: Number.isFinite(score) ? score : null,
    classification: d ? translateAltClassification(d.value_classification) : "—",
    source: "来源：Alternative.me",
    dataTime: ts ? formatUpdatedAt(new Date(ts * 1000).toISOString()) : "",
  };
};

const fetchUsCnn = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${today}`;
  const text = await fetchText(toProxyUrl(url));
  const json = JSON.parse(extractProxyBody(text));
  const fg = json?.fear_and_greed;
  const score = fg ? Number(fg.score) : null;
  const date = fg?.timestamp ? String(fg.timestamp) : today;
  const roundedScore = Number.isFinite(score) ? Math.round(score) : null;
  const bucketLabel = roundedScore === null ? "—" : getBucket(roundedScore).label;
  const rawLabel = fg ? translateCnnRating(fg.rating) : "—";
  return {
    id: "us",
    score: roundedScore,
    classification: bucketLabel,
    source: `来源：CNN (via dataviz)；原始评级：${rawLabel}`,
    dataTime: date,
  };
};

const fetchSentimentFromStooq = async ({ symbol, sourceLabel }) => {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const csv = await fetchTextWithProxyFallback(url);
  const rows = parseCsv(csv);
  if (rows.length < 60) {
    return { score: null, classification: "—", dataTime: "", source: sourceLabel };
  }

  const tail = rows.slice(-600);
  const closes = tail.map((r) => r.close);
  const lastDate = tail[tail.length - 1].date;

  const rsi = computeRsi14(closes);
  const rets = [];
  for (let i = 1; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }

  const window = 20;
  const volSeries = [];
  for (let i = window; i <= rets.length; i++) {
    const slice = rets.slice(i - window, i);
    const vol = stddev(slice) * Math.sqrt(252);
    volSeries.push(vol);
  }

  const currentVol = volSeries.length ? volSeries[volSeries.length - 1] : 0;
  const historyVol = volSeries.slice(-252);
  const volPct = percentileRank(historyVol, currentVol);
  const volScore = 100 - volPct;

  const score =
      rsi === null ? null : clamp(Math.round(0.7 * rsi + 0.3 * volScore), 0, 100);

  const bucket = score === null ? { label: "—" } : getBucket(score);
  return {
    score,
    classification: bucket.label,
    source: sourceLabel,
    dataTime: lastDate,
  };
};

const refreshAll = async () => {
  STATE.refreshedAt = new Date().toISOString();
  render();

  const tasks = [
    fetchUsCnn(),
    fetchCrypto(),
    (async () => {
      const r = await fetchSentimentFromStooq({
        symbol: "^shc",
        sourceLabel: "来源：Stooq（基于指数价格计算）",
      });
      return { id: "cn", ...r };
    })(),
    (async () => {
      const r = await fetchSentimentFromStooq({
        symbol: "^hsi",
        sourceLabel: "来源：Stooq（基于指数价格计算）",
      });
      return { id: "hk", ...r };
    })(),
  ];

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "fulfilled") {
      setItem(r.value.id, r.value);
      continue;
    }
  }
};

render();
refreshAll();
setInterval(refreshAll, 5 * 60 * 1000);
