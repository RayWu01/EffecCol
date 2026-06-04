const {
  AI_PROVIDER_PRESETS,
  ANTHROPIC_DEFAULT_MODEL,
  CLIPBOARD_CARD_PRESETS,
  DEFAULT_LOCAL_SETTINGS,
  DEFAULT_SYNC_SETTINGS,
  SUMMARY_LENGTH_PRESETS,
  SUMMARY_PREFERENCE_PRESETS,
  SUMMARY_STYLE_PRESETS,
  applyClipboardPreset,
  buildAiRequestBody,
  buildBoardCardHtml,
  buildBoardCardText,
  getProviderPreset,
  normalizeProviderCredentials,
  normalizeSettings,
  resolveAiEndpoint,
  resolveAiProvider
} = window.CaptureShared;

const aiProviderInput = document.getElementById("aiProvider");
const aiModelInput = document.getElementById("aiModel");
const aiApiKeyInput = document.getElementById("aiApiKey");
const aiEndpointInput = document.getElementById("aiEndpoint");
const aiSummaryInstructionInput = document.getElementById("aiSummaryInstruction");
const aiSummaryLengthInput = document.getElementById("aiSummaryLength");
const aiSummaryPreferenceInput = document.getElementById("aiSummaryPreference");
const aiSummaryStyleInput = document.getElementById("aiSummaryStyle");
const clipboardPresetInput = document.getElementById("clipboardPreset");
const clipboardTitleBoldInput = document.getElementById("clipboardTitleBold");
const clipboardIncludeNotePathInput = document.getElementById("clipboardIncludeNotePath");
const clipboardIncludeObsidianDeepLinkInput = document.getElementById("clipboardIncludeObsidianDeepLink");
const clipboardIncludeSourceUrlInput = document.getElementById("clipboardIncludeSourceUrl");
const clipboardIncludeSiteNameInput = document.getElementById("clipboardIncludeSiteName");
const clipboardIncludeCapturedAtInput = document.getElementById("clipboardIncludeCapturedAt");
const aiModelHint = document.getElementById("aiModelHint");
const aiApiKeyHint = document.getElementById("aiApiKeyHint");
const aiEndpointHint = document.getElementById("aiEndpointHint");
const clipboardPresetHint = document.getElementById("clipboardPresetHint");
const clipboardPreview = document.getElementById("clipboardPreview");
const aiStatus = document.getElementById("aiStatus");
const bridgeStatus = document.getElementById("bridgeStatus");
const settingsStatus = document.getElementById("settingsStatus");
const saveButton = document.getElementById("saveButton");
const resetButton = document.getElementById("resetButton");
const closeButton = document.getElementById("closeButton");
const checkBridgeButton = document.getElementById("checkBridgeButton");
const testAiButton = document.getElementById("testAiButton");

let state = {
  settings: normalizeSettings({})
};

bootstrap().catch((error) => {
  console.error(error);
  showSettingsStatus(`初始化失败：${error.message}`, "error");
});

async function bootstrap() {
  populateStaticOptions();

  const [syncSettings, localSettings] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS),
    chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS)
  ]);

  state.settings = normalizeSettings({
    ...DEFAULT_SYNC_SETTINGS,
    ...DEFAULT_LOCAL_SETTINGS,
    ...syncSettings,
    ...localSettings
  });

  applySettings(state.settings);
  bindEvents();
  await refreshBridgeStatus();
}

function populateStaticOptions() {
  fillSelect(aiProviderInput, AI_PROVIDER_PRESETS);
  fillSelect(clipboardPresetInput, CLIPBOARD_CARD_PRESETS);
  fillSelect(aiSummaryLengthInput, SUMMARY_LENGTH_PRESETS);
  fillSelect(aiSummaryPreferenceInput, SUMMARY_PREFERENCE_PRESETS);
  fillSelect(aiSummaryStyleInput, SUMMARY_STYLE_PRESETS);
}

function fillSelect(select, presetMap) {
  select.innerHTML = Object.entries(presetMap)
    .map(([value, preset]) => `<option value="${value}">${preset.label}</option>`)
    .join("");
}

function bindEvents() {
  saveButton.addEventListener("click", saveSettings);
  resetButton.addEventListener("click", resetSettings);
  closeButton.addEventListener("click", () => window.close());
  checkBridgeButton.addEventListener("click", refreshBridgeStatus);
  testAiButton.addEventListener("click", testAiConnection);

  aiProviderInput.addEventListener("change", handleProviderChange);
  clipboardPresetInput.addEventListener("change", handleClipboardPresetChange);

  [
    aiModelInput,
    aiApiKeyInput,
    aiEndpointInput,
    aiSummaryInstructionInput,
    aiSummaryLengthInput,
    aiSummaryPreferenceInput,
    aiSummaryStyleInput,
    clipboardTitleBoldInput,
    clipboardIncludeNotePathInput,
    clipboardIncludeObsidianDeepLinkInput,
    clipboardIncludeSourceUrlInput,
    clipboardIncludeSiteNameInput,
    clipboardIncludeCapturedAtInput
  ].forEach((element) => {
    element.addEventListener("input", handleFieldMutation);
    element.addEventListener("change", handleFieldMutation);
  });
}

