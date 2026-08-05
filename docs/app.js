"use strict";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const DIRECT_REQUEST_TIMEOUT_MS = 2 * 1000;
const READER_REQUEST_TIMEOUT_MS = 15 * 1000;
const CACHE_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const CACHE_KEY = "market-fear-greed:v2";
let preferCnnReader = false;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toScore = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
};

const toIsoDate = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const isWithinCacheAge = (item) => {
  if (!Number.isFinite(item?.score)) return false;
  const fetchedAt = new Date(item?.fetchedAt).getTime();
  const age = Date.now() - fetchedAt;
  return Number.isFinite(fetchedAt) && age >= 0 && age <= CACHE_MAX_AGE_MS;
};

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

const formatShortTime = (value) => {
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

const normalizeRating = (value) => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");

const getRating = (value) => {
  const rating = normalizeRating(value);
  const ratings = {
    "extreme fear": { label: "极度恐慌", tone: "extreme-fear" },
    fear: { label: "恐慌", tone: "fear" },
    neutral: { label: "中性", tone: "neutral" },
    greed: { label: "贪婪", tone: "greed" },
    "extreme greed": { label: "极度贪婪", tone: "extreme-greed" },
  };
  return ratings[rating] || { label: "评级暂无", tone: "neutral" };
};

const extractReaderBody = (text) => {
  const marker = "Markdown Content:";
  const markerIndex = text.indexOf(marker);
  return markerIndex === -1 ? text.trim() : text.slice(markerIndex + marker.length).trim();
};

const parseCnnResponse = (text) => {
  const data = JSON.parse(extractReaderBody(text))?.fear_and_greed;
  const score = toScore(data?.score);
  if (score === null) throw new Error("CNN data unavailable");
  return { data, score };
};

const fetchText = async (url, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    window.clearTimeout(timeout);
  }
};

const fetchUsMarket = async () => {
  const date = new Date().toISOString().slice(0, 10);
  const upstreamUrl = `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${date}`;
  const readerUrl = `https://r.jina.ai/http://${upstreamUrl.replace(/^https?:\/\//, "")}`;
  const fetchFromReader = async () =>
    parseCnnResponse(await fetchText(readerUrl, { timeoutMs: READER_REQUEST_TIMEOUT_MS }));
  let parsed;
  if (preferCnnReader) {
    parsed = await fetchFromReader();
  } else {
    try {
      parsed = parseCnnResponse(
        await fetchText(upstreamUrl, { timeoutMs: DIRECT_REQUEST_TIMEOUT_MS }),
      );
    } catch {
      preferCnnReader = true;
      parsed = await fetchFromReader();
    }
  }

  const { data, score } = parsed;

  const rating = getRating(data?.rating);
  return {
    score: Math.round(clamp(score, 0, 100)),
    classification: rating.label,
    tone: rating.tone,
    dataTime: toIsoDate(data?.timestamp),
    fetchedAt: new Date().toISOString(),
  };
};

const fetchCryptoMarket = async () => {
  const payload = JSON.parse(
    await fetchText("https://api.alternative.me/fng/?limit=1&format=json"),
  );
  const data = payload?.data?.[0];
  const score = toScore(data?.value);

  if (score === null) throw new Error("Alternative.me data unavailable");

  const rating = getRating(data?.value_classification);
  const rawTimestamp = data?.timestamp;
  const timestamp =
    rawTimestamp === null || rawTimestamp === undefined || String(rawTimestamp).trim() === ""
      ? null
      : Number(rawTimestamp);
  return {
    score: Math.round(clamp(score, 0, 100)),
    classification: rating.label,
    tone: rating.tone,
    dataTime: Number.isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp * 1000).toISOString()
      : "",
    fetchedAt: new Date().toISOString(),
  };
};

const MARKETS = [
  {
    id: "us",
    scope: "美股 · US",
    name: "美股恐慌贪婪指数",
    badge: "US",
    sourceName: "CNN Fear & Greed Index",
    sourceUrl: "https://edition.cnn.com/markets/fear-and-greed",
    fetcher: fetchUsMarket,
  },
  {
    id: "crypto",
    scope: "加密市场 · CRYPTO",
    name: "加密货币恐慌贪婪指数",
    badge: "₿",
    sourceName: "Alternative.me Crypto Fear & Greed Index",
    sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
    fetcher: fetchCryptoMarket,
  },
];

