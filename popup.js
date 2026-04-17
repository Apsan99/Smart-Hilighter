// popup.js - handles the popup dashboard
// this file is kinda long but most of it is rendering highlights
// the site selector was a pain to implement ngl

// color config - same as content.js but repeated bc popup has no access to content vars
const COLOR_INFO = {
  red:    { bg: "#FF6B6B", text: "#5C0000",  label: "Red" },
  blue:   { bg: "#74B9FF", text: "#003580",  label: "Blue" },
  green:  { bg: "#55EFC4", text: "#003D2B",  label: "Green" },
  yellow: { bg: "#FDCB6E", text: "#5C3A00",  label: "Yellow" },
};

const STORAGE_KEY_PREFIX = "colorcoder_highlights_";

// state
let allSiteData = {};     // { siteKey: { url, highlights[] } }
let selectedSiteKey = ""; // the currently viewed site
let activeColorFilter = "all";
let currentTabId = null;
let currentTabUrl = "";

// ---- INIT ----

// runs when popup opens
document.addEventListener("DOMContentLoaded", async () => {
  // get current tab info first
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs[0]) {
    currentTabId = tabs[0].id;
    currentTabUrl = tabs[0].url || "";
  }

  await loadAllSiteData();
  buildSiteSelector();
  renderList();
  setupEventListeners();
});

// ---- DATA LOADING ----

// loads ALL stored highlight data from chrome.storage.local
// we need all keys so user can switch between sites
async function loadAllSiteData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (allStorage) => {
      allSiteData = {};

      for (const [key, value] of Object.entries(allStorage)) {
        if (!key.startsWith(STORAGE_KEY_PREFIX)) continue;
        if (!Array.isArray(value) || value.length === 0) continue;

        // figure out the url for this key from the highlights themselves
        let url = "";
        if (value[0] && value[0].url) {
          url = value[0].url;
        } else {
          // cant determine url, just use key
          url = key;
        }

        allSiteData[key] = { key, url, highlights: value };
      }

      // also fetch live highlights from current tab via message
      // this ensures we have the latest data (in case of new highlights this session)
      if (currentTabId) {
        chrome.tabs.sendMessage(currentTabId, { action: "getHighlights" }, (resp) => {
          if (chrome.runtime.lastError) {
            // tab might not have content script, thats fine
            resolve();
            return;
          }
          if (resp && resp.highlights && resp.highlights.length > 0) {
            const currentKey = getStorageKeyForUrl(currentTabUrl);
            allSiteData[currentKey] = {
              key: currentKey,
              url: currentTabUrl,
              highlights: resp.highlights,
            };
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

// replicates the key generation from content.js
function getStorageKeyForUrl(url) {
  const cleanUrl = url.split("#")[0];
  return STORAGE_KEY_PREFIX + btoa(encodeURIComponent(cleanUrl)).replace(/=/g, "");
}

// ---- SITE SELECTOR ----

// builds the dropdown of all sites that have highlights
function buildSiteSelector() {
  const sel = document.getElementById("siteSelect");
  sel.innerHTML = "";

  const sites = Object.values(allSiteData);

  if (sites.length === 0) {
    sel.innerHTML = '<option value="">No highlights yet</option>';
    selectedSiteKey = "";
    return;
  }

  // sort: current tab url first, then by highlight count
  sites.sort((a, b) => {
    const aIsCurrent = currentTabUrl && a.url === currentTabUrl.split("#")[0];
    const bIsCurrent = currentTabUrl && b.url === currentTabUrl.split("#")[0];
    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;
    return b.highlights.length - a.highlights.length;
  });

  for (const site of sites) {
    const opt = document.createElement("option");
    opt.value = site.key;
    // shorten the url for display - just hostname + path
    let displayUrl = site.url;
    try {
      const parsed = new URL(site.url);
      displayUrl = parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
      if (displayUrl.length > 45) displayUrl = displayUrl.substring(0, 42) + "...";
    } catch (e) {
      // url parsing failed, w/e
    }
    opt.textContent = `${displayUrl} (${site.highlights.length})`;

    // mark current tab
    if (currentTabUrl && site.url === currentTabUrl.split("#")[0]) {
      opt.textContent = "★ " + opt.textContent;
    }

    sel.appendChild(opt);
  }

  // default to first option (which is current tab if it has highlights)
  selectedSiteKey = sites[0].key;
  sel.value = selectedSiteKey;
}

// ---- RENDERING ----

// main render function - builds the highlight list
function renderList() {
  const listArea = document.getElementById("listArea");
  const totalBadge = document.getElementById("totalBadge");

  const siteData = allSiteData[selectedSiteKey];

  if (!siteData || siteData.highlights.length === 0) {
    listArea.innerHTML = `
      <div class="cc-empty">
        <div class="cc-empty-icon">✨</div>
        <div class="cc-empty-title">No highlights here yet</div>
        <div class="cc-empty-sub">Select some text on a webpage and<br>pick a color to start highlighting!</div>
      </div>
    `;
    totalBadge.textContent = "0 highlights";
    return;
  }

  let highlights = siteData.highlights;

  // apply color filter
  if (activeColorFilter !== "all") {
    highlights = highlights.filter((h) => h.color === activeColorFilter);
  }

  totalBadge.textContent = `${siteData.highlights.length} highlight${siteData.highlights.length !== 1 ? "s" : ""}`;

  if (highlights.length === 0) {
    listArea.innerHTML = `
      <div class="cc-empty">
        <div class="cc-empty-icon"></div>
        <div class="cc-empty-title">No ${activeColorFilter} highlights</div>
        <div class="cc-empty-sub">Switch to a different color filter<br>or highlight some text in ${activeColorFilter}!</div>
      </div>
    `;
    return;
  }

  // group by color - proccess in order: red, blue, green, yellow
  const colorOrder = ["red", "blue", "green", "yellow"];
  const groups = {};
  for (const color of colorOrder) {
    const items = highlights.filter((h) => h.color === color);
    if (items.length > 0) groups[color] = items;
  }

  let html = "";

  for (const [color, items] of Object.entries(groups)) {
    const info = COLOR_INFO[color];
    html += `
      <div class="cc-group">
        <div class="cc-group-header">
          <div class="cc-group-dot" style="background:${info.bg}"></div>
          <span class="cc-group-title">${info.label}</span>
          <span class="cc-group-num">${items.length}</span>
        </div>
    `;

    for (const hl of items) {
      // truncate preview text to keep it tidy
      const preview = truncateText(hl.text, 80);
      html += `
        <div class="cc-hl-item" data-id="${hl.id}" data-color="${color}">
          <div class="cc-hl-color-strip" style="background:${info.bg}"></div>
          <div class="cc-hl-preview">${escapeHtml(preview)}</div>
          <button class="cc-hl-del-btn" data-del-id="${hl.id}" title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      `;
    }

    html += `</div>`;
  }

  listArea.innerHTML = html;

  // attach click handlers to items
  listArea.querySelectorAll(".cc-hl-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      // dont trigger if delete button was clicked
      if (e.target.closest(".cc-hl-del-btn")) return;
      const id = item.getAttribute("data-id");
      scrollToHighlightInTab(id);
    });
  });

  // delete buttons
  listArea.querySelectorAll(".cc-hl-del-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-del-id");
      deleteHighlightFromPopup(id);
    });
  });
}

