"use strict";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 12 * 1000;
const CACHE_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const CACHE_KEY = "global-market-sentiment:v1";
const GREEDY_FEAR_API = "https://www.greedyfear.com";

const MARKET_ITEMS = [
  {
    id: "crypto",
    title: "加密货币",
    subtitle: "Alternative.me 恐慌贪婪指数",
    badge: "₿",
    type: "sentiment",
    endpoint: "https://api.alternative.me/fng/?limit=1&format=json",
    source: "Alternative.me",
  },
  {
    id: "us",
    title: "美国股票",
    subtitle: "CNN 恐慌贪婪指数",
    badge: "US",
    type: "sentiment",
    endpoint: `${GREEDY_FEAR_API}/api/us`,
    source: "CNN / greedyfear.com",
  },
  {
    id: "eu",
    title: "欧洲股票",
    subtitle: "Euro Stoxx 50 30 日波动率（反向）",
    badge: "EU",
    type: "volatility",
    endpoint: `${GREEDY_FEAR_API}/api/vix?region=eu`,
    source: "Yahoo / greedyfear.com",
  },
  {
    id: "in",
    title: "印度股票",
    subtitle: "India VIX（反向）",
    badge: "IN",
    type: "volatility",
    endpoint: `${GREEDY_FEAR_API}/api/vix?region=in`,
    source: "Yahoo / greedyfear.com",
  },
  {
    id: "jp",
    title: "日本股票",
    subtitle: "Nikkei 225 30 日波动率（反向）",
    badge: "JP",
    type: "volatility",
    endpoint: `${GREEDY_FEAR_API}/api/vix?region=jp`,
    source: "Yahoo / greedyfear.com",
  },
  {
    id: "hk",
    title: "香港 / 中国",
    subtitle: "恒生波幅指数 VHSI（反向）",
    badge: "HK",
    type: "volatility",
    endpoint: `${GREEDY_FEAR_API}/api/vix?region=hk`,
    source: "Yahoo / greedyfear.com",
  },
  {
    id: "gold",
    title: "黄金",
    subtitle: "CBOE 黄金波动率 GVZ（反向）",
    badge: "Au",
    type: "volatility",
    endpoint: `${GREEDY_FEAR_API}/api/vix?region=gold`,
    source: "Yahoo / greedyfear.com",
  },
  {
    id: "oil",
    title: "原油",
    subtitle: "CBOE 原油波动率 OVX（反向）",
    badge: "Oil",
    type: "volatility",
    endpoint: `${GREEDY_FEAR_API}/api/vix?region=oil`,
    source: "Yahoo / greedyfear.com",
  },
];

const COMPANY_SYMBOLS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "TSM"];
const COMPANY_NAMES = {
  AAPL: "苹果",
  MSFT: "微软",
  NVDA: "英伟达",
  GOOGL: "谷歌",
  AMZN: "亚马逊",
  META: "Meta",
  TSLA: "特斯拉",
  TSM: "台积电",
};

const COMPANY_ITEMS = COMPANY_SYMBOLS.map((symbol) => ({
  id: `stock-${symbol.toLowerCase()}`,
  title: symbol,
  subtitle: `${COMPANY_NAMES[symbol]} · 52 周价格区间位置`,
  badge: symbol.slice(0, 2),
  type: "stock",
  endpoint: `${GREEDY_FEAR_API}/api/stock?symbol=${encodeURIComponent(symbol)}`,
  source: "Yahoo / greedyfear.com",
}));

const GROUPS = [
  { id: "markets", label: "全球市场情绪", note: "GLOBAL MARKETS", items: MARKET_ITEMS },
  { id: "companies", label: "大型科技公司", note: "MEGA-CAP COMPANIES", items: COMPANY_ITEMS },
];
const ALL_ITEMS = GROUPS.flatMap((group) => group.items);

const state = {
  values: Object.fromEntries(ALL_ITEMS.map((item) => [item.id, null])),
  isRefreshing: false,
  lastSuccessAt: "",
  nextRefreshAt: 0,
};

let refreshTimer = null;
let countdownTimer = null;
let hintTimer = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const scoreToNeedleAngle = (score) => 180 + clamp(score, 0, 100) * 1.8;

const toNumber = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const toScore = (value) => {
  const number = toNumber(value);
  return number !== null && number >= 0 && number <= 100 ? Math.round(number) : null;
};

const toIsoDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

const sentimentLabel = (score) => {
  if (score <= 25) return "极度恐慌";
  if (score <= 45) return "恐慌";
  if (score <= 54) return "中性";
  if (score <= 74) return "贪婪";
  return "极度贪婪";
};