const ITEMS = Object.fromEntries(
  MARKETS.map((market) => [
    market.id,
    {
      score: null,
      classification: "等待数据",
      tone: "neutral",
      dataTime: "",
      fetchedAt: "",
      status: "loading",
    },
  ]),
);

const STATE = {
  isRefreshing: false,
  lastSuccessAt: null,
  nextRefreshAt: null,
};

const cardRefs = new Map();
let refreshTimer = null;
let hintTimer = null;

const createMarketCard = (market) => {
  const card = document.createElement("article");
  card.className = "marketCard";
  card.dataset.market = market.id;
  card.setAttribute("aria-labelledby", `market-title-${market.id}`);
  card.innerHTML = `
    <div class="cardTop">
      <div class="marketIdentity">
        <span class="marketBadge" aria-hidden="true"></span>
        <div>
          <p class="marketScope"></p>
          <h2 class="marketName" id="market-title-${market.id}"></h2>
        </div>
      </div>
      <span class="freshness freshness-loading"></span>
    </div>
    <div class="reading">
      <div class="scoreGroup">
        <strong class="score">—</strong>
        <span class="scoreScale">/ 100</span>
      </div>
      <div class="verdict">
        <span>来源评级</span>
        <strong class="classification">等待数据</strong>
      </div>
    </div>
    <div class="meterWrap">
      <div
        class="sentimentMeter"
        role="meter"
        aria-labelledby="market-title-${market.id}"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuetext="正在加载"
      >
        <span class="meterMarker" aria-hidden="true"></span>
      </div>
      <div class="meterTicks" aria-hidden="true">
        <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
      </div>
    </div>
    <div class="cardMeta">
      <div class="metaItem">
        <span class="metaLabel">数据时间</span>
        <time class="dataTime">—</time>
      </div>
      <div class="metaItem">
        <span class="metaLabel">数据出处</span>
        <a class="sourceLink" target="_blank" rel="noreferrer"></a>
      </div>
    </div>
  `;

  card.querySelector(".marketBadge").textContent = market.badge;
  card.querySelector(".marketScope").textContent = market.scope;
  card.querySelector(".marketName").textContent = market.name;

  const sourceLink = card.querySelector(".sourceLink");
  sourceLink.href = market.sourceUrl;
  sourceLink.textContent = market.sourceName;
  const externalMark = document.createElement("span");
  externalMark.className = "externalMark";
  externalMark.setAttribute("aria-hidden", "true");
  externalMark.textContent = "↗";
  const newWindowText = document.createElement("span");
  newWindowText.className = "srOnly";
  newWindowText.textContent = "（新窗口打开）";
  sourceLink.append(externalMark, newWindowText);

  cardRefs.set(market.id, {
    card,
    score: card.querySelector(".score"),
    classification: card.querySelector(".classification"),
    meter: card.querySelector(".sentimentMeter"),
    marker: card.querySelector(".meterMarker"),
    freshness: card.querySelector(".freshness"),
    dataTime: card.querySelector(".dataTime"),
  });
  return card;
};

const statusCopy = {
  loading: "正在加载",
  refreshing: "正在更新",
  fresh: "已更新",
  stale: "缓存数据",
  error: "暂不可用",
};

const updateCard = (marketId) => {
  const item = ITEMS[marketId];
  const refs = cardRefs.get(marketId);
  if (!item || !refs) return;

  const hasScore = Number.isFinite(item.score);
  refs.score.textContent = hasScore ? String(item.score) : "—";
  refs.classification.textContent = hasScore
    ? item.classification
    : item.status === "error"
      ? "暂时无法获取"
      : "等待数据";
  refs.classification.className = `classification tone-${item.tone}`;
  refs.freshness.textContent = statusCopy[item.status] || statusCopy.loading;
  refs.freshness.className = `freshness freshness-${item.status}`;
  refs.card.dataset.state = item.status;

  if (hasScore) {
    const score = clamp(item.score, 0, 100);
    refs.meter.style.setProperty("--score", `${score}%`);
    refs.meter.setAttribute("aria-valuenow", String(score));
    refs.meter.setAttribute("aria-valuetext", `${score}，${item.classification}`);
  } else {
    refs.meter.style.setProperty("--score", "0%");
    refs.meter.removeAttribute("aria-valuenow");
    refs.meter.setAttribute(
      "aria-valuetext",
      item.status === "error" ? "数据暂时无法获取" : "正在加载",
    );
  }

  if (item.dataTime) {
    refs.dataTime.textContent = formatDateTime(item.dataTime);
    refs.dataTime.dateTime = item.dataTime;
  } else {
    refs.dataTime.textContent = "—";
    refs.dataTime.removeAttribute("datetime");
  }
};

