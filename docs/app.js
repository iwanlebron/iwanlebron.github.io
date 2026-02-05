const LANG_PACK = {
  zh: {
    app: {
      title: "恐慌贪婪指数",
      subtitle: "展示：美股、港股、A股、加密货币",
      listAria: "指数列表",
      legendAria: "分段说明",
      lastRefresh: "最后刷新：{time}",
    },
    legend: {
      intro:
        "数值范围为 0–100：越低代表越恐慌，越高代表越贪婪。加密货币使用 Alternative.me 数据，美股使用 CNN Fear & Greed 数据；A股与港股为基于指数价格计算的情绪分数（0–100）。",
    },
    bucket: {
      extremeFear: "极度恐慌",
      fear: "恐慌",
      neutral: "中性",
      greed: "贪婪",
      extremeGreed: "极度贪婪",
    },
    common: {
      dash: "—",
      loading: "加载中",
      unknown: "未知",
      biasFear: "偏恐慌",
      biasGreed: "偏贪婪",
      scoreSuffix: "/ 100",
      originalRating: "原始评级：{label}",
      dataTime: "数据时间：{time}",
    },
    source: {
      cnn: "来源：CNN (via dataviz)",
      alternative: "来源：Alternative.me",
      stooqComputed: "来源：Stooq（基于指数价格计算）",
    },
    lang: {
      toggleToEn: "EN",
      toggleToZh: "中",
    },
  },
  en: {
    app: {
      title: "Fear & Greed Index",
      subtitle: "Markets: US, HK, CN, Crypto",
      listAria: "Index list",
      legendAria: "Legend",
      lastRefresh: "Last refresh: {time}",
    },
    legend: {
      intro:
        "Range 0–100: lower means more fear, higher means more greed. Crypto uses Alternative.me; US uses CNN Fear & Greed; CN/HK are computed scores based on index prices (0–100).",
    },
    bucket: {
      extremeFear: "Extreme Fear",
      fear: "Fear",
      neutral: "Neutral",
      greed: "Greed",
      extremeGreed: "Extreme Greed",
    },
    common: {
      dash: "—",
      loading: "Loading",
      unknown: "Unknown",
      biasFear: "Fear-leaning",
      biasGreed: "Greed-leaning",
      scoreSuffix: "/ 100",
      originalRating: "Raw rating: {label}",
      dataTime: "Data time: {time}",
    },
    source: {
      cnn: "Source: CNN (via dataviz)",
      alternative: "Source: Alternative.me",
      stooqComputed: "Source: Stooq (computed from index prices)",
    },
    lang: {
      toggleToEn: "EN",
      toggleToZh: "中",
    },
  },
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const getQueryParam = (name) => {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
};

const getInitialLang = () => {
  const q = String(getQueryParam("lang") || "").toLowerCase();
  if (q === "zh" || q === "zh-cn" || q === "zh-hans") return "zh";
  if (q === "en") return "en";
  const saved = String(localStorage.getItem("lang") || "").toLowerCase();
  if (saved === "zh" || saved === "en") return saved;
  const nav = String(navigator.language || "").toLowerCase();
  return nav.startsWith("zh") ? "zh" : "en";
};

const format = (template, params) =>
  String(template).replace(/\{(\w+)\}/g, (_, k) => (params?.[k] ?? `{${k}}`));

const t = (key, params) => {
  const lang = STATE.lang;
  const pack = LANG_PACK[lang] || LANG_PACK.zh;
  const parts = String(key).split(".");
  let cur = pack;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return key;
  }
  return typeof cur === "string" ? format(cur, params) : key;
};

const BUCKETS = [
  { max: 20, key: "extremeFear", color: "danger" },
  { max: 40, key: "fear", color: "warning" },
  { max: 60, key: "neutral", color: "neutral" },
  { max: 80, key: "greed", color: "good" },
  { max: 100, key: "extremeGreed", color: "great" },
];

const getBucketByScore = (score) => BUCKETS.find((b) => score <= b.max) || BUCKETS[2];

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

const formatUpdatedAt = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t("common.dash");
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
};

const translateAltClassificationKey = (s) => {
  const v = String(s || "").toLowerCase();
  if (v.includes("extreme fear")) return "extremeFear";
  if (v === "fear") return "fear";
  if (v === "neutral") return "neutral";
  if (v === "greed") return "greed";
  if (v.includes("extreme greed")) return "extremeGreed";
  return null;
};

const translateCnnRatingKey = (s) => {
  const v = String(s || "").toLowerCase();
  if (v === "extreme fear") return "extremeFear";
  if (v === "fear") return "fear";
  if (v === "neutral") return "neutral";
  if (v === "greed") return "greed";
  if (v === "extreme greed") return "extremeGreed";
  return null;
};

const applyI18n = () => {
  document.documentElement.setAttribute("lang", STATE.lang === "zh" ? "zh-CN" : "en");

  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n"));
  }

  for (const el of document.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  }

  const titleEl = document.querySelector("title[data-i18n]");
  if (titleEl) document.title = t(titleEl.getAttribute("data-i18n"));

  const btn = document.getElementById("langToggle");
  if (btn) btn.textContent = STATE.lang === "zh" ? t("lang.toggleToEn") : t("lang.toggleToZh");
};

const setLang = (lang) => {
  STATE.lang = lang === "en" ? "en" : "zh";
  localStorage.setItem("lang", STATE.lang);
  applyI18n();
  render();
};