function applySettings(settings) {
  const normalized = normalizeSettings(settings);
  state.settings = normalized;

  aiProviderInput.value = normalized.aiProvider;
  aiModelInput.value = normalized.aiModel;
  aiEndpointInput.value = normalized.aiEndpoint;
  aiSummaryInstructionInput.value = normalized.aiSummaryInstruction || "";
  aiSummaryLengthInput.value = normalized.aiSummaryLength;
  aiSummaryPreferenceInput.value = normalized.aiSummaryPreference;
  aiSummaryStyleInput.value = normalized.aiSummaryStyle;
  clipboardPresetInput.value = normalized.clipboardPreset;
  clipboardTitleBoldInput.checked = Boolean(normalized.clipboardTitleBold);
  clipboardIncludeNotePathInput.checked = Boolean(normalized.clipboardIncludeNotePath);
  clipboardIncludeObsidianDeepLinkInput.checked = Boolean(normalized.clipboardIncludeObsidianDeepLink);
  clipboardIncludeSourceUrlInput.checked = Boolean(normalized.clipboardIncludeSourceUrl);
  clipboardIncludeSiteNameInput.checked = Boolean(normalized.clipboardIncludeSiteName);
  clipboardIncludeCapturedAtInput.checked = Boolean(normalized.clipboardIncludeCapturedAt);

  syncApiKeyFromState();
  refreshProviderUi();
  refreshClipboardPreview();
}

function handleProviderChange() {
  const nextProvider = resolveAiProvider({ aiProvider: aiProviderInput.value });
  const currentSettings = collectSettings({ preserveProviderInput: false });
  const preset = getProviderPreset(nextProvider);
  const nextSettings = normalizeSettings({
    ...currentSettings,
    aiProvider: nextProvider,
    aiEndpoint:
      nextProvider === "custom"
        ? currentSettings.aiEndpoint || ""
        : preset.endpoint,
    aiModel:
      currentSettings.aiProvider === nextProvider && currentSettings.aiModel
        ? currentSettings.aiModel
        : preset.model
  });

  state.settings = nextSettings;
  applySettings(nextSettings);
}

function handleClipboardPresetChange() {
  const currentSettings = collectSettings();
  const nextSettings = normalizeSettings(applyClipboardPreset(clipboardPresetInput.value, currentSettings));
  state.settings = nextSettings;
  applySettings(nextSettings);
  showSettingsStatus("已按所选卡片预设更新字段，你还可以继续微调。", "info");
}

function handleFieldMutation() {
  state.settings = collectSettings();
  refreshProviderUi();
  refreshClipboardPreview();
}

function collectSettings(options = { preserveProviderInput: true }) {
  const provider = resolveAiProvider({
    aiProvider: options.preserveProviderInput ? aiProviderInput.value : state.settings.aiProvider
  });
  const credentials = normalizeProviderCredentials(
    state.settings.aiProviderCredentials,
    state.settings.aiApiKey
  );
  credentials[provider] = aiApiKeyInput.value.trim();

  return normalizeSettings({
    ...state.settings,
    aiProvider: provider,
    aiProviderCredentials: credentials,
    aiEndpoint: aiEndpointInput.value.trim(),
    aiModel: aiModelInput.value.trim(),
    aiSummaryInstruction: aiSummaryInstructionInput.value.trim(),
    aiSummaryLength: aiSummaryLengthInput.value,
    aiSummaryPreference: aiSummaryPreferenceInput.value,
    aiSummaryStyle: aiSummaryStyleInput.value,
    clipboardPreset: clipboardPresetInput.value,
    clipboardTitleBold: clipboardTitleBoldInput.checked,
    clipboardIncludeNotePath: clipboardIncludeNotePathInput.checked,
    clipboardIncludeObsidianDeepLink: clipboardIncludeObsidianDeepLinkInput.checked,
    clipboardIncludeSourceUrl: clipboardIncludeSourceUrlInput.checked,
    clipboardIncludeSiteName: clipboardIncludeSiteNameInput.checked,
    clipboardIncludeCapturedAt: clipboardIncludeCapturedAtInput.checked
  });
}

function syncApiKeyFromState() {
  const provider = resolveAiProvider(state.settings);
  const credentials = normalizeProviderCredentials(state.settings.aiProviderCredentials, state.settings.aiApiKey);
  aiApiKeyInput.value = credentials[provider] || "";
}