// ---- ACTIONS ----

// tells content.js to scroll to a highlight
function scrollToHighlightInTab(hlId) {
  if (!currentTabId) return;

  // check if the selected site matches current tab
  const siteData = allSiteData[selectedSiteKey];
  const currentKey = getStorageKeyForUrl(currentTabUrl);

  if (selectedSiteKey !== currentKey) {
    // highlight is on a different tab/page, open it first
    // well actually we cant easily do that without extra permissions
    // so just show a note lol
    // for now just try sending the message and hope for the best
  }

  chrome.tabs.sendMessage(currentTabId, { action: "scrollTo", id: hlId }, (resp) => {
    if (chrome.runtime.lastError) {
      // content script not running on this tab
    }
  });
}

// deletes a single highlight - updates storage and UI
async function deleteHighlightFromPopup(hlId) {
  const siteData = allSiteData[selectedSiteKey];
  if (!siteData) return;

  // remove from our local state
  siteData.highlights = siteData.highlights.filter((h) => h.id !== hlId);

  // save to storage
  await new Promise((resolve) => {
    chrome.storage.local.set({ [selectedSiteKey]: siteData.highlights }, resolve);
  });

  // also tell content script to update DOM if its the current tab
  const currentKey = getStorageKeyForUrl(currentTabUrl);
  if (selectedSiteKey === currentKey && currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { action: "deleteOne", id: hlId }, () => {});
  }

  // if site has no more highlights, remove from our list
  if (siteData.highlights.length === 0) {
    delete allSiteData[selectedSiteKey];
    buildSiteSelector();
    // pick first available site or empty
    const keys = Object.keys(allSiteData);
    selectedSiteKey = keys[0] || "";
    document.getElementById("siteSelect").value = selectedSiteKey;
  }

  renderList();
}