const renderHeader = () => {
  const updatedAt = document.getElementById("updatedAt");
  const nextRefresh = document.getElementById("nextRefresh");
  if (!updatedAt || !nextRefresh) return;

  updatedAt.textContent = STATE.lastSuccessAt
    ? `最近成功刷新：${formatShortTime(STATE.lastSuccessAt)}`
    : "尚未成功获取数据";

  if (!navigator.onLine) {
    nextRefresh.textContent = "当前离线，联网后自动更新";
  } else if (STATE.nextRefreshAt) {
    nextRefresh.textContent = document.hidden
      ? "返回页面后继续自动刷新"
      : `下次自动刷新：${formatShortTime(STATE.nextRefreshAt)}`;
  } else {
    nextRefresh.textContent = "数据每 5 分钟自动刷新";
  }
};

const setHint = (message, { kind = "info", autoHide = false } = {}) => {
  const hint = document.getElementById("hint");
  if (!hint) return;

  if (hintTimer) window.clearTimeout(hintTimer);
  hintTimer = null;
  hint.textContent = message;
  hint.dataset.kind = kind;
  hint.hidden = !message;

  if (message && autoHide) {
    hintTimer = window.setTimeout(() => {
      hint.textContent = "";
      hint.hidden = true;
    }, 3200);
  }
};

const loadCache = () => {
  try {
    const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null");
    let loaded = 0;
    let newestFetchedAt = 0;
    for (const market of MARKETS) {
      const item = cached?.items?.[market.id];
      const score = toScore(item?.score);
      const fetchedAt = new Date(item?.fetchedAt).getTime();
      if (
        score === null ||
        !Number.isFinite(fetchedAt) ||
        Date.now() - fetchedAt < 0 ||
        Date.now() - fetchedAt > CACHE_MAX_AGE_MS
      ) {
        continue;
      }

      ITEMS[market.id] = {
        ...ITEMS[market.id],
        score: Math.round(clamp(score, 0, 100)),
        classification: String(item.classification || "评级暂无"),
        tone: String(item.tone || "neutral"),
        dataTime: String(item.dataTime || ""),
        fetchedAt: String(item.fetchedAt || ""),
        status: "stale",
      };
      loaded += 1;
      newestFetchedAt = Math.max(newestFetchedAt, fetchedAt);
    }

    if (loaded > 0) STATE.lastSuccessAt = new Date(newestFetchedAt).toISOString();
    return loaded;
  } catch {
    return 0;
  }
};

const saveCache = () => {
  const items = {};
  for (const market of MARKETS) {
    const item = ITEMS[market.id];
    if (!isWithinCacheAge(item)) continue;
    items[market.id] = {
      score: item.score,
      classification: item.classification,
      tone: item.tone,
      dataTime: item.dataTime,
      fetchedAt: item.fetchedAt,
    };
  }

  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ version: 2, savedAt: STATE.lastSuccessAt, items }),
    );
  } catch {
    // Storage can be unavailable in private browsing; live data still works.
  }
};

const markMarketUnavailable = (marketId) => {
  const item = ITEMS[marketId];
  if (isWithinCacheAge(item)) {
    item.status = "stale";
  } else {
    ITEMS[marketId] = {
      ...item,
      score: null,
      classification: "等待数据",
      tone: "neutral",
      dataTime: "",
      fetchedAt: "",
      status: "error",
    };
  }
  updateCard(marketId);
};