const renderCard = (item) => {
  const scoreValue = item.score;
  const score = Number.isFinite(scoreValue) ? clamp(Number(scoreValue), 0, 100) : null;
  const bucket = score === null ? null : getBucketByScore(score);
  const labelId = `label-${item.id}`;
  const srId = `sr-${item.id}`;
  const name = t(item.nameKey);
  const bucketLabel = item.classificationKey ? t(`bucket.${item.classificationKey}`) : t("common.dash");
  const bucketColor = bucket ? bucket.color : "neutral";
  const bias = score === null ? t("common.loading") : score <= 50 ? t("common.biasFear") : t("common.biasGreed");
  const srText =
    score === null
      ? `${name} ${t("common.unknown")}`
      : `${name} ${score} ${t("common.scoreSuffix")} ${bucketLabel}`;

  const sourceText = item.sourceKey ? t(item.sourceKey) : "";
  const rawRatingText = item.originalRatingKey
    ? t("common.originalRating", { label: t(`bucket.${item.originalRatingKey}`) })
    : "";
  const metaLeft = [sourceText, rawRatingText].filter(Boolean).join(" · ");
  const metaRight = item.dataTime ? t("common.dataTime", { time: item.dataTime }) : "";

  const el = document.createElement("section");
  el.className = "card";
  el.setAttribute("aria-labelledby", labelId);
  el.innerHTML = `
    <div class="cardHeader">
      <h2 class="name" id="${labelId}">${name}</h2>
      <div class="marketTag">${item.tag ?? ""}</div>
    </div>
    <div class="valueRow">
      <div class="value">
        <div class="score">${score === null ? t("common.dash") : score}</div>
        <div class="scale">${t("common.scoreSuffix")}</div>
      </div>
      <div class="label">
        <strong class="bucket bucket-${bucketColor}">${bucketLabel}</strong>
        <div>${bias}</div>
      </div>
    </div>
    <div class="barWrap" role="group" aria-label="0 to 100">
      <div class="bar" aria-hidden="true">
        <div class="fill" style="width: ${score === null ? 0 : score}%;"></div>
      </div>
      <div class="ticks" aria-hidden="true">
        <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
      </div>
      <div class="srOnly" id="${srId}">${srText}</div>
    </div>
    <div class="meta">
      <span>${metaLeft}</span>
      <span>${metaRight}</span>
    </div>
  `;
  return el;
};

const DEFAULT_ITEMS = [
  { id: "us", nameKey: "market.us", tag: "US" },
  { id: "hk", nameKey: "market.hk", tag: "HK" },
  { id: "cn", nameKey: "market.cn", tag: "CN" },
  { id: "crypto", nameKey: "market.crypto", tag: "Crypto" },
];

LANG_PACK.zh.market = {
  us: "美股恐慌贪婪指数",
  hk: "港股恐慌贪婪指数",
  cn: "A股恐慌贪婪指数",
  crypto: "加密货币恐慌贪婪指数",
};

LANG_PACK.en.market = {
  us: "US Fear & Greed Index",
  hk: "HK Fear & Greed Index",
  cn: "CN Fear & Greed Index",
  crypto: "Crypto Fear & Greed Index",
};

const STATE = {
  lang: getInitialLang(),
  refreshedAt: null,
  items: DEFAULT_ITEMS.map((x) => ({
    ...x,
    score: null,
    classificationKey: null,
    originalRatingKey: null,
    sourceKey: null,
    dataTime: "",
  })),
};

const render = () => {
  const grid = document.getElementById("grid");
  const updatedAt = document.getElementById("updatedAt");
  if (!grid || !updatedAt) return;

  const time = STATE.refreshedAt ? formatUpdatedAt(STATE.refreshedAt) : t("common.dash");
  updatedAt.textContent = t("app.lastRefresh", { time });
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
    classificationKey: d ? translateAltClassificationKey(d.value_classification) : null,
    originalRatingKey: null,
    sourceKey: "source.alternative",
    dataTime: ts ? formatUpdatedAt(new Date(ts * 1000).toISOString()) : "",
  };
};

const fetchUsCnn = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${today}`;
  const text = await fetchText(toProxyUrl(url));
  const json = JSON.parse(extractProxyBody(text));
  const fg = json?.fear_and_greed;
  const rawScore = fg ? Number(fg.score) : null;
  const date = fg?.timestamp ? String(fg.timestamp) : today;
  const roundedScore = Number.isFinite(rawScore) ? Math.round(rawScore) : null;
  const bucket = roundedScore === null ? null : getBucketByScore(roundedScore);
  return {
    id: "us",
    score: roundedScore,
    classificationKey: bucket ? bucket.key : null,
    originalRatingKey: fg ? translateCnnRatingKey(fg.rating) : null,
    sourceKey: "source.cnn",
    dataTime: date,
  };
};

const fetchSentimentFromStooq = async ({ symbol }) => {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const csv = await fetchTextWithProxyFallback(url);
  const rows = parseCsv(csv);
  if (rows.length < 60) {
    return { score: null, classificationKey: null, dataTime: "" };
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
  const bucket = score === null ? null : getBucketByScore(score);

  return {
    score,
    classificationKey: bucket ? bucket.key : null,
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
      const r = await fetchSentimentFromStooq({ symbol: "^shc" });
      return { id: "cn", ...r, originalRatingKey: null, sourceKey: "source.stooqComputed" };
    })(),
    (async () => {
      const r = await fetchSentimentFromStooq({ symbol: "^hsi" });
      return { id: "hk", ...r, originalRatingKey: null, sourceKey: "source.stooqComputed" };
    })(),
  ];

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "fulfilled") setItem(r.value.id, r.value);
  }
};

const bindLangToggle = () => {
  const btn = document.getElementById("langToggle");
  if (!btn) return;
  btn.addEventListener("click", () => setLang(STATE.lang === "zh" ? "en" : "zh"));
};

applyI18n();
bindLangToggle();
render();
refreshAll();
setInterval(refreshAll, 5 * 60 * 1000);
