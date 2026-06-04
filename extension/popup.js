const statusTitle = document.getElementById("statusTitle");
const statusMessage = document.getElementById("statusMessage");
const statusDetails = document.getElementById("statusDetails");
const retryButton = document.getElementById("retryButton");
const settingsButton = document.getElementById("settingsButton");

bootstrap().catch((error) => {
  console.error(error);
  applyContext({
    state: "error",
    title: "状态页初始化失败",
    message: error.message,
    details: [],
    canRetry: false,
    needsSetup: false
  });
});

async function bootstrap() {
  retryButton.addEventListener("click", retryCapture);
  settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

  const response = await chrome.runtime.sendMessage({
    type: "effecol:get-status-context"
  });

  applyContext(response?.context || getFallbackContext());
}

function applyContext(context) {
  statusTitle.textContent = context.title;
  statusMessage.textContent = context.message;
  statusDetails.innerHTML = "";

  for (const detail of context.details || []) {
    const item = document.createElement("li");
    item.textContent = detail;
    statusDetails.appendChild(item);
  }

  document.body.dataset.state = context.state || "idle";
  retryButton.hidden = !context.canRetry;
  retryButton.textContent = context.retryLabel || "重试这次保存";
  settingsButton.textContent = context.needsSetup ? "去完成设置" : "打开设置";
}

async function retryCapture() {
  retryButton.disabled = true;
  const originalText = retryButton.textContent;
  retryButton.textContent = "正在重试...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "effecol:retry-capture"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "重试失败");
    }

    window.close();
  } catch (error) {
    applyContext({
      state: "error",
      title: "重试没有完成",
      message: error.message,
      details: ["请先确认 Obsidian 已打开，且 EffecCol 插件已经启用，再回到目标网页重试。"],
      canRetry: true,
      retryIntent: "retry-capture",
      retryLabel: originalText || "重试这次保存",
      needsSetup: false
    });
  } finally {
    retryButton.disabled = false;
    retryButton.textContent = originalText;
  }
}

function getFallbackContext() {
  return {
    state: "idle",
    title: "还没有最近一次静默保存结果",
    message: "回到目标网页后点击扩展图标，这里会显示最近一次结果。",
    details: ["正常情况下，你只会在页面里看到轻提示，不需要打开这里。"],
    canRetry: false,
    retryIntent: "retry-capture",
    retryLabel: "重试这次保存",
    needsSetup: false
  };
}