const armRefreshTimer = () => {
  if (refreshTimer) window.clearTimeout(refreshTimer);
  refreshTimer = null;
  renderHeader();

  if (document.hidden || !navigator.onLine || !STATE.nextRefreshAt) return;
  const delay = Math.max(0, new Date(STATE.nextRefreshAt).getTime() - Date.now());
  refreshTimer = window.setTimeout(() => refreshAll(), delay);
};

const scheduleRefresh = (delay) => {
  STATE.nextRefreshAt = new Date(Date.now() + delay).toISOString();
  armRefreshTimer();
};

const setRefreshingUi = (isRefreshing) => {
  const grid = document.getElementById("grid");
  const button = document.getElementById("refreshButton");
  grid?.setAttribute("aria-busy", String(isRefreshing));

  if (button) {
    button.disabled = isRefreshing;
    button.classList.toggle("isRefreshing", isRefreshing);
    button.setAttribute("aria-label", isRefreshing ? "正在刷新数据" : "立即刷新数据");
  }
};

const refreshAll = async ({ manual = false } = {}) => {
  if (STATE.isRefreshing) return;

  if (!navigator.onLine) {
    for (const market of MARKETS) markMarketUnavailable(market.id);
    setRefreshingUi(false);
    setHint("当前离线，正在显示最近保存的数据；联网后会自动更新。", { kind: "warning" });
    scheduleRefresh(RETRY_INTERVAL_MS);
    return;
  }

  STATE.isRefreshing = true;
  setRefreshingUi(true);
  setHint(manual ? "正在手动刷新两个市场的数据…" : "正在获取最新市场情绪…", {
    kind: "loading",
  });

  for (const market of MARKETS) {
    ITEMS[market.id].status = Number.isFinite(ITEMS[market.id].score) ? "refreshing" : "loading";
    updateCard(market.id);
  }

  let successCount = 0;
  try {
    const results = await Promise.all(
      MARKETS.map(async (market) => {
        try {
          const result = await market.fetcher();
          ITEMS[market.id] = { ...ITEMS[market.id], ...result, status: "fresh" };
          successCount += 1;
          updateCard(market.id);
          return true;
        } catch {
          markMarketUnavailable(market.id);
          return false;
        }
      }),
    );

    if (successCount > 0) {
      STATE.lastSuccessAt = new Date().toISOString();
      saveCache();
    }

    if (results.every(Boolean)) {
      setHint("美股与加密数据均已更新。", { kind: "success", autoHide: true });
    } else if (successCount > 0) {
      const failedWithCache = results.some(
        (success, index) => !success && Number.isFinite(ITEMS[MARKETS[index].id].score),
      );
      setHint(
        failedWithCache
          ? "部分数据更新失败，未更新的卡片继续显示缓存数据。"
          : "部分数据更新失败，请查看卡片状态；稍后会自动重试。",
        { kind: "warning" },
      );
    } else {
      setHint("暂时无法连接数据源，稍后会自动重试。", { kind: "error" });
    }
  } finally {
    STATE.isRefreshing = false;
    setRefreshingUi(false);
    renderHeader();
    scheduleRefresh(successCount > 0 ? REFRESH_INTERVAL_MS : RETRY_INTERVAL_MS);
  }
};

const initialize = () => {
  const grid = document.getElementById("grid");
  const refreshButton = document.getElementById("refreshButton");
  if (!grid || !refreshButton) return;

  grid.replaceChildren(...MARKETS.map(createMarketCard));
  const cachedCount = loadCache();
  for (const market of MARKETS) updateCard(market.id);
  renderHeader();

  if (cachedCount > 0) {
    setHint("已先显示最近保存的数据，正在检查更新…", { kind: "loading" });
  }

  refreshButton.addEventListener("click", () => refreshAll({ manual: true }));

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = null;
      renderHeader();
      return;
    }

    const refreshAt = new Date(STATE.nextRefreshAt || 0).getTime();
    if (!refreshAt || Date.now() >= refreshAt) refreshAll();
    else armRefreshTimer();
  });

  window.addEventListener("offline", () => {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = null;
    renderHeader();
    setHint("当前离线，正在显示最近保存的数据；联网后会自动更新。", { kind: "warning" });
  });

  window.addEventListener("online", () => {
    renderHeader();
    refreshAll();
  });

  refreshAll();
};

initialize();