function refreshProviderUi() {
  const settings = collectSettings();
  const provider = resolveAiProvider(settings);
  const preset = getProviderPreset(provider);
  const isCustom = provider === "custom";

  aiModelHint.textContent = isCustom
    ? "自定义兼容接口需要你自己确认模型名。"
    : `默认推荐模型：${preset.model || "请手动填写"}`;
  aiApiKeyHint.textContent = `当前会保存 ${preset.label} 的 API Key，切换厂商时不会丢失你之前填过的 Key。`;
  aiEndpointHint.textContent = isCustom
    ? "自定义兼容接口时必须填写完整的 Chat Completions 或 Messages endpoint。"
    : "普通情况下不需要改。只有你要切到兼容代理或自建服务时，再手动覆盖。";
  clipboardPresetHint.textContent = compareSettingsWithPreset(settings)
    ? "你已基于这个预设做了微调。"
    : "当前字段与该预设保持一致。";

  aiEndpointInput.placeholder = preset.endpoint || "https://...";
  if (!isCustom && !aiEndpointInput.value.trim()) {
    aiEndpointInput.value = preset.endpoint || "";
  }
  if (!aiModelInput.value.trim()) {
    aiModelInput.value = preset.model || "";
  }
}

function compareSettingsWithPreset(settings) {
  const preset = CLIPBOARD_CARD_PRESETS[settings.clipboardPreset];
  if (!preset) {
    return false;
  }

  return Object.entries(preset.values).some(([key, value]) => settings[key] !== value);
}

function refreshClipboardPreview() {
  const settings = collectSettings();
  const samplePayload = {
    title: "优秀AI产品的七大设计原则",
    url: "https://www.woshipm.com/pd/3119367.html",
    siteName: "人人都是产品经理",
    aiSummary:
      "AI 产品设计的关键不只是能力强弱，而是用户是否理解、信任并正确使用它。文章强调可解释性、预期管理、边缘情况测试与反馈闭环。",
    capturedAt: new Date("2026-06-03T09:30:00+08:00")
  };
  const sampleSettings = {
    ...settings,
    bridgeVaultName: "Obsidian Vault",
    bridgeVaultPath: "/Users/example/Obsidian Vault"
  };
  const notePath = "EffecCol/优秀AI产品的七大设计原则.md";

  clipboardPreview.textContent = buildBoardCardText(samplePayload, sampleSettings, notePath);
}

async function saveSettings() {
  const settings = collectSettings();
  const validation = validateSettings(settings);
  if (!validation.ok) {
    showSettingsStatus(validation.message, "error");
    return;
  }

  const granted = await ensureApiPermission(settings);
  if (!granted) {
    showSettingsStatus("没有拿到这个 API 域名的网络权限，请检查 endpoint 或重新授权。", "warning");
    return;
  }

  await chrome.storage.sync.set({
    aiProvider: settings.aiProvider,
    aiEndpoint: resolveAiEndpoint(settings),
    aiModel: settings.aiModel,
    aiSummaryInstruction: settings.aiSummaryInstruction,
    clipboardPreset: settings.clipboardPreset,
    clipboardTitleBold: settings.clipboardTitleBold,
    clipboardIncludeNotePath: settings.clipboardIncludeNotePath,
    clipboardIncludeObsidianDeepLink: settings.clipboardIncludeObsidianDeepLink,
    clipboardIncludeSourceUrl: settings.clipboardIncludeSourceUrl,
    clipboardIncludeSiteName: settings.clipboardIncludeSiteName,
    clipboardIncludeCapturedAt: settings.clipboardIncludeCapturedAt,
    aiSummaryLength: settings.aiSummaryLength,
    aiSummaryPreference: settings.aiSummaryPreference,
    aiSummaryStyle: settings.aiSummaryStyle
  });

  await chrome.storage.local.set({
    aiProviderCredentials: settings.aiProviderCredentials,
    aiApiKey: settings.aiProviderCredentials.deepseek || ""
  });

  state.settings = settings;
  showSettingsStatus("设置已保存。现在点击图标时，会按你当前的 AI 与卡片配置静默保存。", "success");
}

function validateSettings(settings) {
  const provider = resolveAiProvider(settings);
  const preset = getProviderPreset(provider);
  const currentApiKey = String(settings.aiProviderCredentials?.[provider] || "").trim();

  if (!currentApiKey) {
    return {
      ok: false,
      message: `请先填写 ${preset.label} 的 API Key。`
    };
  }

  if (!String(settings.aiModel || "").trim()) {
    return {
      ok: false,
      message: "请先填写模型名。"
    };
  }

  if (provider === "custom" && !String(settings.aiEndpoint || "").trim()) {
    return {
      ok: false,
      message: "自定义兼容接口必须填写 API Endpoint。"
    };
  }

  return { ok: true };
}