// clears ALL highlights on selected site
async function clearAllHighlightsForSite() {
  const siteData = allSiteData[selectedSiteKey];
  if (!siteData) return;

  // wipe from storage
  await new Promise((resolve) => {
    chrome.storage.local.remove(selectedSiteKey, resolve);
  });

  // tell content script if its current tab
  const currentKey = getStorageKeyForUrl(currentTabUrl);
  if (selectedSiteKey === currentKey && currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { action: "clearAll" }, () => {});
  }

  delete allSiteData[selectedSiteKey];

  // rebuild selector
  buildSiteSelector();
  const keys = Object.keys(allSiteData);
  selectedSiteKey = keys.length > 0 ? keys[0] : "";
  if (selectedSiteKey) {
    document.getElementById("siteSelect").value = selectedSiteKey;
  }

  renderList();
}

// copies all visible highlights to clipboard in a clean format
// this is the auto-summary feature
async function copyAllHighlights() {
  const siteData = allSiteData[selectedSiteKey];
  if (!siteData || siteData.highlights.length === 0) return;

  let highlights = siteData.highlights;
  if (activeColorFilter !== "all") {
    highlights = highlights.filter((h) => h.color === activeColorFilter);
  }

  if (highlights.length === 0) return;

  // build nice formatted text
  const colorOrder = ["red", "blue", "green", "yellow"];
  const lines = [];

  lines.push("=== ColorCoder Highlights ===");

  // get hostname for header
  let siteName = selectedSiteKey;
  try {
    if (siteData.url) {
      siteName = new URL(siteData.url).hostname;
    }
  } catch (e) {}

  lines.push(`Site: ${siteName}`);
  lines.push(`Date: ${new Date().toLocaleDateString()}`);
  lines.push("");

  for (const color of colorOrder) {
    const items = highlights.filter((h) => h.color === color);
    if (items.length === 0) continue;

    lines.push(`${color.toUpperCase()}:`);
    for (const hl of items) {
      lines.push(`  - ${hl.text.trim()}`);
    }
    lines.push("");
  }

  const text = lines.join("\n").trim();

  // use clipboard api like the spec says
  try {
    await navigator.clipboard.writeText(text);

    // show copied feedback
    const btn = document.getElementById("copyBtn");
    btn.classList.add("copied");
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Copied!
    `;
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy All
      `;
    }, 2000);
  } catch (err) {
    // clipboard failed - happens if popup isnt focused sometimes
    alert("Couldnt copy to clipboard. Try again.");
  }
}

// ---- EVENT LISTENERS ----

function setupEventListeners() {
  // site selector change
  document.getElementById("siteSelect").addEventListener("change", (e) => {
    selectedSiteKey = e.target.value;
    activeColorFilter = "all";
    // reset tab active state
    document.querySelectorAll(".cc-tab").forEach((t) => t.classList.remove("active"));
    document.querySelector(".cc-tab[data-color='all']").classList.add("active");
    renderList();
  });

  // color filter tabs
  document.getElementById("colorTabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".cc-tab");
    if (!tab) return;
    document.querySelectorAll(".cc-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeColorFilter = tab.getAttribute("data-color");
    renderList();
  });

  // copy button
  document.getElementById("copyBtn").addEventListener("click", copyAllHighlights);

  // clear button - shows confirm dialog first
  document.getElementById("clearBtn").addEventListener("click", () => {
    const overlay = document.getElementById("confirmOverlay");
    overlay.style.display = "flex";
  });

  document.getElementById("confirmCancel").addEventListener("click", () => {
    document.getElementById("confirmOverlay").style.display = "none";
  });

  document.getElementById("confirmYes").addEventListener("click", async () => {
    document.getElementById("confirmOverlay").style.display = "none";
    await clearAllHighlightsForSite();
  });
}

// ---- HELPERS ----

// truncates text to max length with ellipsis
function truncateText(text, maxLen) {
  if (!text) return "";
  text = text.trim().replace(/\s+/g, " ");
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + "…";
}

// escapes html to prevent xss when inserting text as innerHTML
// absolutly necessary since we're inserting user page content
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