const stockPositionLabel = (score) => {
  if (score <= 25) return "接近 52 周低位";
  if (score <= 45) return "区间偏低";
  if (score <= 54) return "区间中位";
  if (score <= 74) return "区间偏高";
  return "接近 52 周高位";
};

const toneForScore = (score) => {
  if (score <= 25) return "extreme-fear";
  if (score <= 45) return "fear";
  if (score <= 54) return "neutral";
  if (score <= 74) return "greed";
  return "extreme-greed";
};

const fetchJson = async (url) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) throw new Error("返回内容不是 JSON");
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
};

const normalizeCrypto = (payload) => {
  const raw = payload?.data?.[0];
  const score = toScore(raw?.value);
  if (score === null) throw new Error("加密指数数据无效");
  const timestamp = toNumber(raw?.timestamp);
  return {
    score,
    label: sentimentLabel(score),
    detail: "Bitcoin 市场情绪",
    timestamp: timestamp && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : "",
  };
};

const normalizeSentiment = (payload) => {
  const score = toScore(payload?.score);
  if (score === null) throw new Error("情绪指数数据无效");
  const previous = toNumber(payload?.previous?.close);
  return {
    score,
    label: sentimentLabel(score),
    detail: previous === null ? "CNN 综合市场情绪" : `前一交易日 ${Math.round(previous)}`,
    timestamp: toIsoDate(payload?.timestamp),
  };
};

const normalizeVolatility = (payload) => {
  if (payload?.source === "mock") throw new Error("拒绝展示模拟数据");
  const score = toScore(payload?.score);
  const value = toNumber(payload?.value);
  if (score === null || value === null) throw new Error("波动率数据无效");
  return {
    score,
    label: sentimentLabel(score),
    detail: `原始波动率 ${value.toFixed(2)}`,
    timestamp: toIsoDate(payload?.timestamp),
  };
};

