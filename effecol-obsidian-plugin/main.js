"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const { Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } = require("obsidian");

const DEFAULT_PORT = 27124;
const DEFAULT_FOLDER = "EffecCol";
const PLUGIN_ID = "effecol";
const STATUS_FILE_RELATIVE_PATH = normalizePath(`.obsidian/plugins/${PLUGIN_ID}/status.json`);
const DEFAULT_SETTINGS = {
  authToken: "",
  lastPairedAt: "",
  lastPairedClient: ""
};

class EffecColPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new EffecColSettingTab(this.app, this));
    await this.updateStatus({
      state: "loading",
      lastStartupAttemptAt: new Date().toISOString(),
      startupError: ""
    });

    try {
      await this.startServer();
      await this.updateStatus({
        state: "ready",
        lastStartupSuccessAt: new Date().toISOString(),
        startupError: ""
      });
      new Notice("EffecCol 已就绪，可以从浏览器静默保存。");
    } catch (error) {
      console.error("[EffecCol Plugin] Failed to start local server", error);
      await this.updateStatus({
        state: "startup-error",
        lastStartupFailedAt: new Date().toISOString(),
        startupError: error.message || "Unknown startup error"
      });
      new Notice(`EffecCol 启动失败：${error.message}`);
    }
  }

  async onunload() {
    try {
      await this.stopServer();
    } finally {
      await this.updateStatus({
        state: "stopped",
        lastStoppedAt: new Date().toISOString()
      });
    }
  }

  async startServer() {
    if (this.server) {
      return;
    }

    await this.updateStatus({
      state: "starting",
      lastStartupAttemptAt: new Date().toISOString(),
      startupError: ""
    });

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        void this.handleRequestFailure(req, res, error);
      });
    });

    this.server.on("close", () => {
      void this.updateStatus({
        state: "stopped",
        lastStoppedAt: new Date().toISOString()
      });
    });

    await new Promise((resolve, reject) => {
      const handleError = (error) => {
        this.server?.off("error", handleError);
        reject(error);
      };

      this.server.once("error", handleError);
      this.server.listen(DEFAULT_PORT, "127.0.0.1", () => {
        this.server?.off("error", handleError);
        console.log(`[EffecCol Plugin] Listening on http://127.0.0.1:${DEFAULT_PORT}`);
        resolve();
      });
    });
  }

  async stopServer() {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;

    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async handleRequestFailure(req, res, error) {
    console.error("[EffecCol Plugin] Request failed", error);
    await this.updateStatus({
      state: "request-error",
      lastRequestErrorAt: new Date().toISOString(),
      lastError: error.message || "Unknown plugin error",
      lastRequest: {
        method: req.method || "",
        path: req.url || ""
      }
    });

    if (!res.headersSent) {
      this.writeJson(res, 500, {
        ok: false,
        error: error.message || "Unknown plugin error"
      });
    }
  }

  async handleRequest(req, res) {
    if (req.method === "OPTIONS") {
      this.writeJson(res, 204, {});
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      const folder = this.getFolderName();
      const folderPath = this.getFolderAbsolutePath();
      this.writeJson(res, 200, {
        ok: true,
        vaultName: this.getVaultName(),
        vaultPath: this.getVaultBasePath(),
        folder,
        folderPath,
        authRequired: true,
        paired: Boolean(this.settings?.authToken),
        lastPairedAt: this.settings?.lastPairedAt || "",
        lastPairedClient: this.settings?.lastPairedClient || "",
        statusFilePath: this.getStatusFileAbsolutePath(),
        status: this.status || null
      });
      return;
    }

    if (req.method === "POST" && req.url === "/pair") {
      const body = await this.readJsonBody(req);
      const pairedAt = new Date().toISOString();
      const authToken = this.generateAuthToken();
      const clientName = String(body.clientName || req.headers["x-effecol-client"] || "unknown-client");

      this.settings = {
        ...DEFAULT_SETTINGS,
        ...(this.settings || {}),
        authToken,
        lastPairedAt: pairedAt,
        lastPairedClient: clientName
      };
      await this.saveData(this.settings);
      await this.updateStatus({
        lastPairedAt: pairedAt,
        lastPairedClient: clientName
      });

      this.writeJson(res, 200, {
        ok: true,
        authToken,
        pairedAt,
        bridge: {
          vaultName: this.getVaultName(),
          vaultPath: this.getVaultBasePath(),
          folder: this.getFolderName(),
          folderPath: this.getFolderAbsolutePath()
        }
      });
      return;
    }

    if (req.method === "POST" && req.url === "/save") {
      if (!this.isAuthorized(req)) {
        this.writeJson(res, 401, {
          ok: false,
          error: "Unauthorized bridge request"
        });
        return;
      }

      const body = await this.readJsonBody(req);
      const folder = this.getFolderName();
      const notePath = this.normalizeRelativePath(body.notePath, folder);
      const processed = await this.prepareNotePayload(body);
      const noteContent = String(processed.noteContent || "");

      await this.ensureFolder(folder);

      const existingFile = this.app.vault.getAbstractFileByPath(notePath);
      if (existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, noteContent);
      } else if (existingFile) {
        throw new Error(`目标路径已存在同名文件夹：${notePath}`);
      } else {
        await this.app.vault.create(notePath, noteContent);
      }

      const savedAt = new Date().toISOString();
      await this.updateStatus({
        state: "ready",
        lastRequestAt: savedAt,
        lastError: "",
        lastSave: {
          title: String(body.title || ""),
          notePath,
          sourceUrl: String(body.sourceUrl || ""),
          assetFolderPath: String(body.assetFolderPath || ""),
          requestedImageCount: processed.requestedImageCount || 0,
          downloadedImageCount: processed.downloadedImageCount || 0,
          fallbackImageCount: processed.fallbackImageCount || 0,
          debugInfo: body.debugInfo && typeof body.debugInfo === "object" ? body.debugInfo : {},
          imageResults: processed.imageResults || [],
          savedAt
        }
      });

      const debugInfo = body.debugInfo && typeof body.debugInfo === "object" ? body.debugInfo : {};
      const debugSummaryParts = [];
      if (typeof debugInfo.totalDocumentImageCount === "number") {
        debugSummaryParts.push(`页面总图 ${debugInfo.totalDocumentImageCount} 张`);
      }
      if (typeof debugInfo.rootImageCount === "number") {
        debugSummaryParts.push(`正文根节点图 ${debugInfo.rootImageCount} 张`);
      }
      if (typeof debugInfo.fallbackImageCount === "number") {
        debugSummaryParts.push(`回退扫描图 ${debugInfo.fallbackImageCount} 张`);
      }
      if (debugInfo.chosenStrategy) {
        debugSummaryParts.push(`策略 ${debugInfo.chosenStrategy}`);
      }

      this.writeJson(res, 200, {
        ok: true,
        notePath,
        assetCount: processed.downloadedImageCount || 0,
        requestedImageCount: processed.requestedImageCount || 0,
        downloadedImageCount: processed.downloadedImageCount || 0,
        fallbackImageCount: processed.fallbackImageCount || 0,
        imageResults: processed.imageResults || [],
        debugSummary: debugSummaryParts.join("，"),
        vaultName: this.getVaultName(),
        folder
      });
      return;
    }

    this.writeJson(res, 404, {
      ok: false,
      error: "Route not found"
    });
  }

  async readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  }

  async prepareNotePayload(body) {
    const contentBlocks = Array.isArray(body.contentBlocks) ? body.contentBlocks : [];
    const assetFolderPath = normalizePath(String(body.assetFolderPath || ""));

    if (!contentBlocks.length || !assetFolderPath) {
      return {
        noteContent: String(body.noteContent || ""),
        requestedImageCount: 0,
        downloadedImageCount: 0,
        fallbackImageCount: 0,
        imageResults: []
      };
    }

    const processedBlocks = [];
    const imageResults = [];
    let imageIndex = 0;

    for (const block of contentBlocks) {
      if (block?.type !== "image" || !block?.sourceUrl) {
        processedBlocks.push(block);
        continue;
      }

      imageIndex += 1;
      const resolvedImage = await this.resolveImageBlock(block, assetFolderPath, imageIndex);
      processedBlocks.push(resolvedImage.block);
      imageResults.push({
        index: imageIndex,
        sourceUrl: String(block.sourceUrl || ""),
        assetVaultPath: String(resolvedImage.block.assetVaultPath || ""),
        status: resolvedImage.saved ? "saved" : "remote",
        error: resolvedImage.error || ""
      });
    }

    const noteContent = this.injectRenderedBlocks(String(body.noteContent || ""), processedBlocks);
    const downloadedImageCount = imageResults.filter((item) => item.status === "saved").length;
    return {
      noteContent,
      requestedImageCount: imageResults.length,
      downloadedImageCount,
      fallbackImageCount: imageResults.length - downloadedImageCount,
      imageResults
    };
  }

  async resolveImageBlock(block, assetFolderPath, index) {
    try {
      await this.ensureFolder(assetFolderPath);
      const download = await this.downloadImage(block.sourceUrl, block.pageUrl || "");
      const extension = this.resolveImageExtension(download.contentType, block.sourceUrl);
      const fileName = `${String(index).padStart(2, "0")}.${extension}`;
      const vaultAssetPath = normalizePath(`${assetFolderPath}/${fileName}`);
      await this.writeBinaryFile(vaultAssetPath, download.buffer);

      return {
        block: {
          ...block,
          assetVaultPath: vaultAssetPath
        },
        saved: true,
        error: ""
      };
    } catch (error) {
      console.warn("[EffecCol Plugin] Failed to download image, falling back to remote URL", block.sourceUrl, error);
      return {
        block: {
          ...block,
          assetVaultPath: ""
        },
        saved: false,
        error: error.message || "Unknown image download error"
      };
    }
  }

  async downloadImage(url, pageUrl) {
    const client = url.startsWith("https:") ? https : http;
    return new Promise((resolve, reject) => {
      const request = client.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
          "Referer": pageUrl || url,
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        }
      }, (response) => {
        const status = response.statusCode || 0;

        if (status >= 300 && status < 400 && response.headers.location) {
          const redirectedUrl = new URL(response.headers.location, url).href;
          response.resume();
          this.downloadImage(redirectedUrl, pageUrl || url).then(resolve).catch(reject);
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: String(response.headers["content-type"] || "")
          });
        });
      });

      request.on("error", reject);
      request.setTimeout(15000, () => {
        request.destroy(new Error("Image download timeout"));
      });
    });
  }

  resolveImageExtension(contentType, sourceUrl) {
    const normalizedType = String(contentType || "").toLowerCase();
    if (normalizedType.includes("image/png")) return "png";
    if (normalizedType.includes("image/webp")) return "webp";
    if (normalizedType.includes("image/gif")) return "gif";
    if (normalizedType.includes("image/svg")) return "svg";
    if (normalizedType.includes("image/avif")) return "avif";
    if (normalizedType.includes("image/jpeg") || normalizedType.includes("image/jpg")) return "jpg";

    try {
      const pathname = new URL(sourceUrl).pathname;
      const ext = path.extname(pathname).replace(".", "").toLowerCase();
      if (ext && ext.length <= 5) {
        return ext;
      }
    } catch {}

    return "jpg";
  }

  async writeBinaryFile(vaultPath, buffer) {
    const existing = this.app.vault.getAbstractFileByPath(vaultPath);
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, buffer);
      return;
    }

    if (existing) {
      throw new Error(`目标路径已存在同名文件夹：${vaultPath}`);
    }

    await this.app.vault.createBinary(vaultPath, buffer);
  }

  injectRenderedBlocks(noteContent, processedBlocks) {
    const marker = "## 网页原文";
    const markerIndex = noteContent.indexOf(marker);
    if (markerIndex === -1) {
      return noteContent;
    }

    const linkSectionIndex = noteContent.indexOf("\n\n## 原始链接", markerIndex);
    const excerptSectionIndex = noteContent.indexOf("\n\n## 关键摘录", markerIndex);
    const nextSectionIndexCandidates = [linkSectionIndex, excerptSectionIndex].filter((value) => value !== -1);
    const nextSectionIndex = nextSectionIndexCandidates.length ? Math.min(...nextSectionIndexCandidates) : noteContent.length;
    const before = noteContent.slice(0, markerIndex + marker.length);
    const after = noteContent.slice(nextSectionIndex);
    const rendered = this.renderContentBlocks(processedBlocks);
    return `${before}\n${rendered ? `\n${rendered}` : "\n\n未提取到可用原文。"}${after}`;
  }

  renderContentBlocks(blocks) {
    return blocks
      .map((block) => this.renderContentBlock(block))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  renderContentBlock(block) {
    if (!block || typeof block !== "object") {
      return "";
    }

    if (block.type === "image") {
      if (block.assetVaultPath) {
        return `![[${block.assetVaultPath}]]`;
      }

      return block.sourceUrl ? (block.alt ? `![${block.alt}](${block.sourceUrl})` : `![](${block.sourceUrl})`) : "";
    }

    const text = String(block.text || "").trim();
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

  async ensureFolder(folder) {
    const normalizedFolder = normalizePath(folder);
    const existing = this.app.vault.getAbstractFileByPath(normalizedFolder);
    if (existing) {
      return;
    }

    const parts = normalizedFolder.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const currentFolder = this.app.vault.getAbstractFileByPath(current);
      if (!currentFolder) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  normalizeRelativePath(notePath, folder) {
    const normalizedFolder = normalizePath(folder).replace(/^\/+|\/+$/g, "");
    const input = normalizePath(String(notePath || "")).replace(/^\/+/, "");
    if (input.startsWith(`${normalizedFolder}/`)) {
      return input;
    }

    return `${normalizedFolder}/${input}`;
  }

  getFolderName() {
    return DEFAULT_FOLDER;
  }

  getVaultName() {
    return this.app.vault.getName();
  }

  getVaultBasePath() {
    return this.app.vault.adapter.basePath || "";
  }

  getFolderAbsolutePath() {
    const basePath = this.getVaultBasePath();
    const folder = this.getFolderName();
    return basePath ? path.join(basePath, folder) : folder;
  }

  getStatusFileAbsolutePath() {
    const basePath = this.getVaultBasePath();
    return basePath ? path.join(basePath, STATUS_FILE_RELATIVE_PATH) : STATUS_FILE_RELATIVE_PATH;
  }

  async updateStatus(patch) {
    this.status = {
      pluginId: PLUGIN_ID,
      state: "idle",
      port: DEFAULT_PORT,
      folder: this.getFolderName(),
      folderPath: this.getFolderAbsolutePath(),
      vaultName: this.getVaultName(),
      vaultPath: this.getVaultBasePath(),
      statusFilePath: this.getStatusFileAbsolutePath(),
      ...(this.status || {}),
      ...(patch || {}),
      lastUpdatedAt: new Date().toISOString()
    };

    await this.persistStatus();
    return this.status;
  }

  async persistStatus() {
    try {
      const absolutePath = this.getStatusFileAbsolutePath();
      await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.promises.writeFile(absolutePath, `${JSON.stringify(this.status, null, 2)}\n`, "utf8");
    } catch (error) {
      console.error("[EffecCol Plugin] Failed to write status file", error);
    }
  }

  writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-EffecCol-Client"
    });
    res.end(JSON.stringify(payload));
  }

  isAuthorized(req) {
    const expectedToken = String(this.settings?.authToken || "").trim();
    if (!expectedToken) {
      return false;
    }

    const headerValue = String(req.headers.authorization || "").trim();
    if (!headerValue.toLowerCase().startsWith("bearer ")) {
      return false;
    }

    return headerValue.slice(7).trim() === expectedToken;
  }

  generateAuthToken() {
    return crypto.randomBytes(24).toString("hex");
  }
}

