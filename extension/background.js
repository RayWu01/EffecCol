importScripts("shared.js");

const {
  AI_FALLBACK_SUMMARY,
  DEFAULT_LOCAL_SETTINGS,
  DEFAULT_SYNC_SETTINGS,
  basenameFromPath,
  buildAssetFolderPath,
  buildAiRequestBody,
  buildBoardCardHtml,
  buildBoardCardText,
  buildCaptureId,
  buildNoteContent,
  buildNotePath,
  extractModelText,
  getProviderPreset,
  normalizeSettings,
  normalizeMultilineText,
  resolveAiProvider,
  resolveAiEndpoint
} = self.CaptureShared;

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const STATUS_PAGE_PATH = "popup.html";
const STATUS_PAGE_MATCH_PATTERN = `${chrome.runtime.getURL(STATUS_PAGE_PATH)}*`;
const STATUS_STORAGE_KEY = "latestStatusContext";
const LOCAL_PLUGIN_URL = "http://127.0.0.1:27124";
const LOCAL_PLUGIN_ORIGIN = new URL(LOCAL_PLUGIN_URL).origin;
const BRIDGE_AUTH_HEADER = "Authorization";
const BRIDGE_CLIENT_HEADER = "X-EffecCol-Client";
const BRIDGE_CLIENT_NAME = "extension";

initializeStatusContext().catch((error) => {
  console.warn("Failed to initialize status context", error);
});

