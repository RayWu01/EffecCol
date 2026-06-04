chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "effecol:copy-card") {
    return false;
  }

  copyToClipboard(message.text, message.html)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function copyToClipboard(text, html) {
  const copyHost = ensureCopyHost();
  const selection = window.getSelection();
  const range = document.createRange();
  const previousRanges = [];

  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      previousRanges.push(selection.getRangeAt(index).cloneRange());
    }
  }

  return new Promise((resolve, reject) => {
    const handleCopy = (event) => {
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
      event.clipboardData?.setData("text/html", html);
      cleanup();
      resolve();
    };

    const cleanup = () => {
      document.removeEventListener("copy", handleCopy, true);
      copyHost.textContent = "";

      if (!selection) {
        return;
      }

      selection.removeAllRanges();
      for (const savedRange of previousRanges) {
        selection.addRange(savedRange);
      }
    };

    document.addEventListener("copy", handleCopy, true);
    copyHost.textContent = text;
    copyHost.focus();
    range.selectNodeContents(copyHost);

    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const copied = document.execCommand("copy");
    if (!copied) {
      cleanup();
      reject(new Error("浏览器拒绝了 execCommand(copy)。"));
    }
  });
}

function ensureCopyHost() {
  let host = document.getElementById("copy-host");
  if (host) {
    return host;
  }

  host = document.createElement("div");
  host.id = "copy-host";
  host.contentEditable = "true";
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.top = "-9999px";
  host.style.left = "-9999px";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.style.whiteSpace = "pre-wrap";
  document.body.appendChild(host);
  return host;
}
