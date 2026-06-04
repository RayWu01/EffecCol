#!/opt/homebrew/Cellar/node/25.5.0/bin/node

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const PORT = 27124;
const HOST = "127.0.0.1";
const CONFIG_DIR = path.join(os.homedir(), ".effecol");
const CONFIG_PATH = path.join(CONFIG_DIR, "bridge-config.json");
const DEFAULT_VAULT_PATH = path.join(os.homedir(), "Obsidian Vault");
const DEFAULT_FOLDER = "EffecCol";

start().catch((error) => {
  console.error("[EffecCol Bridge] Failed to start", error);
  process.exit(1);
});

async function start() {
  const config = await ensureConfig();
  const server = http.createServer((req, res) => {
    handleRequest(req, res, config).catch((error) => {
      console.error("[EffecCol Bridge] Request failed", error);
      writeJson(res, 500, {
        ok: false,
        error: error.message || "Unknown bridge error"
      });
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`[EffecCol Bridge] Listening on http://${HOST}:${PORT}`);
    console.log(`[EffecCol Bridge] Vault path: ${config.vaultPath}`);
  });
}

async function ensureConfig() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.vaultPath) {
      return parsed;
    }
  } catch {}

  const config = {
    vaultPath: DEFAULT_VAULT_PATH,
    folder: DEFAULT_FOLDER
  };
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

async function handleRequest(req, res, config) {
  if (req.method === "GET" && req.url === "/health") {
    const folderPath = path.join(config.vaultPath, config.folder || DEFAULT_FOLDER);
    writeJson(res, 200, {
      ok: true,
      vaultPath: config.vaultPath,
      folder: config.folder || DEFAULT_FOLDER,
      folderPath
    });
    return;
  }

  if (req.method === "POST" && req.url === "/save") {
    const body = await readJsonBody(req);
    const folder = config.folder || DEFAULT_FOLDER;
    const notePath = normalizeRelativePath(body.notePath, folder);
    const absolutePath = path.join(config.vaultPath, notePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, body.noteContent || "", "utf8");

    writeJson(res, 200, {
      ok: true,
      filePath: absolutePath,
      notePath
    });
    return;
  }

  writeJson(res, 404, {
    ok: false,
    error: "Route not found"
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizeRelativePath(notePath, folder) {
  const normalizedFolder = folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const input = String(notePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (input.startsWith(`${normalizedFolder}/`)) {
    return input;
  }

  return `${normalizedFolder}/${input}`;
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}