chrome.action.onClicked.addListener(async (tab) => {
  await handleCapture(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "effecol:get-status-context") {
    sendResponse({ context: latestStatusContext });
    return true;
  }

  if (message?.type === "effecol:retry-capture") {
    handleRetryCapture()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "effecol:open-settings") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "effecol:check-bridge") {
    diagnoseEnvironment(null, {
      scope: "bridge",
      requestPermissions: true,
      pairBridge: true
    })
      .then((diagnosis) => sendResponse({ ok: true, diagnosis }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "effecol:diagnose-environment") {
    const inputSettings = message?.settings && typeof message.settings === "object"
      ? normalizeSettings({
          ...DEFAULT_SYNC_SETTINGS,
          ...DEFAULT_LOCAL_SETTINGS,
          ...message.settings
        })
      : null;

    diagnoseEnvironment(inputSettings, {
      scope: message?.scope || "all",
      requestPermissions: Boolean(message?.requestPermissions),
      pairBridge: message?.pairBridge !== false
    })
      .then((diagnosis) => sendResponse({ ok: true, diagnosis }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

let latestStatusContext = {
  state: "idle",
  title: "EffecCol",
  message: "点击扩展图标后，这里会显示最近一次收藏结果。",
  details: [],
  canRetry: false,
  retryIntent: "retry-capture",
  retryLabel: "重试这次保存",
  canLaunchObsidian: false,
  needsSetup: false
};

let latestCaptureTabId = null;

async function handleCapture(tab, options = {}) {
  latestCaptureTabId = tab?.id ?? null;

  if (!tab?.id) {
    await openStatusPage({
      state: "error",
      title: "没有拿到当前页面",
      message: "请先切到一个普通网页标签，再点一次扩展图标。",
      details: [],
      canRetry: false,
      retryIntent: "retry-capture",
      retryLabel: "重试这次保存",
      canLaunchObsidian: false,
      needsSetup: false
    });
    return;
  }

  if (!isCapturableUrl(tab.url)) {
    await showToast(tab.id, "这个页面不是普通网页，暂时不能收藏。", "warning");
    await openStatusPage({
      state: "error",
      title: "这个页面暂时不能收藏",
      message: "EffecCol 目前只支持普通网页内容页，也就是 http 或 https 页面。",
      details: [
        "支持的场景通常是文章页、博客页、文档页和资讯页。",
        "Chrome 内置页、新标签页、扩展页、设置页这类特殊页面暂不支持。"
      ],
      canRetry: false,
      retryIntent: "retry-capture",
      retryLabel: "重试这次保存",
      canLaunchObsidian: false,
      needsSetup: false
    }, { openTab: false });
    return;
  }

  const settings = await loadSettings();
  const diagnosis = await diagnoseEnvironment(settings, {
    scope: "all",
    requestPermissions: true,
    pairBridge: true
  });
  if (!diagnosis.ok) {
    await presentDiagnosis(tab.id, diagnosis);
    return;
  }

  try {
    const payload = await collectCapturePayload(tab);
    if (!options.forceLowQuality && shouldBlockLowValueCapture(payload)) {
      const qualityDetails = Array.isArray(payload.quality?.details) ? payload.quality.details : [];
      const score = Number(payload.quality?.score);
      const scoreText = Number.isFinite(score) ? `质量评分：${score}/100` : "";

      await showToast(tab.id, "这页更像论坛流或列表页，先确认是否仍要收藏。", "warning");
      await openStatusPage({
        state: "error",
        title: "这页不太像适合沉淀的文章",
        message: "EffecCol 判断这页更像论坛串、列表页或动态流，直接保存可能会把资料库弄脏。",
        details: [
          ...(scoreText ? [scoreText] : []),
          ...qualityDetails,
          "如果你确认这页就是想保存的内容，点下面的按钮继续保存。"
        ],
        canRetry: true,
        retryIntent: "force-low-quality",
        retryLabel: "仍然保存这页",
        canLaunchObsidian: false,
        needsSetup: false
      });
      return;
    }

    await showToast(tab.id, "正在保存至 Obsidian...", "info");

    const notePath = buildNotePath(payload.title, payload.capturedAt);
    const captureId = buildCaptureId(payload.title, payload.capturedAt);
    const assetFolderPath = buildAssetFolderPath(payload.title, payload.capturedAt, captureId);
    const resolvedSettings = {
      ...diagnosis.settings,
      bridgeVaultName: diagnosis.bridge?.data?.vaultName || "",
      bridgeVaultPath: diagnosis.bridge?.data?.vaultPath || ""
    };
    const aiResult = await generateAiSummary(payload, resolvedSettings);
    const enrichedPayload = {
      ...payload,
      captureId,
      assetFolderPath,
      aiSummary: aiResult.summary,
      summaryStatus: aiResult.status
    };
    const noteContent = buildNoteContent(enrichedPayload, resolvedSettings, notePath);
    const cardText = buildBoardCardText(enrichedPayload, resolvedSettings, notePath);
    const cardHtml = buildBoardCardHtml(enrichedPayload, resolvedSettings, notePath);

    const bridgeSaveResult = await saveNoteThroughBridge({
      notePath,
      noteContent,
      captureId,
      assetFolderPath,
      contentBlocks: enrichedPayload.contentBlocks || [],
      debugInfo: enrichedPayload.debugInfo || {},
      sourceUrl: payload.url,
      title: payload.title
    }, resolvedSettings);
    await copyCardToClipboard(cardText, cardHtml);

    const successMessage =
      aiResult.status === "ready"
        ? "保存成功，AI 总结已复制到剪贴板，可继续粘贴到你常用的地方。"
        : "保存成功，AI 摘要生成失败时已降级保留摘录，卡片已复制到剪贴板。";

    await showToast(tab.id, successMessage, "success");
    await openStatusPage({
      state: "success",
      title: "这条内容已经静默保存",
      message: successMessage,
      details: [
        `保存路径：${notePath}`,
        `原文：${payload.url}`,
        `图片：请求 ${bridgeSaveResult.requestedImageCount || 0} 张，本地保存 ${bridgeSaveResult.downloadedImageCount || 0} 张，外链回退 ${bridgeSaveResult.fallbackImageCount || 0} 张`,
        bridgeSaveResult.debugSummary || "图片调试：无额外信息"
      ],
      canRetry: false,
      retryIntent: "retry-capture",
      retryLabel: "重试这次保存",
      canLaunchObsidian: false,
      needsSetup: false
    }, { openTab: false });
  } catch (error) {
    console.error(error);
    await showToast(tab.id, `保存失败：${error.message}`, "error");
    await openStatusPage({
      state: "error",
      title: "这次保存没有完成",
      message: error.message,
      details: [
        "如果是本地保存失败，请先打开设置页重新检查 Obsidian 插件连接。",
        "如果是 AI 接口错误，请去设置页检查 API Key 和 endpoint。"
      ],
      canRetry: true,
      retryIntent: "retry-capture",
      retryLabel: "重试这次保存",
      canLaunchObsidian: false,
      needsSetup: false
    });
  }
}

async function handleRetryCapture() {
  if (!latestCaptureTabId) {
    throw new Error("没有可重试的页面。请回到目标网页后重新点击扩展图标。");
  }

  const tab = await chrome.tabs.get(latestCaptureTabId);
  await handleCapture(tab, {
    forceLowQuality: latestStatusContext.retryIntent === "force-low-quality"
  });
}

async function initializeStatusContext() {
  const stored = await chrome.storage.local.get(STATUS_STORAGE_KEY);
  if (stored?.[STATUS_STORAGE_KEY]) {
    latestStatusContext = stored[STATUS_STORAGE_KEY];
  }
}

async function loadSettings() {
  const [syncStored, localStored] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS),
    chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS)
  ]);

  return normalizeSettings({
    ...DEFAULT_SYNC_SETTINGS,
    ...DEFAULT_LOCAL_SETTINGS,
    ...syncStored,
    ...localStored
  });
}

async function diagnoseEnvironment(inputSettings = null, options = {}) {
  const settings = inputSettings || await loadSettings();
  const scope = options.scope || "all";
  const shouldCheckAi = scope === "all" || scope === "ai";
  const shouldCheckBridge = scope === "all" || scope === "bridge";

  if (shouldCheckAi) {
    const provider = resolveAiProvider(settings);
    const providerPreset = getProviderPreset(provider);
    const providerApiKey = String(settings.aiProviderCredentials?.[provider] || settings.aiApiKey || "").trim();

    if (!providerApiKey) {
      return {
        ok: false,
        code: "missing_api_key",
        title: "先完成 AI 设置",
        message: `还没有配置 ${providerPreset.label} 的 API Key。先填一次，后面就能自动生成摘要。`,
        details: ["设置页里先填 API Key。"],
        needsSetup: true,
        shouldOpenOptions: true,
        settings
      };
    }

    if (!String(settings.aiModel || "").trim()) {
      return {
        ok: false,
        code: "missing_model",
        title: "先完成 AI 设置",
        message: "还没有配置模型名。",
        details: ["设置页里先确认模型名。"],
        needsSetup: true,
        shouldOpenOptions: true,
        settings
      };
    }

    if (provider === "custom" && !String(settings.aiEndpoint || "").trim()) {
      return {
        ok: false,
        code: "missing_api_endpoint",
        title: "先完成 AI 设置",
        message: "自定义兼容接口还没有配置 endpoint。",
        details: ["设置页高级选项里先填 API Endpoint。"],
        needsSetup: true,
        shouldOpenOptions: true,
        settings
      };
    }

    const granted = await ensureApiPermission(settings, {
      request: options.requestPermissions !== false
    });
    if (!granted) {
      return {
        ok: false,
        code: "missing_api_permission",
        title: "AI 接口权限还没准备好",
        message: "没有拿到 AI 接口域名的访问权限，请在设置页重新确认。",
        details: ["重新保存设置时允许对应域名权限。"],
        needsSetup: true,
        shouldOpenOptions: true,
        settings
      };
    }
  }

  if (!shouldCheckBridge) {
    return {
      ok: true,
      code: "ready",
      title: "环境已准备好",
      message: "当前设置可用。",
      details: [],
      needsSetup: false,
      shouldOpenOptions: false,
      settings
    };
  }

  const bridgePermission = await ensureBridgePermission();
  if (!bridgePermission) {
    return {
      ok: false,
      code: "missing_bridge_permission",
      title: "Obsidian 连接权限还没准备好",
      message: "扩展还没有拿到本地 Obsidian 插件接口的访问权限。",
      details: [
        "重新加载扩展后再点击一次。",
        "如果仍失败，请打开设置页检查 Obsidian 插件连接状态。"
      ],
      needsSetup: true,
      shouldOpenOptions: true,
      settings
    };
  }

  const bridge = await checkBridgeStatus();
  if (!bridge.ok) {
    return {
      ok: false,
      code: "obsidian_bridge_unavailable",
      title: "Obsidian 还没连上",
      message: "没有连上 Obsidian 的 EffecCol 本地保存接口，所以现在还不能静默保存。",
      details: [
        "如果你还没安装 Obsidian，请先安装 Obsidian 桌面端。",
        "如果已经安装 Obsidian，请打开它，并在当前 Vault 启用 EffecCol 插件。",
        "如果还没安装 EffecCol 插件，请把仓库里的 obsidian-plugin/effecol/ 放进当前 Vault 的 .obsidian/plugins/effecol/ 后启用。"
      ],
      needsSetup: true,
      shouldOpenOptions: true,
      settings,
      bridge
    };
  }

  let resolvedSettings = settings;
  if (options.pairBridge !== false) {
    const pairing = await ensureBridgeAuth(settings, bridge);
    if (!pairing.ok) {
      return {
        ok: false,
        code: "bridge_pairing_failed",
        title: "Obsidian 已连上，但还没完成配对",
        message: pairing.message || "本地保存接口还没完成配对。",
        details: pairing.details || [
          "先打开设置页，再点一次“检查 Obsidian 插件连接”。",
          "如果还是失败，请确认当前 Vault 的 EffecCol 插件已经启用。"
        ],
        needsSetup: true,
        shouldOpenOptions: true,
        settings,
        bridge
      };
    }
    resolvedSettings = pairing.settings;
  }

  return {
    ok: true,
    code: "ready",
    title: "环境已准备好",
    message: "当前浏览器、AI 与 Obsidian 都已经连通，可以直接静默保存。",
    details: [],
    needsSetup: false,
    shouldOpenOptions: false,
    settings: resolvedSettings,
    bridge
  };
}

async function presentDiagnosis(tabId, diagnosis) {
  await showToast(tabId, diagnosis.message, diagnosis.needsSetup ? "warning" : "error");
  if (diagnosis.shouldOpenOptions) {
    await chrome.runtime.openOptionsPage();
  }

  await openStatusPage({
    state: diagnosis.needsSetup ? "needs-setup" : "error",
    title: diagnosis.title || "这次保存没有完成",
    message: diagnosis.message,
    details: diagnosis.details || [],
    canRetry: false,
    retryIntent: "retry-capture",
    retryLabel: "重试这次保存",
    canLaunchObsidian: false,
    needsSetup: Boolean(diagnosis.needsSetup)
  });
}

async function ensureBridgeAuth(settings, bridge = null, options = {}) {
  const currentToken = String(settings.bridgeAuthToken || "").trim();
  if (currentToken && !options.forcePair) {
    return {
      ok: true,
      settings,
      bridge
    };
  }

  const pairResult = await pairBridge();
  if (!pairResult.ok || !pairResult.token) {
    return {
      ok: false,
      message: "Obsidian 插件在线，但浏览器还没拿到写入令牌。",
      details: [
        "先确认 Obsidian 已打开并停留在当前 Vault。",
        "然后回设置页再点一次“检查 Obsidian 插件连接”。"
      ]
    };
  }

  const nextSettings = normalizeSettings({
    ...settings,
    bridgeAuthToken: pairResult.token,
    bridgeAuthPairedAt: pairResult.pairedAt || new Date().toISOString()
  });

  await chrome.storage.local.set({
    bridgeAuthToken: nextSettings.bridgeAuthToken,
    bridgeAuthPairedAt: nextSettings.bridgeAuthPairedAt
  });

  return {
    ok: true,
    settings: nextSettings,
    bridge: bridge || pairResult.bridge || null
  };
}

async function pairBridge() {
  try {
    const response = await fetch(`${LOCAL_PLUGIN_URL}/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [BRIDGE_CLIENT_HEADER]: BRIDGE_CLIENT_NAME
      },
      body: JSON.stringify({
        clientName: "EffecCol Chrome Extension",
        extensionVersion: chrome.runtime.getManifest().version || ""
      })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.ok || !data?.authToken) {
      return {
        ok: false,
        reason: data?.error || `HTTP ${response.status}`
      };
    }

    return {
      ok: true,
      token: String(data.authToken || ""),
      pairedAt: String(data.pairedAt || ""),
      bridge: data?.bridge || null
    };
  } catch (error) {
    return {
      ok: false,
      reason: error.message
    };
  }
}

function shouldBlockLowValueCapture(payload) {
  return Boolean(payload?.quality?.blocked);
}

function assessCaptureQuality(pageData, url) {
  const contentBlocks = Array.isArray(pageData?.contentBlocks) ? pageData.contentBlocks : [];
  const textBlocks = contentBlocks.filter((block) => block?.type !== "image");
  const title = String(pageData?.title || "").trim();
  const articleText = String(pageData?.articleText || "").trim();
  const selectedText = String(pageData?.selectedText || "").trim();
  const paragraphCount = textBlocks.filter((block) => ["paragraph", "blockquote"].includes(block.type)).length;
  const headingCount = textBlocks.filter((block) => block.type === "heading").length;
  const listCount = textBlocks.filter((block) => block.type === "list").length;
  const timelineMatches = textBlocks.filter((block) =>
    /(由.+于.+发布|发表于|加载上方更多帖子|取消选择|您已选择\s*\d+\s*个帖子|跳转到最后一条回复|开始撰写对此帖子的回复)/.test(String(block.text || ""))
  ).length;

  let score = 100;
  const details = [];

  if (/\/t\/topic\/|\/forum\/|\/threads?\//i.test(String(url || ""))) {
    score -= 28;
    details.push("链接结构更像论坛帖或讨论串。");
  }

  if (/(集散帖|话题|论坛|社区|帖子|评论|回复|搜索结果|目录|合集)/.test(title)) {
    score -= 18;
    details.push("标题更像论坛串、列表页或索引页。");
  }

  if (timelineMatches >= 8) {
    score -= 42;
    details.push("正文里有大量时间线/回帖流信号。");
  } else if (timelineMatches >= 4) {
    score -= 24;
    details.push("正文里出现较多时间线/回帖流信号。");
  }

  if (paragraphCount <= 2 && headingCount >= 8) {
    score -= 20;
    details.push("段落正文太少，但结构标题很多，更像帖子流或列表。");
  }

  if (listCount >= 4 && paragraphCount <= 2) {
    score -= 12;
    details.push("列表结构占比偏高，不像稳定文章正文。");
  }

  if (textBlocks.length >= 120) {
    score -= 15;
    details.push("内容块数量过多，更像目录、时间线或长串流。");
  }

  if (selectedText.length >= 120) {
    score += 18;
    details.push("你当前有较长选区，说明这是一次有意图的定点收藏。");
  }

  if ((pageData?.debugInfo?.rootTag || "") === "ARTICLE") {
    score += 10;
  }

  if (articleText.length >= 2200 && paragraphCount >= 6) {
    score += 8;
  }

  score = Math.max(0, Math.min(100, score));

  const blocked = selectedText.length < 120 && (score < 45 || timelineMatches >= 10);
  if (blocked && !details.length) {
    details.push("这页更像动态流、论坛串或索引页，不像适合沉淀的文章。");
  }

  return {
    score,
    blocked,
    details
  };
}

async function checkBridgeStatus() {
  const hasBridgePermission = await chrome.permissions.contains({
    origins: [`${LOCAL_PLUGIN_ORIGIN}/*`]
  });

  if (!hasBridgePermission) {
    return { ok: false, reason: "missing_bridge_permission" };
  }

  try {
    const response = await fetch(`${LOCAL_PLUGIN_URL}/health`);
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return {
      ok: Boolean(data?.ok),
      data,
      paired: Boolean(data?.paired),
      authRequired: Boolean(data?.authRequired)
    };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function ensureApiPermission(settings, options = {}) {
  try {
    const originPattern = `${new URL(resolveAiEndpoint(settings)).origin}/*`;
    const alreadyGranted = await chrome.permissions.contains({
      origins: [originPattern]
    });

    if (alreadyGranted) {
      return true;
    }

    if (options.request === false) {
      return false;
    }

    return chrome.permissions.request({
      origins: [originPattern]
    });
  } catch (error) {
    console.error(error);
    return false;
  }
}

async function ensureBridgePermission() {
  try {
    return chrome.permissions.contains({
      origins: [`${LOCAL_PLUGIN_ORIGIN}/*`]
    });
  } catch (error) {
    console.error(error);
    return false;
  }
}

async function collectCapturePayload(tab) {
  const pageData = await getPageData(tab);
  const title = (pageData.title || tab.title || "").trim();
  const url = (pageData.canonicalUrl || tab.url || "").trim();

  if (!title) {
    throw new Error("没有拿到页面标题。");
  }

  if (!url) {
    throw new Error("没有拿到页面链接。");
  }

  return {
    title,
    url,
    siteName: pageData.siteName || extractHostname(url),
    author: normalizeMultilineText(pageData.author || "", 300),
    description: normalizeMultilineText(pageData.description || "", 600),
    published: normalizeMultilineText(pageData.published || "", 120),
    contentBlocks: Array.isArray(pageData.contentBlocks) ? pageData.contentBlocks : [],
    debugInfo: pageData.debugInfo && typeof pageData.debugInfo === "object" ? pageData.debugInfo : {},
    sourceExcerpt: normalizeMultilineText(
      pageData.selectedText || pageData.excerpt || pageData.description || "",
      1800
    ),
    sourceContent: normalizeMultilineText(
      pageData.selectedText || pageData.articleText || pageData.excerpt || pageData.description || "",
      22000
    ),
    quality: assessCaptureQuality(pageData, url),
    aiSummary: "",
    summaryStatus: "pending",
    capturedAt: new Date()
  };
}

async function getPageData(tab) {
  if (!/^https?:/i.test(tab.url || "")) {
    return {
      title: tab.title || "",
      canonicalUrl: tab.url || "",
      siteName: extractHostname(tab.url || ""),
      description: "",
      excerpt: "",
      selectedText: ""
    };
  }

  const [injected] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const NOISE_SELECTOR = [
        "nav",
        "header",
        "footer",
        "aside",
        "form",
        "button",
        "noscript",
        "script",
        "style",
        "svg",
        "canvas",
        "iframe",
        "[role='navigation']",
        "[role='complementary']",
        "[aria-label*='breadcrumb' i]",
        "[aria-label*='menu' i]",
        "[aria-label*='share' i]",
        "[data-testid*='share' i]",
        "[data-testid*='comment' i]",
        "[data-testid*='like' i]"
      ].join(",");
      const NOISE_TOKENS = new Set([
        "nav",
        "menu",
        "breadcrumb",
        "footer",
        "header",
        "sidebar",
        "aside",
        "share",
        "social",
        "tag",
        "tags",
        "category",
        "categories",
        "meta",
        "author",
        "authors",
        "time",
        "date",
        "publish",
        "published",
        "like",
        "likes",
        "favorite",
        "favorites",
        "comment",
        "comments",
        "recommend",
        "recommended",
        "related",
        "toolbar",
        "actions",
        "action",
        "copyright",
        "advert",
        "ads"
      ]);

      const getMeta = (name) =>
        document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.content?.trim() || "";
      const isWeChatArticle = /(^|\.)mp\.weixin\.qq\.com$/i.test(location.hostname);
      const normalizeText = (value, limit = 22000) =>
        (value || "")
          .replace(/\u00a0/g, " ")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .slice(0, limit);
      const isInvalidImageSourceValue = (value) => {
        const normalized = String(value || "").trim().toLowerCase();
        if (!normalized) {
          return true;
        }

        return [
          "null",
          "undefined",
          "false",
          "none",
          "about:blank",
          "#",
          "/",
          "javascript:void(0)",
          "javascript:;",
          "data:,"
        ].includes(normalized);
      };
      const getTokenizedHint = (value) =>
        String(value || "")
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .toLowerCase()
          .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
          .map((token) => token.trim())
          .filter(Boolean);
      const isNoiseElement = (element) => {
        if (!(element instanceof Element)) {
          return false;
        }

        const tagName = element.tagName.toLowerCase();
        if (tagName === "body" || tagName === "html") {
          return false;
        }

        if (["nav", "header", "footer", "aside", "form", "button", "noscript", "script", "style", "svg", "canvas", "iframe"].includes(tagName)) {
          return true;
        }

        const role = (element.getAttribute("role") || "").toLowerCase();
        if (role === "navigation" || role === "complementary") {
          return true;
        }

        const ariaLabel = (element.getAttribute("aria-label") || "").toLowerCase();
        if (/(breadcrumb|menu|share)/.test(ariaLabel)) {
          return true;
        }

        const testId = (element.getAttribute("data-testid") || "").toLowerCase();
        if (/(share|comment|like)/.test(testId)) {
          return true;
        }

        const tokens = [
          ...getTokenizedHint(element.className),
          ...getTokenizedHint(element.id)
        ];
        return tokens.some((token) => NOISE_TOKENS.has(token));
      };
      const hasNoiseAncestor = (element, stopNode = null) => {
        let current = element instanceof Element ? element : null;
        while (current && current !== stopNode) {
          if (isNoiseElement(current)) {
            return true;
          }
          current = current.parentElement;
        }
        return false;
      };
      const countNoiseDescendants = (rootNode) =>
        Array.from(rootNode?.querySelectorAll?.("*") || []).filter((node) => isNoiseElement(node)).length;
      const isNoiseText = (text) => {
        const normalized = (text || "").replace(/\s+/g, " ").trim();
        if (!normalized) {
          return true;
        }

        if (normalized.length <= 2) {
          return true;
        }

        if (normalized.length <= 24) {
          return /^(标签|分类|栏目|作者|来源|原文|分享|转发|收藏|点赞|评论|上一篇|下一篇|相关推荐|阅读原文|发布时间|发布于|更新于)$/i.test(normalized);
        }

        if (/^\d+\s*(赞|点赞|收藏|评论|阅读|浏览|转发|喜欢)$/.test(normalized)) {
          return true;
        }

        return false;
      };
      const isArticleTailText = (text) => {
        const normalized = (text || "").replace(/\s+/g, " ").trim();
        if (!normalized) {
          return false;
        }

        return [
          "作者：",
          "作者:",
          "原文：",
          "原文:",
          "本文由",
          "未经许可",
          "题图来自",
          "基于CC0协议"
        ].some((prefix) => normalized.startsWith(prefix));
      };
      const isStopSectionText = (text) => {
        const normalized = (text || "").replace(/\s+/g, " ").trim();
        if (!normalized) {
          return false;
        }

        if (
          /^(微信扫一扫关注该公众号|微信扫一扫可打开此内容，使用完整服务|继续滑动看下一个|预览时标签不可点|轻触阅读原文)$/i.test(normalized)
        ) {
          return true;
        }

        return /^(为你推荐|相关推荐|热门文章|评论|评论区|更多内容|延伸阅读|相关阅读|相关文章)$/i.test(normalized);
      };
      const isElementVisible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity || "1") === 0
        ) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const getElementVisualMetrics = (element) => {
        if (!(element instanceof HTMLElement)) {
          return { width: 0, height: 0 };
        }

        const rect = element.getBoundingClientRect();
        return {
          width: Math.round(rect.width || element.clientWidth || 0),
          height: Math.round(rect.height || element.clientHeight || 0)
        };
      };
      const isElementInPrimaryColumn = (element, titleElement) => {
        if (!(element instanceof HTMLElement) || !(titleElement instanceof HTMLElement)) {
          return true;
        }

        const titleRect = titleElement.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        if (!titleRect.width || !elementRect.width) {
          return true;
        }

        const titleCenter = titleRect.left + titleRect.width / 2;
        const elementCenter = elementRect.left + elementRect.width / 2;
        const horizontalDelta = Math.abs(titleCenter - elementCenter);
        const overlap = Math.max(
          0,
          Math.min(titleRect.right + 220, elementRect.right) - Math.max(titleRect.left - 120, elementRect.left)
        );

        return horizontalDelta <= Math.max(220, titleRect.width * 0.9) || overlap >= Math.min(180, elementRect.width * 0.35);
      };
      const findTitleElement = () => {
        const normalizedTitle = normalizeText(
          document.title.replace(/\s*[|｜-]\s*[^|｜-]+$/, "").trim() || document.title,
          220
        )
          .replace(/\s+/g, " ")
          .trim();
        const candidates = Array.from(
          document.querySelectorAll([
            "article h1",
            "main h1",
            "h1",
            "h2",
            "[class*='title' i]",
            "[class*='headline' i]",
            "[class*='article-title' i]",
            "[id*='title' i]"
          ].join(","))
        ).filter((node) => normalizeText(node?.innerText || "", 220).length >= 6);

        let bestNode = null;
        let bestScore = -Infinity;
        for (const node of candidates) {
          if (!isElementVisible(node)) {
            continue;
          }

          const text = normalizeText(node.innerText || "", 220).replace(/\s+/g, " ").trim();
          if (!text) {
            continue;
          }

          let score = 0;
          if (text === normalizedTitle) {
            score += 500;
          } else if (
            normalizedTitle &&
            (text.includes(normalizedTitle) || normalizedTitle.includes(text))
          ) {
            score += 320;
          }

          if (node.tagName === "H1") {
            score += 140;
          } else if (node.tagName === "H2") {
            score += 80;
          }

          const metrics = getElementVisualMetrics(node);
          score += Math.min(metrics.width, 1200) * 0.12 + Math.min(metrics.height, 180) * 0.55;
          score += Math.min(text.length, 90) * 1.8;

          if (score > bestScore) {
            bestScore = score;
            bestNode = node;
          }
        }

        return bestNode;
      };
      const resolvePageTitle = (titleElement) => {
        const titleCandidates = [
          normalizeText(titleElement?.innerText || "", 220),
          normalizeText(getMeta("og:title"), 220),
          normalizeText(getMeta("twitter:title"), 220),
          normalizeText(document.querySelector("meta[property='article:title']")?.content || "", 220),
          normalizeText(document.title.replace(/\s*[|｜-]\s*[^|｜-]+$/, "").trim() || document.title, 220),
          normalizeText(document.title, 220)
        ]
          .map((item) => item.replace(/\s+/g, " ").trim())
          .filter(Boolean);

        if (isWeChatArticle) {
          const prioritized = titleCandidates.find((item) => item !== "微信公众平台");
          if (prioritized) {
            return prioritized;
          }
        }

        return titleCandidates[0] || "";
      };
      const getCandidateRoot = (titleElement) => {
        if (isWeChatArticle) {
          const preferredRoot = document.querySelector("#js_content, #img-content, .rich_media_content");
          if (preferredRoot instanceof HTMLElement && (preferredRoot.innerText || "").trim().length > 180) {
            return preferredRoot;
          }
        }

        const selectors = [
          "#js_content",
          "#img-content",
          "article",
          "main article",
          "main",
          "[role='main'] article",
          "[role='main']",
          "[itemprop='articleBody']",
          ".rich_media_content",
          ".rich_media_area_primary_inner",
          ".rich_media_wrp",
          "[class*='article-body' i]",
          "[class*='article-main' i]",
          ".article",
          ".article-content",
          ".article__content",
          ".grap",
          ".grap--content",
          ".post-content",
          ".entry-content",
          ".rich-text",
          ".markdown-body"
        ];

        const candidates = [];
        const seen = new Set();
        const pushCandidate = (node, source) => {
          if (!(node instanceof HTMLElement) || seen.has(node)) {
            return;
          }

          seen.add(node);
          candidates.push({ node, source });
        };

        for (const selector of selectors) {
          const match = document.querySelector(selector);
          if (match && match.innerText && match.innerText.trim().length > 200) {
            pushCandidate(match, `selector:${selector}`);
          }
        }

        let ancestor = titleElement instanceof HTMLElement ? titleElement : null;
        let ancestorDepth = 0;
        while (ancestor && ancestorDepth < 8) {
          pushCandidate(ancestor, `title-ancestor:${ancestorDepth}`);
          ancestor = ancestor.parentElement;
          ancestorDepth += 1;
        }

        const allBlocks = Array.from(document.querySelectorAll("article, main, section, div"));
        let bestNode = document.body;
        let bestScore = 0;

        const scoreNode = (node, source) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }

          const text = node.innerText || "";
          const textLength = text.trim().length;
          if (textLength < 180) {
            return;
          }

          const paragraphCount = node.querySelectorAll("p").length;
          const imageCount = node.querySelectorAll("img, picture img").length;
          const headingCount = node.querySelectorAll("h1, h2, h3").length;
          let score =
            Math.min(textLength, 18000) +
            paragraphCount * 260 +
            imageCount * 420 +
            headingCount * 180;

          if (titleElement instanceof HTMLElement && node.contains(titleElement)) {
            score += 3400;
            if (node === titleElement) {
              score -= 2400;
            }
          }

          if (node.tagName === "BODY") {
            score -= 2600;
          }

          if (String(source || "").startsWith("selector:")) {
            score += 260;
          }

          if (String(source || "").startsWith("title-ancestor:")) {
            const depth = Number(String(source).split(":")[1]) || 0;
            score += Math.max(0, 1200 - depth * 110);
          }

          if (countNoiseDescendants(node) > paragraphCount * 4 + 18) {
            score -= 600;
          }

          const classHint = `${node.id || ""} ${node.className || ""}`.toLowerCase();
          if (/(js_content|rich_media_content|rich_media_area_primary_inner|img-content)/.test(classHint)) {
            score += 900;
          }

          if (!isElementVisible(node)) {
            score -= 1500;
          }

          if (score > bestScore) {
            bestScore = score;
            bestNode = node;
          }
        };

        for (const candidate of candidates) {
          scoreNode(candidate.node, candidate.source);
        }

        for (const node of allBlocks) {
          scoreNode(node, "generic-scan");
        }

        return bestNode || document.body;
      };
      const extractCleanArticleText = (rootNode) => {
        const clone = rootNode.cloneNode(true);
        clone.querySelectorAll(NOISE_SELECTOR).forEach((node) => node.remove());
        Array.from(clone.querySelectorAll("*"))
          .filter((node) => isNoiseElement(node))
          .forEach((node) => node.remove());

        const textNodes = Array.from(clone.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre"));
        const lines = textNodes
          .map((node) => normalizeText(node.innerText || "", 1200))
          .filter((line) => !isNoiseText(line));

        const dedupedLines = [];
        const seen = new Set();
        for (const line of lines) {
          const key = line.replace(/\s+/g, " ").trim();
          if (!key || seen.has(key)) {
            continue;
          }
          seen.add(key);
          dedupedLines.push(line);
        }

        const joined = dedupedLines.join("\n\n");
        return normalizeText(joined || clone.innerText || "", 22000);
      };
      const toAbsoluteUrl = (value) => {
        if (isInvalidImageSourceValue(value)) {
          return "";
        }

        try {
          const absolute = new URL(value, location.href).href;
          const normalized = absolute.toLowerCase();
          if (
            /\/(?:null|undefined|false|none)(?:[/?#]|$)/.test(normalized) ||
            normalized.endsWith(":blank")
          ) {
            return "";
          }

          return absolute;
        } catch {
          return "";
        }
      };
      const parseSrcsetUrls = (value) =>
        String(value || "")
          .split(",")
          .map((item) => item.trim().split(/\s+/)[0] || "")
          .filter(Boolean);
      const resolveImageSource = (node) => {
        if (!(node instanceof HTMLImageElement)) {
          return { url: "", fromHint: false };
        }

        const rawCandidates = [
          { value: node.currentSrc, kind: "currentSrc" },
          { value: node.src, kind: "src" },
          { value: node.getAttribute("data-original"), kind: "data-original" },
          { value: node.getAttribute("data-original-src"), kind: "data-original-src" },
          { value: node.getAttribute("data-src"), kind: "data-src" },
          { value: node.getAttribute("data-url"), kind: "data-url" },
          { value: node.getAttribute("data-file"), kind: "data-file" },
          { value: node.getAttribute("data-actualsrc"), kind: "data-actualsrc" },
          { value: node.getAttribute("data-actual-src"), kind: "data-actual-src" },
          { value: node.getAttribute("data-lazy-src"), kind: "data-lazy-src" },
          { value: node.getAttribute("data-lazyload"), kind: "data-lazyload" },
          { value: node.getAttribute("data-ks-lazyload"), kind: "data-ks-lazyload" },
          { value: node.getAttribute("data-echo"), kind: "data-echo" },
          { value: node.getAttribute("data-full-src"), kind: "data-full-src" },
          { value: node.getAttribute("data-full"), kind: "data-full" },
          { value: node.getAttribute("data-image"), kind: "data-image" },
          { value: node.getAttribute("data-orig-file"), kind: "data-orig-file" }
        ];
        const srcsetCandidates = [
          { value: node.getAttribute("srcset"), kind: "srcset" },
          { value: node.getAttribute("data-srcset"), kind: "data-srcset" },
          { value: node.getAttribute("data-lazy-srcset"), kind: "data-lazy-srcset" }
        ];

        const pictureSources =
          node.parentElement?.tagName === "PICTURE"
            ? Array.from(node.parentElement.querySelectorAll("source"))
            : [];
        const containerCandidates = [node.parentElement, node.closest("figure"), node.closest("a")].filter(Boolean);

        for (const source of pictureSources) {
          rawCandidates.push({
            value: source.getAttribute("src"),
            kind: "picture-src"
          });
          srcsetCandidates.push({
            value: source.getAttribute("srcset"),
            kind: "picture-srcset"
          });
        }

        for (const container of containerCandidates) {
          rawCandidates.push({
            value: container.getAttribute?.("data-original"),
            kind: "container-data-original"
          });
          rawCandidates.push({
            value: container.getAttribute?.("data-src"),
            kind: "container-data-src"
          });
          rawCandidates.push({
            value: container.getAttribute?.("href"),
            kind: "container-href"
          });
          srcsetCandidates.push({
            value: container.getAttribute?.("data-srcset"),
            kind: "container-data-srcset"
          });
        }

        const candidates = [];
        const seen = new Set();
        const pushCandidate = (value, kind) => {
          const absolute = toAbsoluteUrl(value);
          if (!absolute || seen.has(absolute)) {
            return;
          }
          seen.add(absolute);
          candidates.push({ url: absolute, kind });
        };

        for (const candidate of rawCandidates) {
          pushCandidate(candidate.value, candidate.kind);
        }

        for (const candidate of srcsetCandidates) {
          for (const url of parseSrcsetUrls(candidate.value)) {
            pushCandidate(url, candidate.kind);
          }
        }

        const scoreCandidate = (candidate) => {
          let score = 0;
          const url = candidate.url;
          const kind = candidate.kind;

          if (!url || url.startsWith("data:")) {
            return -Infinity;
          }

          if (/(data-original|data-actual|data-full|data-image|orig-file)/.test(kind)) {
            score += 60;
          } else if (/(data-src|data-lazy|srcset|picture-srcset|container-href)/.test(kind)) {
            score += 35;
          } else if (kind === "currentSrc") {
            score += 20;
          } else if (kind === "src") {
            score += 10;
          }

          if (/\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(url)) {
            score += 20;
          }

          if (/\/both\/\d+x\d+/i.test(url)) {
            score -= 80;
          }

          if (/(thumbnail|thumb|avatar|logo|icon|sprite|badge|qrcode|qr)/i.test(url)) {
            score -= 45;
          }

          if (/res\.wx\.qq\.com\/op_res/i.test(url)) {
            score -= 90;
          }

          if (!/[?&](?:w|width|h|height)=\d+/i.test(url)) {
            score += 8;
          }

          return score;
        };

        const best = candidates
          .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate) }))
          .sort((left, right) => right.score - left.score)[0];

        if (!best || !Number.isFinite(best.score)) {
          return { url: "", fromHint: false };
        }

        return {
          url: best.url,
          fromHint: !["currentSrc", "src"].includes(best.kind)
        };
      };
      const isLikelyContentImage = (node) => {
        if (!(node instanceof HTMLImageElement)) {
          return false;
        }

        const resolved = resolveImageSource(node);
        const src = resolved.url;
        if (!src || src.startsWith("data:")) {
          return false;
        }

        if (/\/both\/\d+x\d+|thumbnail|thumb|avatar|logo|icon|sprite/i.test(src)) {
          return false;
        }

        const parentHint = `${node.parentElement?.className || ""} ${node.parentElement?.id || ""}`.toLowerCase();
        const textHint = `${node.alt || ""} ${node.className || ""} ${node.id || ""} ${parentHint}`.toLowerCase();
        if (/(avatar|logo|icon|emoji|qrcode|qr|badge|sprite)/.test(textHint)) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        const width = Math.round(node.naturalWidth || node.width || rect.width || node.clientWidth || 0);
        const height = Math.round(node.naturalHeight || node.height || rect.height || node.clientHeight || 0);
        if (width && height && (width < 180 || height < 120 || width * height < 36000)) {
          return false;
        }

        return true;
      };
      const extractContentBlocks = (rootNode, titleElement = null) => {
        const blockSelectors = [
          "h1",
          "h2",
          "h3",
          "h4",
          "p",
          "blockquote",
          "pre",
          "ul",
          "ol",
          "figure img",
          "p img",
          "img"
        ].join(",");
        const elements = Array.from(rootNode.querySelectorAll(blockSelectors));
        const blocks = [];
        const seenText = new Set();
        const seenImage = new Set();
        let reachedArticleTail = false;

        for (const element of elements) {
          if (hasNoiseAncestor(element, rootNode)) {
            continue;
          }

          if (!isElementInPrimaryColumn(element, titleElement)) {
            continue;
          }

          if (reachedArticleTail) {
            break;
          }

          if (element.tagName === "IMG") {
            if (!isLikelyContentImage(element)) {
              continue;
            }

            const sourceUrl = resolveImageSource(element).url;
            if (!sourceUrl || seenImage.has(sourceUrl)) {
              continue;
            }
            seenImage.add(sourceUrl);
            blocks.push({
              type: "image",
              sourceUrl,
              pageUrl: location.href,
              alt: normalizeText(element.alt || "", 200)
            });
            continue;
          }

          let type = "paragraph";
          if (/^H[1-4]$/.test(element.tagName)) {
            type = "heading";
          } else if (element.tagName === "BLOCKQUOTE") {
            type = "blockquote";
          } else if (element.tagName === "UL" || element.tagName === "OL") {
            type = "list";
          }

          let text = "";
          if (type === "list") {
            text = Array.from(element.querySelectorAll("li"))
              .map((item) => normalizeText(item.innerText || "", 500))
              .filter(Boolean)
              .join("\n");
          } else {
            text = normalizeText(element.innerText || "", 1600);
          }

          if (!text || isNoiseText(text)) {
            continue;
          }

          if (blocks.length >= 6 && (isArticleTailText(text) || isStopSectionText(text))) {
            reachedArticleTail = true;
            continue;
          }

          const key = `${type}:${text.replace(/\s+/g, " ").trim()}`;
          if (seenText.has(key)) {
            continue;
          }
          seenText.add(key);

          blocks.push({
            type,
            text,
            ...(type === "heading" ? { level: Number(element.tagName.slice(1)) || 2 } : {})
          });
        }

        return blocks;
      };
      const extractFallbackArticleBlocks = (titleElement, titleText) => {
        const blockSelectors = [
          "h1",
          "h2",
          "h3",
          "h4",
          "p",
          "blockquote",
          "pre",
          "ul",
          "ol",
          "figure img",
          "p img",
          "img"
        ].join(",");
        const elements = Array.from(document.body.querySelectorAll(blockSelectors));
        const blocks = [];
        const seenText = new Set();
        const seenImage = new Set();
        let startIndex = 0;
        if (titleElement) {
          const firstFollowingIndex = elements.findIndex((element) => {
            if (element === titleElement) {
              return true;
            }

            return Boolean(titleElement.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
          });
          if (firstFollowingIndex !== -1) {
            startIndex = firstFollowingIndex;
          }
        }
        let reachedArticleTail = false;

        for (let index = startIndex; index < elements.length; index += 1) {
          const element = elements[index];
          if (hasNoiseAncestor(element)) {
            continue;
          }

          if (!isElementInPrimaryColumn(element, titleElement)) {
            continue;
          }

          if (reachedArticleTail) {
            break;
          }

          if (element.tagName === "IMG") {
            if (!isLikelyContentImage(element)) {
              continue;
            }

            const sourceUrl = resolveImageSource(element).url;
            if (!sourceUrl || seenImage.has(sourceUrl)) {
              continue;
            }
            seenImage.add(sourceUrl);
            blocks.push({
              type: "image",
              sourceUrl,
              pageUrl: location.href,
              alt: normalizeText(element.alt || "", 200)
            });
            continue;
          }

          let type = "paragraph";
          if (/^H[1-4]$/.test(element.tagName)) {
            type = "heading";
          } else if (element.tagName === "BLOCKQUOTE") {
            type = "blockquote";
          } else if (element.tagName === "UL" || element.tagName === "OL") {
            type = "list";
          }

          let text = "";
          if (type === "list") {
            text = Array.from(element.querySelectorAll("li"))
              .map((item) => normalizeText(item.innerText || "", 500))
              .filter(Boolean)
              .join("\n");
          } else {
            text = normalizeText(element.innerText || "", 1600);
          }

          if (!text || isNoiseText(text)) {
            continue;
          }

          if (blocks.length >= 6 && (isArticleTailText(text) || isStopSectionText(text))) {
            reachedArticleTail = true;
            continue;
          }

          const key = `${type}:${text.replace(/\s+/g, " ").trim()}`;
          if (seenText.has(key)) {
            continue;
          }
          seenText.add(key);

          blocks.push({
            type,
            text,
            ...(type === "heading" ? { level: Number(element.tagName.slice(1)) || 2 } : {})
          });
        }

        return blocks;
      };
      const selection = window.getSelection()?.toString().trim() || "";
      const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
      const siteName =
        getMeta("og:site_name") ||
        getMeta("application-name") ||
        location.hostname.replace(/^www\./, "");
      const author =
        getMeta("author") ||
        getMeta("article:author") ||
        document.querySelector("[rel='author']")?.textContent?.trim() ||
        "";
      const published =
        getMeta("article:published_time") ||
        document.querySelector("time[datetime]")?.getAttribute("datetime") ||
        document.querySelector("time")?.textContent?.trim() ||
        "";
      const description = getMeta("description") || getMeta("og:description") || getMeta("twitter:description");
      const titleElement = findTitleElement();
      const resolvedTitle = resolvePageTitle(titleElement);
      const root = getCandidateRoot(titleElement);
      const articleText = extractCleanArticleText(root);
      const titleText = resolvedTitle || document.title.replace(/\s*[|｜-]\s*[^|｜-]+$/, "").trim() || document.title;
      const rootContentBlocks = extractContentBlocks(root, titleElement);
      const fallbackContentBlocks = extractFallbackArticleBlocks(titleElement, titleText);
      const rootImageCount = rootContentBlocks.filter((block) => block.type === "image").length;
      const fallbackImageCount = fallbackContentBlocks.filter((block) => block.type === "image").length;
      const useFallbackStrategy = rootImageCount === 0 && fallbackImageCount > 0;
      const contentBlocks = useFallbackStrategy ? fallbackContentBlocks : rootContentBlocks;
      const paragraphs = articleText
        .split(/\n{2,}/)
        .map((line) => line.trim())
        .filter(Boolean);
      const excerptSource = selection || paragraphs.slice(0, 3).join("\n\n") || articleText || "";
      const excerpt = normalizeText(excerptSource, 1600);

      return {
        title: resolvedTitle || document.title,
        canonicalUrl,
        siteName,
        author,
        published,
        description,
        excerpt,
        articleText,
        contentBlocks,
        selectedText: selection.slice(0, 1200),
        debugInfo: {
          extractorVersion: "2026-06-03-wechat-root-pass",
          rootTag: root?.tagName || "",
          rootClass: String(root?.className || "").slice(0, 300),
          rootTextLength: (root?.innerText || "").trim().length,
          titleTag: titleElement?.tagName || "",
          titleClass: String(titleElement?.className || "").slice(0, 300),
          totalDocumentImageCount: document.querySelectorAll("img, picture img").length,
          rootContentBlockCount: rootContentBlocks.length,
          rootImageCount,
          fallbackContentBlockCount: fallbackContentBlocks.length,
          fallbackImageCount,
          chosenStrategy: useFallbackStrategy ? "fallback-document-blocks" : "root-blocks"
        }
      };
    }
  });

  return injected?.result || {};
}

async function generateAiSummary(payload, settings) {
  try {
    const provider = resolveAiProvider(settings);
    const apiKey = String(settings.aiProviderCredentials?.[provider] || settings.aiApiKey || "").trim();
    const headers =
      provider === "anthropic"
        ? {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01"
          }
        : {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          };

    const response = await fetch(resolveAiEndpoint(settings), {
      method: "POST",
      headers,
      body: JSON.stringify(buildAiRequestBody(payload, settings))
    });

    const rawText = await response.text();
    let data;

    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error(`模型接口返回了非 JSON 响应：${rawText.slice(0, 180)}`);
    }

    if (!response.ok) {
      const apiMessage = data?.error?.message || rawText.slice(0, 180) || `HTTP ${response.status}`;
      throw new Error(`模型接口请求失败：${apiMessage}`);
    }

    const summary = extractModelText(data);
    if (!summary) {
      throw new Error("模型接口返回成功，但没有提取到摘要文本。");
    }

    return {
      status: "ready",
      summary
    };
  } catch (error) {
    console.warn("AI summary failed, falling back to excerpt", error);
    const fallbackSource =
      normalizeMultilineText(payload.sourceExcerpt, 380) || "未提取到可用摘录，请直接打开原文查看。";
    return {
      status: "fallback",
      summary: `${AI_FALLBACK_SUMMARY}\n${fallbackSource}`
    };
  }
}

async function saveNoteThroughBridge(payload, settings) {
  const token = String(settings?.bridgeAuthToken || "").trim();
  const sendSaveRequest = async (authToken) => {
    return fetch(`${LOCAL_PLUGIN_URL}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [BRIDGE_CLIENT_HEADER]: BRIDGE_CLIENT_NAME,
        ...(authToken ? { [BRIDGE_AUTH_HEADER]: `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify(payload)
    });
  };

  let response;
  try {
    response = await sendSaveRequest(token);
  } catch (error) {
    throw new Error("没有连上 Obsidian 插件的本地保存接口。");
  }

  let data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    const settingsToRepair = settings || await loadSettings();
    const pairing = await ensureBridgeAuth(settingsToRepair, null, { forcePair: true });
    if (!pairing.ok) {
      throw new Error("本地保存接口需要重新配对，请打开设置页重新检查 Obsidian 插件连接。");
    }

    try {
      response = await sendSaveRequest(String(pairing.settings?.bridgeAuthToken || "").trim());
      data = await response.json().catch(() => ({}));
    } catch (error) {
      throw new Error("本地保存接口重连失败，请确认 Obsidian 与 EffecCol 插件仍在运行。");
    }
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `本地保存失败（HTTP ${response.status}）`);
  }

  return {
    notePath: data.notePath || payload.notePath || "",
    requestedImageCount: Number(data.requestedImageCount) || 0,
    downloadedImageCount: Number(data.downloadedImageCount) || 0,
    fallbackImageCount: Number(data.fallbackImageCount) || 0,
    imageResults: Array.isArray(data.imageResults) ? data.imageResults : [],
    debugSummary: String(data.debugSummary || "")
  };
}

async function copyCardToClipboard(text, html) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: "effecol:copy-card",
    text,
    html
  });

  if (!response?.ok) {
    throw new Error(response?.error || "剪贴板写入失败。");
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["CLIPBOARD"],
    justification: "Copy rich text knowledge cards for manual paste into whiteboard tools."
  });
}

async function showToast(tabId, message, kind) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [message, kind],
      func: (text, toastKind) => {
        const existingRoot = document.getElementById("__effecol-toast-root");
        if (existingRoot) {
          existingRoot.remove();
        }

        const root = document.createElement("div");
        root.id = "__effecol-toast-root";
        root.style.position = "fixed";
        root.style.top = "18px";
        root.style.right = "18px";
        root.style.zIndex = "2147483647";
        root.style.pointerEvents = "none";

        const toast = document.createElement("div");
        toast.textContent = text;
        toast.style.maxWidth = "360px";
        toast.style.padding = "12px 14px";
        toast.style.borderRadius = "14px";
        toast.style.boxShadow = "0 14px 30px rgba(30, 24, 18, 0.18)";
        toast.style.fontFamily = "-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif";
        toast.style.fontSize = "13px";
        toast.style.lineHeight = "1.5";
        toast.style.color = "#1f1b17";
        toast.style.background =
          toastKind === "success"
            ? "#e4f7ee"
            : toastKind === "error"
              ? "#fdeaea"
              : toastKind === "warning"
                ? "#fff3dd"
                : "#fff9f1";
        toast.style.border =
          toastKind === "success"
            ? "1px solid rgba(29,122,82,0.18)"
            : toastKind === "error"
              ? "1px solid rgba(178,56,40,0.18)"
              : toastKind === "warning"
                ? "1px solid rgba(159,91,12,0.18)"
                : "1px solid rgba(216,207,195,0.92)";

        root.appendChild(toast);
        document.documentElement.appendChild(root);

        window.setTimeout(() => {
          root.remove();
        }, 2600);
      }
    });
  } catch (error) {
    console.warn("Failed to show toast", error);
  }
}

async function openStatusPage(context, options = { openTab: true }) {
  latestStatusContext = context;
  await chrome.storage.local.set({
    [STATUS_STORAGE_KEY]: latestStatusContext
  });

  if (!options.openTab) {
    return;
  }

  const statusUrl = chrome.runtime.getURL(STATUS_PAGE_PATH);
  const tabs = await chrome.tabs.query({ url: STATUS_PAGE_MATCH_PATTERN });
  if (tabs[0]?.id) {
    await chrome.tabs.update(tabs[0].id, {
      url: `${statusUrl}?refresh=${Date.now()}`,
      active: true
    });
    return;
  }

  await chrome.tabs.create({ url: statusUrl });
}

function extractHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isCapturableUrl(url) {
  return /^https?:\/\//i.test(String(url || "").trim());
}