class EffecColSettingTab extends PluginSettingTab {
  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "EffecCol" });
    containerEl.createEl("p", {
      text: "这个插件会在 Obsidian 本地打开一个仅供 EffecCol 浏览器扩展访问的保存接口。启用后，浏览器点击一下就能静默写入当前 vault 的 EffecCol 文件夹。"
    });

    new Setting(containerEl)
      .setName("当前 Vault")
      .setDesc(`浏览器扩展会写入这个 vault：${this.plugin.getVaultName()}`);

    new Setting(containerEl)
      .setName("本地接口")
      .setDesc(`浏览器扩展会连接 http://127.0.0.1:${DEFAULT_PORT}`);

    new Setting(containerEl)
      .setName("当前写入位置")
      .setDesc(this.plugin.getFolderAbsolutePath());

    new Setting(containerEl)
      .setName("状态文件")
      .setDesc(this.plugin.getStatusFileAbsolutePath());

    new Setting(containerEl)
      .setName("浏览器配对状态")
      .setDesc(
        this.plugin.settings?.lastPairedAt
          ? `最近配对：${this.plugin.settings.lastPairedAt}${this.plugin.settings.lastPairedClient ? `；客户端：${this.plugin.settings.lastPairedClient}` : ""}`
          : "还没有浏览器与当前 Vault 完成配对。"
      );
  }
}

module.exports = EffecColPlugin;