const normalizeStock = (payload) => {
  const score = toScore(payload?.score);
  const price = toNumber(payload?.price);
  const change = toNumber(payload?.changePercent);
  const low = toNumber(payload?.low52);
  const high = toNumber(payload?.high52);
  if (score === null || price === null) throw new Error("公司价格数据无效");
  const changeText = change === null ? "" : ` · ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  const rangeText = low === null || high === null ? "" : `$${low.toFixed(0)}–$${high.toFixed(0)}`;
  return {
    score,
    label: stockPositionLabel(score),
    detail: `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}${changeText}`,
    secondaryDetail: rangeText ? `52 周区间 ${rangeText}` : "52 周价格区间",
    timestamp: toIsoDate(payload?.timestamp),
  };
};

const fetchItem = async (item) => {
  const payload = await fetchJson(item.endpoint);
  let normalized;
  if (item.id === "crypto") normalized = normalizeCrypto(payload);
  else if (item.type === "sentiment") normalized = normalizeSentiment(payload);
  else if (item.type === "volatility") normalized = normalizeVolatility(payload);
  else normalized = normalizeStock(payload);
  return {
    ...normalized,
    tone: toneForScore(normalized.score),
    fetchedAt: new Date().toISOString(),
    status: "fresh",
  };
};

const readCache = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const validCachedValue = (value) => {
  if (toScore(value?.score) === null) return false;
  const fetchedAt = new Date(value?.fetchedAt).getTime();
  const age = Date.now() - fetchedAt;
  return Number.isFinite(fetchedAt) && age >= 0 && age <= CACHE_MAX_AGE_MS;
};

const writeCache = () => {
  const values = Object.fromEntries(
    Object.entries(state.values).filter(([, value]) => value && Number.isFinite(value.score)),
  );
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(values));
  } catch {
    // 页面仍可在无本地存储权限时正常使用。
  }
};

const createCard = (item) => {
  const card = document.createElement("article");
  card.className = "sentimentCard is-loading";
  card.dataset.item = item.id;
  card.setAttribute("aria-labelledby", `title-${item.id}`);
  card.innerHTML = `
    <div class="cardHeader">
      <div class="cardIdentity">
        <span class="cardBadge" aria-hidden="true"></span>
        <div>
          <h3 id="title-${item.id}"></h3>
          <p class="cardSubtitle"></p>
        </div>
      </div>
      <span class="freshness">加载中</span>
    </div>
    <div class="gauge" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuetext="正在加载">
      <div class="gaugeRing" aria-hidden="true"></div>
      <div class="gaugeCutout" aria-hidden="true"></div>
      <div class="gaugeNeedle" aria-hidden="true"><span></span></div>
      <span class="gaugeMin" aria-hidden="true">0</span>
      <span class="gaugeMax" aria-hidden="true">100</span>
      <div class="gaugeReading">
        <strong class="score">—</strong>
        <span class="scoreUnit"></span>
      </div>
    </div>
    <div class="cardResult">
      <strong class="classification">等待数据</strong>
      <p class="detail">正在连接数据源</p>
      <p class="secondaryDetail"></p>
    </div>
    <div class="cardFooter">
      <span class="source"></span>
      <time class="dataTime">—</time>
    </div>
  `;
  card.querySelector(".cardBadge").textContent = item.badge;
  card.querySelector("h3").textContent = item.title;
  card.querySelector(".cardSubtitle").textContent = item.subtitle;
  card.querySelector(".scoreUnit").textContent = item.type === "stock" ? "区间分" : "情绪分";
  card.querySelector(".source").textContent = item.source;
  return card;
};

const createSections = () => {
  const sections = document.getElementById("sections");
  const fragment = document.createDocumentFragment();
  GROUPS.forEach((group) => {
    const section = document.createElement("section");
    section.className = "dashboardSection";
    section.setAttribute("aria-labelledby", `group-${group.id}`);
    section.innerHTML = `
      <div class="sectionHeading">
        <div>
          <p class="sectionLabel"></p>
          <h2 id="group-${group.id}"></h2>
        </div>
        <p class="sectionCount"></p>
      </div>
      <div class="cardGrid"></div>
    `;
    section.querySelector(".sectionLabel").textContent = group.note;
    section.querySelector("h2").textContent = group.label;
    section.querySelector(".sectionCount").textContent = `${group.items.length} 项指标`;
    const grid = section.querySelector(".cardGrid");
    group.items.forEach((item) => grid.appendChild(createCard(item)));
    fragment.appendChild(section);
  });
  sections.replaceChildren(fragment);
};

const updateCard = (item) => {
  const value = state.values[item.id];
  const card = document.querySelector(`[data-item="${item.id}"]`);
  if (!card) return;
  const hasValue = Number.isFinite(value?.score);
  const status = value?.status || "loading";
  card.className = `sentimentCard tone-${value?.tone || "neutral"} is-${status}`;

  const statusLabels = {
    loading: "加载中",
    refreshing: "更新中",
    fresh: "实时",
    stale: "缓存",
    error: "不可用",
  };
  card.querySelector(".freshness").textContent = statusLabels[status] || "加载中";

  const gauge = card.querySelector(".gauge");
  const score = hasValue ? clamp(value.score, 0, 100) : 50;
  card.style.setProperty("--score", String(score));
  card.style.setProperty("--needle-angle", `${scoreToNeedleAngle(score)}deg`);
  card.querySelector(".score").textContent = hasValue ? String(score) : "—";
  card.querySelector(".classification").textContent = hasValue
    ? value.label
    : status === "error"
      ? "暂时无法获取"
      : "等待数据";
  card.querySelector(".detail").textContent = hasValue ? value.detail : "数据源暂时无响应";
  card.querySelector(".secondaryDetail").textContent = hasValue
    ? value.secondaryDetail || "0–100 情绪刻度"
    : "稍后将自动重试";

  if (hasValue) {
    gauge.setAttribute("aria-valuenow", String(score));
    gauge.setAttribute("aria-valuetext", `${score}，${value.label}`);
  } else {
    gauge.removeAttribute("aria-valuenow");
    gauge.setAttribute("aria-valuetext", status === "error" ? "数据不可用" : "正在加载");
  }

  const dataTime = card.querySelector(".dataTime");
  if (value?.timestamp) {
    dataTime.textContent = formatDateTime(value.timestamp);
    dataTime.dateTime = value.timestamp;
  } else {
    dataTime.textContent = "—";
    dataTime.removeAttribute("datetime");
  }
};

const renderAllCards = () => ALL_ITEMS.forEach(updateCard);

const showHint = (message, kind = "info", autoHide = false) => {
  const hint = document.getElementById("hint");
  window.clearTimeout(hintTimer);
  hint.textContent = message;
  hint.dataset.kind = kind;
  hint.hidden = false;
  if (autoHide) {
    hintTimer = window.setTimeout(() => {
      hint.hidden = true;
    }, 5000);
  }
};

const hideHint = () => {
  const hint = document.getElementById("hint");
  if (hint) hint.hidden = true;
};

const renderHeader = () => {
  const updatedAt = document.getElementById("updatedAt");
  const nextRefresh = document.getElementById("nextRefresh");
  const refreshButton = document.getElementById("refreshButton");
  updatedAt.textContent = state.lastSuccessAt
    ? `最近更新 ${formatDateTime(state.lastSuccessAt)}`
    : "尚未成功获取数据";

  if (!navigator.onLine) {
    nextRefresh.textContent = "当前离线，已暂停请求";
  } else if (state.isRefreshing) {
    nextRefresh.textContent = "正在同步全球市场数据";
  } else if (state.nextRefreshAt) {
    const seconds = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
    nextRefresh.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} 后自动刷新`;
  } else {
    nextRefresh.textContent = "每 5 分钟自动刷新";
  }

  refreshButton.disabled = state.isRefreshing;
  refreshButton.classList.toggle("isRefreshing", state.isRefreshing);
};