async function resetSettings() {
  const resetSettings = normalizeSettings({
    ...DEFAULT_SYNC_SETTINGS,
    ...DEFAULT_LOCAL_SETTINGS
  });

  await chrome.storage.sync.set(DEFAULT_SYNC_SETTINGS);
  await chrome.storage.local.set(DEFAULT_LOCAL_SETTINGS);

  state.settings = resetSettings;
  applySettings(resetSettings);
  showSettingsStatus("已恢复默认设置。", "info");
}

async function refreshBridgeStatus() {
  showStatusBox(bridgeStatus, "正在检查 Obsidian 插件连接状态...", "info");

  try {
    const settings = collectSettings();
    const response = await chrome.runtime.sendMessage({
      type: "effecol:diagnose-environment",
      scope: "bridge",
      requestPermissions: true,
      pairBridge: true,
      settings
    });

    if (!response?.ok || !response.diagnosis) {
      throw new Error(response?.error || "无法获取 Obsidian 连接诊断结果。");
    }

    const diagnosis = response.diagnosis;
    if (!diagnosis.ok) {
      const details = Array.isArray(diagnosis.details) ? diagnosis.details.join(" ") : "";
      showStatusBox(
        bridgeStatus,
        `${diagnosis.message}${details ? ` ${details}` : ""}`,
        diagnosis.needsSetup ? "warning" : "error"
      );
      return;
    }

    const data = diagnosis.bridge?.data || {};
    const folderText = data.folderPath ? `当前写入位置：${data.folderPath}` : "当前写入位置未知";
    const vaultText = data.vaultName ? `；当前 Vault：${data.vaultName}` : "";
    const pairText = diagnosis.settings?.bridgeAuthPairedAt ? `；已配对：${formatPairedAt(diagnosis.settings.bridgeAuthPairedAt)}` : "";
    showStatusBox(bridgeStatus, `Obsidian 插件连接正常。${folderText}${vaultText}${pairText}`, "success");
  } catch (error) {
    showStatusBox(
      bridgeStatus,
      "没有连上 Obsidian 插件。若你还没安装 Obsidian，请先安装桌面端；若已安装，请打开 Obsidian，并在当前 Vault 启用 EffecCol 插件后再重试。",
      "warning"
    );
  }
}

async function testAiConnection() {
  const settings = collectSettings();
  const validation = validateSettings(settings);
  if (!validation.ok) {
    showStatusBox(aiStatus, validation.message, "error");
    return;
  }

  const granted = await ensureApiPermission(settings);
  if (!granted) {
    showStatusBox(aiStatus, "没有拿到这个 API 域名的网络权限，请检查 endpoint 或重新授权。", "warning");
    return;
  }

  showStatusBox(aiStatus, "正在测试 AI 连接...", "info");

  try {
    const provider = resolveAiProvider(settings);
    const preset = getProviderPreset(provider);
    const apiKey = settings.aiProviderCredentials?.[provider] || "";
    const endpoint = resolveAiEndpoint(settings);
    const requestBody = buildAiRequestBody({
      title: "EffecCol 连接测试",
      url: "https://effecol.local/test",
      siteName: "EffecCol",
      sourceExcerpt: "请返回一句简短中文确认。",
      sourceContent: "这是一条用于检测当前 AI 设置是否可用的测试请求。"
    }, settings);
    const headers = buildAiHeaders(provider, apiKey);

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody)
    });
    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(rawText.slice(0, 200) || `HTTP ${response.status}`);
    }

    showStatusBox(aiStatus, `AI 连接正常，当前使用 ${preset.label} / ${settings.aiModel}。`, "success");
  } catch (error) {
    showStatusBox(aiStatus, `AI 连接失败：${error.message}`, "error");
  }
}

function buildAiHeaders(provider, apiKey) {
  if (provider === "anthropic") {
    return {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`
  };
}

async function ensureApiPermission(settings) {
  try {
    const originPattern = `${new URL(resolveAiEndpoint(settings)).origin}/*`;
    const alreadyGranted = await chrome.permissions.contains({
      origins: [originPattern]
    });

    if (alreadyGranted) {
      return true;
    }

    return chrome.permissions.request({
      origins: [originPattern]
    });
  } catch (error) {
    console.error(error);
    showSettingsStatus("API Endpoint 不是有效 URL，请检查后再保存。", "error");
    return false;
  }
}

function showSettingsStatus(message, type = "info") {
  showStatusBox(settingsStatus, message, type);
}

function showStatusBox(element, message, type = "info") {
  element.textContent = message;
  element.className = `status-box ${type} visible`;
}

function formatPairedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
