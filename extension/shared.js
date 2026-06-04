(function () {
  const root =
    typeof globalThis !== "undefined"
      ? globalThis
      : typeof self !== "undefined"
        ? self
        : window;
  const DEFAULT_FOLDER = "EffecCol";
  const DEFAULT_PROVIDER = "deepseek";
  const DEFAULT_ENDPOINT = "https://api.deepseek.com/chat/completions";
  const DEFAULT_MODEL = "deepseek-chat";
  const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
  const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
  const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
  const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-20250514";
  const AI_FALLBACK_SUMMARY = "AI 摘要生成失败，先保留原文摘录。";
  const NOTE_SOURCE_CONTENT_LIMIT = 22000;

  const AI_PROVIDER_PRESETS = {
    deepseek: {
      label: "DeepSeek",
      endpoint: DEFAULT_ENDPOINT,
      model: DEFAULT_MODEL,
      apiStyle: "openai"
    },
    openai: {
      label: "OpenAI",
      endpoint: OPENAI_ENDPOINT,
      model: OPENAI_DEFAULT_MODEL,
      apiStyle: "openai"
    },
    anthropic: {
      label: "Anthropic",
      endpoint: ANTHROPIC_ENDPOINT,
      model: ANTHROPIC_DEFAULT_MODEL,
      apiStyle: "anthropic"
    },
    custom: {
      label: "OpenAI 兼容接口（自定义）",
      endpoint: "",
      model: "",
      apiStyle: "openai"
    }
  };

  const CLIPBOARD_CARD_PRESETS = {
    minimal: {
      label: "极简",
      values: {
        clipboardTitleBold: true,
        clipboardIncludeNotePath: false,
        clipboardIncludeObsidianDeepLink: false,
        clipboardIncludeSourceUrl: false,
        clipboardIncludeSiteName: false,
        clipboardIncludeCapturedAt: false
      }
    },
    standard: {
      label: "标准",
      values: {
        clipboardTitleBold: true,
        clipboardIncludeNotePath: true,
        clipboardIncludeObsidianDeepLink: false,
        clipboardIncludeSourceUrl: true,
        clipboardIncludeSiteName: false,
        clipboardIncludeCapturedAt: false
      }
    }
  };

  const SUMMARY_LENGTH_PRESETS = {
    one_sentence: {
      label: "一句话",
      instruction: "输出 1 到 2 句，总长度尽量控制在 70 个汉字以内。"
    },
    short: {
      label: "短摘要",
      instruction: "输出 3 到 5 行高密度摘要，总长度尽量控制在 120 到 220 个汉字。"
    },
    detailed: {
      label: "详细摘要",
      instruction: "输出 5 到 7 行高密度摘要，总长度尽量控制在 220 到 380 个汉字。"
    }
  };

  const SUMMARY_PREFERENCE_PRESETS = {
    knowledge_card: {
      label: "知识卡",
      instruction: "优先提炼能直接放进知识卡的核心观点、关键判断和可复用表达。"
    },
    key_points: {
      label: "要点提炼",
      instruction: "优先提炼作者最重要的 3 到 5 个信息点，减少铺垫。"
    },
    action_insight: {
      label: "行动启发",
      instruction: "优先提炼能指导后续行动、实践或继续研究的启发。"
    },
    critical_reading: {
      label: "批判性总结",
      instruction: "在忠于原文的前提下，优先指出论证重点、适用边界和潜在局限。"
    },
    product_view: {
      label: "产品视角",
      instruction: "优先提炼产品思路、用户价值、机制设计和适用场景。"
    }
  };

  const SUMMARY_STYLE_PRESETS = {
    none: {
      label: "关闭",
      instruction: ""
    },
    feynman: {
      label: "费曼式",
      instruction: "尽量用朴素、直接、少术语的方式表达，让聪明外行也能迅速理解。"
    },
    munger: {
      label: "芒格式",
      instruction: "更关注判断框架、长期后果、激励结构和常见误判。"
    },
    pg: {
      label: "PG式",
      instruction: "更关注核心论点、反常识点、独立思考和真正重要的问题。"
    },
    karpathy: {
      label: "卡帕西式",
      instruction: "更关注第一性原理、工程现实、能力边界和真正可工作的做法。"
    }
  };

  const DEFAULT_SYNC_SETTINGS = {
    aiProvider: DEFAULT_PROVIDER,
    aiEndpoint: DEFAULT_ENDPOINT,
    aiModel: DEFAULT_MODEL,
    aiSummaryInstruction: "",
    clipboardPreset: "standard",
    clipboardTitleBold: true,
    clipboardIncludeNotePath: true,
    clipboardIncludeObsidianDeepLink: false,
    clipboardIncludeSourceUrl: true,
    clipboardIncludeSiteName: false,
    clipboardIncludeCapturedAt: false,
    aiSummaryLength: "short",
    aiSummaryPreference: "knowledge_card",
    aiSummaryStyle: "none"
  };

  const DEFAULT_LOCAL_SETTINGS = {
    aiApiKey: "",
    bridgeAuthPairedAt: "",
    bridgeAuthToken: "",
    aiProviderCredentials: {
      deepseek: "",
      openai: "",
      anthropic: "",
      custom: ""
    }
  };

  function getProviderPreset(provider) {
    return AI_PROVIDER_PRESETS[provider] || AI_PROVIDER_PRESETS[DEFAULT_PROVIDER];
  }

  function resolveAiProvider(settings) {
    const provider = String(settings?.aiProvider || DEFAULT_PROVIDER).trim();
    return AI_PROVIDER_PRESETS[provider] ? provider : DEFAULT_PROVIDER;
  }

  function normalizeProviderCredentials(value, legacyKey = "") {
    const credentials = {
      ...DEFAULT_LOCAL_SETTINGS.aiProviderCredentials
    };

    if (value && typeof value === "object") {
      for (const key of Object.keys(credentials)) {
        credentials[key] = String(value[key] || "").trim();
      }
    }

    if (!credentials.deepseek && legacyKey) {
      credentials.deepseek = String(legacyKey || "").trim();
    }

    return credentials;
  }

  function normalizeSettings(input = {}) {
    const merged = {
      ...DEFAULT_SYNC_SETTINGS,
      ...DEFAULT_LOCAL_SETTINGS,
      ...(input || {})
    };

    const provider = resolveAiProvider(merged);
    const endpoint = String(merged.aiEndpoint || "").trim() || getProviderPreset(provider).endpoint || DEFAULT_ENDPOINT;
    const model = String(merged.aiModel || "").trim() || getProviderPreset(provider).model || DEFAULT_MODEL;
    const credentials = normalizeProviderCredentials(merged.aiProviderCredentials, merged.aiApiKey);
    const preset = CLIPBOARD_CARD_PRESETS[merged.clipboardPreset] ? merged.clipboardPreset : DEFAULT_SYNC_SETTINGS.clipboardPreset;

    return {
      ...merged,
      aiProvider: provider,
      aiEndpoint: endpoint,
      aiModel: model,
      aiProviderCredentials: credentials,
      aiApiKey: credentials.deepseek || ""
    };
  }

  function applyClipboardPreset(presetKey, settings = {}) {
    const preset = CLIPBOARD_CARD_PRESETS[presetKey] || CLIPBOARD_CARD_PRESETS[DEFAULT_SYNC_SETTINGS.clipboardPreset];
    return {
      ...settings,
      clipboardPreset: presetKey in CLIPBOARD_CARD_PRESETS ? presetKey : DEFAULT_SYNC_SETTINGS.clipboardPreset,
      ...preset.values
    };
  }

  function basenameFromPath(value) {
    return String(value || "")
      .replace(/[\\\/]+$/, "")
      .split(/[\\\/]/)
      .filter(Boolean)
      .pop() || "";
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatDate(date = new Date()) {
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("-");
  }

  function formatTime(date = new Date()) {
    return [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
  }

  function formatDateTime(date = new Date()) {
    return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function slugifyTitle(value) {
    return (value || "untitled")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .toLowerCase()
      .slice(0, 72) || "untitled";
  }

  function normalizeMultilineText(value, maxLength = 1200) {
    return (value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxLength);
  }

  function joinNotePath(folder, fileName) {
    const normalizedFolder = (folder || DEFAULT_FOLDER)
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    const normalizedFileName = fileName.endsWith(".md") ? fileName : `${fileName}.md`;
    return normalizedFolder ? `${normalizedFolder}/${normalizedFileName}` : normalizedFileName;
  }

  function buildNoteFileName(title, date = new Date()) {
    return String(title || "untitled")
      .replace(/[\/\\]/g, "-")
      .replace(/:/g, "：")
      .replace(/\?/g, "？")
      .replace(/\*/g, "＊")
      .replace(/"/g, "＂")
      .replace(/</g, "＜")
      .replace(/>/g, "＞")
      .replace(/\|/g, "｜")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 120);
  }

  function buildNotePath(title, date = new Date()) {
    return joinNotePath(DEFAULT_FOLDER, buildNoteFileName(title, date));
  }

  function buildCaptureId(title, date = new Date()) {
    const datePart = [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("");
    const timePart = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
    const slug = slugifyTitle(title).slice(0, 24) || "capture";
    return `${datePart}${timePart}-${slug}`;
  }

  function buildAssetFolderPath(title, date = new Date(), captureId = "") {
    const monthBucket = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    const articleFolder = `${buildNoteFileName(title, date).slice(0, 60) || "untitled"}--${String(captureId || buildCaptureId(title, date)).slice(0, 12)}`;
    return joinNotePath(`${DEFAULT_FOLDER}/_assets/${monthBucket}`, articleFolder).replace(/\.md$/i, "");
  }

  function yamlQuote(value) {
    return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  function yamlOptionalScalar(key, value) {
    return value ? `${key}: ${yamlQuote(value)}` : `${key}:`;
  }

  function yamlListBlock(key, values) {
    const items = (values || []).filter(Boolean);
    if (!items.length) {
      return [`${key}: []`];
    }

    return [
      `${key}:`,
      ...items.map((item) => `  - ${yamlQuote(item)}`)
    ];
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildObsidianCreateUri(vaultName, notePath, content) {
    return [
      "obsidian://new?",
      `vault=${encodeURIComponent(vaultName)}`,
      `file=${encodeURIComponent(notePath)}`,
      `content=${encodeURIComponent(content)}`
    ].join("&");
  }

  function buildObsidianOpenUri(vaultName, notePath) {
    return [
      "obsidian://open?",
      `vault=${encodeURIComponent(vaultName)}`,
      `file=${encodeURIComponent(notePath)}`
    ].join("&");
  }

  function buildNoteContent(payload, settings, notePath) {
    const createdDate = formatDate(payload.capturedAt);
    const summary = normalizeMultilineText(payload.aiSummary, 1600) || AI_FALLBACK_SUMMARY;
    const excerpt = normalizeMultilineText(payload.sourceExcerpt, 1800);
    const sourceContent = renderSourceBlocks(payload) ||
      normalizeMultilineText(payload.sourceContent, NOTE_SOURCE_CONTENT_LIMIT) ||
      excerpt ||
      "未提取到可用原文。";
    const author = normalizeMultilineText(payload.author, 300);
    const description = normalizeMultilineText(payload.description, 600);
    const published = normalizeMultilineText(payload.published, 120);
    const authorLinks = author ? [`[[${author}]]`] : [];
    const tags = ["effecol"];
    const captureId = payload.captureId || buildCaptureId(payload.title, payload.capturedAt);

    const frontmatter = [
      "---",
      `title: ${yamlQuote(payload.title)}`,
      `source: ${yamlQuote(payload.url)}`,
      `capture_id: ${yamlQuote(captureId)}`,
      ...yamlListBlock("author", authorLinks),
      yamlOptionalScalar("published", published),
      `created: ${createdDate}`,
      yamlOptionalScalar("description", description),
      ...yamlListBlock("tags", tags),
      "---"
    ].join("\n");

    const sections = [
      frontmatter,
      "",
      `# ${payload.title}`,
      "",
      "## AI 摘要",
      summary,
      "",
      "## 网页原文",
      sourceContent
    ];

    if (excerpt && excerpt !== sourceContent) {
      sections.push("", "## 关键摘录", `> ${excerpt.replace(/\n/g, "\n> ")}`);
    }

    sections.push("", "## 原始链接", payload.url);
    return sections.join("\n");
  }

  function renderSourceBlocks(payload) {
    const blocks = Array.isArray(payload.contentBlocks) ? payload.contentBlocks : [];
    if (!blocks.length) {
      return "";
    }

    const rendered = [];
    for (const block of blocks) {
      const markdown = renderContentBlock(block);
      if (markdown) {
        rendered.push(markdown);
      }
    }

    return rendered.join("\n\n").trim();
  }

  function renderContentBlock(block) {
    if (!block || typeof block !== "object") {
      return "";
    }

    if (block.type === "image") {
      return renderImageBlock(block);
    }

    const text = normalizeMultilineText(block.text || "", 4000);
    if (!text) {
      return "";
    }

    if (block.type === "heading") {
      const level = Math.min(Math.max(Number(block.level) || 2, 2), 4);
      return `${"#".repeat(level)} ${text}`;
    }

    if (block.type === "blockquote") {
      return `> ${text.replace(/\n/g, "\n> ")}`;
    }

    if (block.type === "list") {
      return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join("\n");
    }

    return text;
  }

  function renderImageBlock(block) {
    const vaultAssetPath = normalizeMultilineText(block.assetVaultPath || "", 400);
    const sourceUrl = normalizeMultilineText(block.sourceUrl || "", 1200);

    if (vaultAssetPath) {
      return `![[${vaultAssetPath}]]`;
    }

    if (sourceUrl) {
      const alt = normalizeMultilineText(block.alt || "", 200);
      return alt ? `![${alt}](${sourceUrl})` : `![](${sourceUrl})`;
    }

    return "";
  }

  function buildBoardCardSections(payload, settings, notePath) {
    const resolvedSettings = normalizeSettings(settings);
    const vaultName =
      normalizeMultilineText(resolvedSettings.bridgeVaultName || "", 200) ||
      normalizeMultilineText(resolvedSettings.vaultName || "", 200) ||
      basenameFromPath(resolvedSettings.bridgeVaultPath || "");
    const noteOpenUri = vaultName ? buildObsidianOpenUri(vaultName, notePath) : "";
    const summary = normalizeMultilineText(payload.aiSummary, 500) || AI_FALLBACK_SUMMARY;
    const notePathText = notePath || "本地已保存";
    const capturedAtText = payload.capturedAt ? formatDateTime(payload.capturedAt) : "";
    const sections = {
      title: payload.title || "未命名内容",
      summary,
      notePath: notePathText,
      noteOpenUri,
      sourceUrl: payload.url || "",
      siteName: payload.siteName || "",
      capturedAt: capturedAtText
    };

    const lines = [];
    if (resolvedSettings.clipboardIncludeSiteName && sections.siteName) {
      lines.push(`站点：${sections.siteName}`);
    }
    if (resolvedSettings.clipboardIncludeCapturedAt && sections.capturedAt) {
      lines.push(`抓取时间：${sections.capturedAt}`);
    }
    if (resolvedSettings.clipboardIncludeNotePath && sections.notePath) {
      lines.push(`Obsidian路径：${sections.notePath}`);
    }
    if (resolvedSettings.clipboardIncludeObsidianDeepLink) {
      lines.push(sections.noteOpenUri ? `Obsidian链接：${sections.noteOpenUri}` : "Obsidian链接：本地已保存，暂不可用");
    }
    if (resolvedSettings.clipboardIncludeSourceUrl && sections.sourceUrl) {
      lines.push(`原文链接：${sections.sourceUrl}`);
    }

    return {
      ...sections,
      metaLines: lines
    };
  }

  function buildBoardCardText(payload, settings, notePath) {
    const sections = buildBoardCardSections(payload, settings, notePath);
    return [
      sections.title,
      "",
      "AI摘要",
      sections.summary,
      ...(sections.metaLines.length ? ["", ...sections.metaLines] : [])
    ].join("\n");
  }

  function buildBoardCardHtml(payload, settings, notePath) {
    const resolvedSettings = normalizeSettings(settings);
    const sections = buildBoardCardSections(payload, resolvedSettings, notePath);
    const titleHtml = resolvedSettings.clipboardTitleBold
      ? `<div style="font-size: 16px; font-weight: 700; margin-bottom: 10px;">${escapeHtml(sections.title)}</div>`
      : `<div style="font-size: 16px; margin-bottom: 10px;">${escapeHtml(sections.title)}</div>`;
    const metaHtml = sections.metaLines
      .map((line) => {
        if (line.startsWith("Obsidian链接：") && sections.noteOpenUri) {
          return `<div><span style="color: #7a7066;">Obsidian链接：</span><a href="${escapeHtml(sections.noteOpenUri)}" style="color: #8e451f; text-decoration: none;">${escapeHtml(sections.noteOpenUri)}</a></div>`;
        }
        if (line.startsWith("原文链接：") && sections.sourceUrl) {
          return `<div><span style="color: #7a7066;">原文链接：</span><a href="${escapeHtml(sections.sourceUrl)}" style="color: #8e451f; text-decoration: none;">${escapeHtml(sections.sourceUrl)}</a></div>`;
        }
        return `<div>${escapeHtml(line)}</div>`;
      })
      .join("");

    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; max-width: 420px; border: 1px solid #e1d6c9; border-radius: 14px; padding: 16px; background: #fff9f1; color: #1d1a17;">
        ${titleHtml}
        <div style="font-size: 13px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(sections.summary)}</div>
        ${metaHtml ? `<div style="height: 14px;"></div><div style="font-size: 13px; line-height: 1.7;">${metaHtml}</div>` : ""}
      </div>
    `.trim();
  }

  function resolveAiEndpoint(settings) {
    const resolvedSettings = normalizeSettings(settings);
    const endpoint = (resolvedSettings.aiEndpoint || "").trim();
    if (!endpoint) {
      return getProviderPreset(resolvedSettings.aiProvider).endpoint || DEFAULT_ENDPOINT;
    }
    if (endpoint === "https://api.deepseek.com") {
      return DEFAULT_ENDPOINT;
    }
    return endpoint;
  }

  function buildSystemPrompt(settings = {}) {
    const resolvedSettings = normalizeSettings(settings);
    const lengthPreset = SUMMARY_LENGTH_PRESETS[resolvedSettings.aiSummaryLength] || SUMMARY_LENGTH_PRESETS.short;
    const preferencePreset = SUMMARY_PREFERENCE_PRESETS[resolvedSettings.aiSummaryPreference] || SUMMARY_PREFERENCE_PRESETS.knowledge_card;
    const stylePreset = SUMMARY_STYLE_PRESETS[resolvedSettings.aiSummaryStyle] || SUMMARY_STYLE_PRESETS.none;
    const extraInstruction = String(resolvedSettings.aiSummaryInstruction || "").trim();
    const baseInstruction = [
      "你是一个帮助用户沉淀高价值网页内容的研究助理。",
      "请基于标题、链接、站点信息和摘录，输出中文摘要。",
      "要求：",
      `1. ${lengthPreset.instruction}`,
      `2. ${preferencePreset.instruction}`,
      "3. 不要使用项目符号，不要输出多余解释。",
      "4. 必须忠于原文，不补充原文未明确表达的事实。",
      "5. 如果材料不完整，明确保留不确定性，不要编造。"
    ].join("\n");

    const extensions = [];
    if (stylePreset.instruction) {
      extensions.push(`风格要求：${stylePreset.instruction}`);
    }
    if (extraInstruction) {
      extensions.push(`额外要求：${extraInstruction}`);
    }

    return extensions.length
      ? `${baseInstruction}\n${extensions.join("\n")}`
      : baseInstruction;
  }

  function buildUserPrompt(payload) {
    const sourceExcerpt = normalizeMultilineText(payload.sourceExcerpt, 1800);
    const sourceContent = normalizeMultilineText(payload.sourceContent, 5200);
    return [
      `标题：${payload.title}`,
      `链接：${payload.url}`,
      `来源：${payload.siteName || "未知"}`,
      "",
      "关键摘录：",
      sourceExcerpt || "没有额外摘录。",
      "",
      "网页原文（节选）：",
      sourceContent || "没有额外正文。请仅根据标题和链接上下文做尽量保守的摘要。"
    ].join("\n");
  }

  function buildAiRequestBody(payload, settings) {
    const resolvedSettings = normalizeSettings(settings);
    const provider = resolveAiProvider(resolvedSettings);
    const preset = getProviderPreset(provider);

    if (preset.apiStyle === "anthropic") {
      return {
        model: (resolvedSettings.aiModel || preset.model || ANTHROPIC_DEFAULT_MODEL).trim() || ANTHROPIC_DEFAULT_MODEL,
        max_tokens: 700,
        temperature: 0.2,
        system: buildSystemPrompt(resolvedSettings),
        messages: [
          {
            role: "user",
            content: buildUserPrompt(payload)
          }
        ]
      };
    }

    return {
      model: (resolvedSettings.aiModel || preset.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
      temperature: 0.2,
      stream: false,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(resolvedSettings)
        },
        {
          role: "user",
          content: buildUserPrompt(payload)
        }
      ]
    };
  }

  function extractModelText(data) {
    const chatCompletionText = data?.choices?.[0]?.message?.content;
    if (typeof chatCompletionText === "string") {
      return normalizeMultilineText(chatCompletionText, 1600);
    }

    if (Array.isArray(chatCompletionText)) {
      const joined = chatCompletionText
        .map((item) => item?.text || item?.content || "")
        .join("\n")
        .trim();
      if (joined) {
        return normalizeMultilineText(joined, 1600);
      }
    }

    if (typeof data?.output_text === "string" && data.output_text.trim()) {
      return normalizeMultilineText(data.output_text, 1600);
    }

    const outputBlocks = data?.output?.flatMap((item) => item?.content || []) || [];
    const outputText = outputBlocks
      .map((item) => item?.text || "")
      .join("\n")
      .trim();

    return outputText ? normalizeMultilineText(outputText, 1600) : "";
  }

  function looksLikeFilePath(value) {
    return /^\/|^[A-Za-z]:\\/.test(value || "");
  }

  root.CaptureShared = {
    AI_FALLBACK_SUMMARY,
    AI_PROVIDER_PRESETS,
    CLIPBOARD_CARD_PRESETS,
    DEFAULT_ENDPOINT,
    DEFAULT_FOLDER,
    DEFAULT_LOCAL_SETTINGS,
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    DEFAULT_SYNC_SETTINGS,
    NOTE_SOURCE_CONTENT_LIMIT,
    OPENAI_ENDPOINT,
    OPENAI_DEFAULT_MODEL,
    ANTHROPIC_ENDPOINT,
    ANTHROPIC_DEFAULT_MODEL,
    SUMMARY_LENGTH_PRESETS,
    SUMMARY_PREFERENCE_PRESETS,
    SUMMARY_STYLE_PRESETS,
    applyClipboardPreset,
    buildAiRequestBody,
    buildBoardCardHtml,
    buildBoardCardText,
    buildCaptureId,
    buildAssetFolderPath,
    buildNoteContent,
    buildNoteFileName,
    buildNotePath,
    basenameFromPath,
    buildObsidianCreateUri,
    buildObsidianOpenUri,
    buildSystemPrompt,
    buildUserPrompt,
    escapeHtml,
    extractModelText,
    formatDate,
    formatDateTime,
    formatTime,
    getProviderPreset,
    joinNotePath,
    looksLikeFilePath,
    normalizeProviderCredentials,
    normalizeSettings,
    normalizeMultilineText,
    resolveAiProvider,
    resolveAiEndpoint,
    slugifyTitle
  };
})();