const scheduleRefresh = (delay = REFRESH_INTERVAL_MS) => {
  window.clearTimeout(refreshTimer);
  state.nextRefreshAt = Date.now() + delay;
  refreshTimer = window.setTimeout(() => refreshData(), delay);
  renderHeader();
};

const refreshData = async ({ manual = false } = {}) => {
  if (state.isRefreshing) return;
  if (!navigator.onLine) {
    showHint("当前处于离线状态，正在展示本地缓存。联网后会自动更新。", "warning");
    renderHeader();
    return;
  }

  state.isRefreshing = true;
  window.clearTimeout(refreshTimer);
  state.nextRefreshAt = 0;
  ALL_ITEMS.forEach((item) => {
    const current = state.values[item.id];
    if (current) state.values[item.id] = { ...current, status: "refreshing" };
  });
  renderAllCards();
  renderHeader();
  showHint(manual ? "正在手动刷新全部指标…" : "正在同步全球市场数据…", "loading");

  const cache = readCache();
  const results = await Promise.allSettled(ALL_ITEMS.map((item) => fetchItem(item)));
  let successCount = 0;
  let cacheCount = 0;

  results.forEach((result, index) => {
    const item = ALL_ITEMS[index];
    if (result.status === "fulfilled") {
      state.values[item.id] = result.value;
      successCount += 1;
      return;
    }
    if (validCachedValue(cache[item.id])) {
      state.values[item.id] = { ...cache[item.id], status: "stale" };
      cacheCount += 1;
      return;
    }
    state.values[item.id] = {
      score: null,
      label: "暂时无法获取",
      detail: "数据源暂时无响应",
      timestamp: "",
      fetchedAt: "",
      tone: "neutral",
      status: "error",
    };
  });

  state.isRefreshing = false;
  if (successCount > 0) {
    state.lastSuccessAt = new Date().toISOString();
    writeCache();
  }
  renderAllCards();
  renderHeader();
  document.getElementById("sections").setAttribute("aria-busy", "false");

  if (successCount === ALL_ITEMS.length) {
    showHint(`已更新全部 ${successCount} 项指标。`, "success", true);
    scheduleRefresh();
  } else if (successCount > 0) {
    const failedCount = ALL_ITEMS.length - successCount - cacheCount;
    showHint(
      `已更新 ${successCount} 项；${cacheCount ? `${cacheCount} 项使用缓存；` : ""}${failedCount ? `${failedCount} 项暂不可用。` : ""}`,
      "warning",
    );
    scheduleRefresh(RETRY_INTERVAL_MS);
  } else {
    showHint(
      cacheCount > 0 ? `实时数据暂不可用，正在展示 ${cacheCount} 项缓存。` : "数据源暂时不可用，将在 1 分钟后重试。",
      "error",
    );
    scheduleRefresh(RETRY_INTERVAL_MS);
  }
};

const loadCacheImmediately = () => {
  const cache = readCache();
  let cacheCount = 0;
  ALL_ITEMS.forEach((item) => {
    if (!validCachedValue(cache[item.id])) return;
    state.values[item.id] = { ...cache[item.id], status: "stale" };
    cacheCount += 1;
  });
  if (cacheCount > 0) renderAllCards();
};

const initialize = () => {
  createSections();
  loadCacheImmediately();
  renderAllCards();
  renderHeader();

  document.getElementById("refreshButton").addEventListener("click", () => refreshData({ manual: true }));
  window.addEventListener("online", () => {
    hideHint();
    refreshData();
  });
  window.addEventListener("offline", () => {
    window.clearTimeout(refreshTimer);
    state.nextRefreshAt = 0;
    showHint("网络已断开，当前数据不会继续刷新。", "warning");
    renderHeader();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.clearTimeout(refreshTimer);
      return;
    }
    const elapsed = Date.now() - new Date(state.lastSuccessAt).getTime();
    if (!state.lastSuccessAt || elapsed >= REFRESH_INTERVAL_MS) {
      refreshData();
    } else {
      scheduleRefresh(REFRESH_INTERVAL_MS - elapsed);
    }
  });

  countdownTimer = window.setInterval(renderHeader, 1000);
  window.addEventListener("pagehide", () => window.clearInterval(countdownTimer), { once: true });
  refreshData();
};

initialize();
