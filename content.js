// content.js - ColorCoder main engine
// ok so this is the big file. it does everything basically
// selection, highlighting, saving, loading back highlights on reload
// i spent like 3 days on the persistence part alone lol

// ---- CONSTANTS ----
const STORAGE_KEY_PREFIX = "colorcoder_highlights_";
const HIGHLIGHT_ATTR = "data-colorcoder-id";
const COLOR_MAP = {
  red:    { bg: "#FF6B6B", text: "#5C0000" },
  blue:   { bg: "#74B9FF", text: "#003580" },
  green:  { bg: "#55EFC4", text: "#003D2B" },
  yellow: { bg: "#FDCB6E", text: "#5C3A00" },
};

// global list of highlight objects for this page
// each highlight = { id, color, text, xpath, startOffset, endOffset, outerHTML }
let pageHighlights = [];
let floatingMenu = null;
let highlightMenu = null;
let currentRange = null; // the range the user selected

// ---- UTILS ----

// generates a kinda random id, good enough
function makeId() {
  return "cc_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();
}

// gets the current page url but strips the hash bc that changes and messes things up
function getPageKey() {
  const url = window.location.href.split("#")[0];
  return STORAGE_KEY_PREFIX + btoa(encodeURIComponent(url)).replace(/=/g, "");
}

// gets the xpath of a node - this took forever to figure out
// i looked it up and modified it a bit
function getXPathForNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }
  if (!node || node === document.body) return "/html/body";
  if (node === document.documentElement) return "/html";

  let path = "";
  while (node && node !== document.documentElement) {
    let name = node.nodeName.toLowerCase();
    // check if we need an index (if there are siblings with same tag)
    let sib = node.previousSibling;
    let idx = 1;
    while (sib) {
      if (sib.nodeType === Node.ELEMENT_NODE && sib.nodeName === node.nodeName) {
        idx++;
      }
      sib = sib.previousSibling;
    }
    // check if there are ANY siblings with same tag name (forward too)
    let hasSiblings = false;
    let check = node.parentNode ? node.parentNode.firstChild : null;
    let count = 0;
    while (check) {
      if (check.nodeType === Node.ELEMENT_NODE && check.nodeName === node.nodeName) count++;
      check = check.nextSibling;
    }
    hasSiblings = count > 1;

    path = "/" + name + (hasSiblings ? "[" + idx + "]" : "") + path;
    node = node.parentNode;
  }
  return "/html" + path;
}

// resolves an xpath back to a dom node - self explanatory lol
function getNodeByXPath(xpath) {
  try {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  } catch (e) {
    return null;
  }
}

// finds all text nodes inside an element - needed for offset math
function getTextNodes(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    nodes.push(node);
  }
  return nodes;
}

// this gives us offset relative to the root element
// kinda messy but it works - spent way too long on this
function getGlobalOffset(rootNode, targetTextNode, localOffset) {
  const textNodes = getTextNodes(rootNode);
  let total = 0;
  for (let i = 0; i < textNodes.length; i++) {
    if (textNodes[i] === targetTextNode) {
      return total + localOffset;
    }
    total += textNodes[i].textContent.length;
  }
  return -1;
}

// reverse of above - given a global offset, find the text node and local offset
function resolveGlobalOffset(rootNode, globalOffset) {
  const textNodes = getTextNodes(rootNode);
  let total = 0;
  for (let i = 0; i < textNodes.length; i++) {
    const len = textNodes[i].textContent.length;
    if (total + len >= globalOffset) {
      return { node: textNodes[i], offset: globalOffset - total };
    }
    total += len;
  }
  // fallback to last text node end - i hope this works
  if (textNodes.length > 0) {
    const last = textNodes[textNodes.length - 1];
    return { node: last, offset: last.textContent.length };
  }
  return null;
}

// ---- HIGHLIGHT DATA CAPTURE ----

// saves everything we need to restore a highlight later
// this is the hybrid system - xpath + text + offsets
function captureHighlightData(range, color, id) {
  const startNode = range.startContainer;
  const endNode = range.endContainer;

  // get the common ancestor
  let ancestor = range.commonAncestorContainer;
  if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentNode;

  const ancestorXPath = getXPathForNode(ancestor);

  // get offsets relative to ancestor
  const startOffset = getGlobalOffset(ancestor, startNode, range.startOffset);
  const endOffset = getGlobalOffset(ancestor, endNode, range.endOffset);

  const text = range.toString().trim();

  return {
    id,
    color,
    text,
    xpath: ancestorXPath,
    startOffset,
    endOffset,
    url: window.location.href.split("#")[0],
    createdAt: Date.now(),
  };
}

// ---- APPLYING HIGHLIGHTS TO DOM ----

// wraps a range in a span with the right color
// this is the scary part - modifying the DOM mid range can break stuff
function applyHighlightToRange(range, color, id) {
  // i hope this works - sometimes the range breaks if the dom changed
  try {
    // we need to handle ranges that span multiple text nodes
    const spans = [];
    const fragment = range.cloneContents();

    // use extractContents approach for cleaner DOM
    // actually lets just use surroundContents if possible (single text node)
    // otherwise we do it the hard way

    if (range.startContainer === range.endContainer) {
      // easy case - single text node
      const span = createHighlightSpan(color, id);
      range.surroundContents(span);
      spans.push(span);
    } else {
      // this part is kinda messy but it runs
      // split into multiple spans for each text node in range
      const startNode = range.startContainer;
      const endNode = range.endContainer;
      const startOffset = range.startOffset;
      const endOffset = range.endOffset;

      // get all text nodes in range
      const allTextNodes = [];
      const walker = document.createTreeWalker(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let n;
      while ((n = walker.nextNode())) {
        if (range.intersectsNode(n)) {
          allTextNodes.push(n);
        }
      }

      // wrap each text node separately
      for (let i = 0; i < allTextNodes.length; i++) {
        const tn = allTextNodes[i];
        const span = createHighlightSpan(color, id);

        let r = document.createRange();

        if (tn === startNode && tn === endNode) {
          r.setStart(tn, startOffset);
          r.setEnd(tn, endOffset);
        } else if (tn === startNode) {
          r.setStart(tn, startOffset);
          r.setEnd(tn, tn.textContent.length);
        } else if (tn === endNode) {
          r.setStart(tn, 0);
          r.setEnd(tn, endOffset);
        } else {
          r.selectNodeContents(tn);
        }

        try {
          r.surroundContents(span);
          spans.push(span);
        } catch (err) {
          // sometimes this fails if the range has elements inside it - just skip
          // took forever to fix this bug - well actually i just gave up and skip lol
        }
      }
    }

    return spans;
  } catch (e) {
    console.warn("[ColorCoder] applyHighlightToRange failed:", e);
    return [];
  }
}

// makes the actual span element for a highlight
function createHighlightSpan(color, id) {
  const span = document.createElement("span");
  span.setAttribute(HIGHLIGHT_ATTR, id);
  span.setAttribute("data-colorcoder-color", color);
  span.classList.add("colorcoder-highlight");
  span.style.backgroundColor = COLOR_MAP[color].bg;
  span.style.color = COLOR_MAP[color].text;
  span.style.borderRadius = "3px";
  span.style.padding = "0 2px";
  span.style.cursor = "pointer";
  span.style.transition = "opacity 0.2s";
  return span;
}

// ---- SAVING AND LOADING ----

// saves the current highlights array to chrome storage
// absolutly must be called after any change
function saveHighlights() {
  const key = getPageKey();
  chrome.storage.local.set({ [key]: pageHighlights }, () => {
    // saved! i think
  });
}

// loads highlights from storage and tries to restore them in the DOM
// this is the trickiest part of the whole extension honestly
function loadHighlights() {
  const key = getPageKey();
  chrome.storage.local.get([key], (result) => {
    const saved = result[key];
    if (!saved || saved.length === 0) return;

    pageHighlights = [];

    for (const hlData of saved) {
      // check if its already in the dom (prevent duplicates on reload)
      const existing = document.querySelector(`[${HIGHLIGHT_ATTR}="${hlData.id}"]`);
      if (existing) {
        // already there, just add to our list
        pageHighlights.push(hlData);
        continue;
      }

      const restored = restoreHighlight(hlData);
      if (restored) {
        pageHighlights.push(hlData);
      }
      // if restore failed we just skip it - better than crashing
    }
  });
}

// tries to put a highlight back into the DOM using saved data
// uses xpath first, then falls back to text search if xpath fails
function restoreHighlight(hlData) {
  try {
    const ancestorNode = getNodeByXPath(hlData.xpath);

    if (!ancestorNode) {
      // xpath failed - try text search fallback
      return restoreHighlightByText(hlData);
    }

    // resolve the offsets back to actual text nodes
    const startResolved = resolveGlobalOffset(ancestorNode, hlData.startOffset);
    const endResolved = resolveGlobalOffset(ancestorNode, hlData.endOffset);

    if (!startResolved || !endResolved) {
      return restoreHighlightByText(hlData);
    }

    // verify the text matches (tolerate small changes)
    const range = document.createRange();
    range.setStart(startResolved.node, startResolved.offset);
    range.setEnd(endResolved.node, endResolved.offset);

    const rangeText = range.toString().trim();

    // fuzzy match - if texts are too different, skip
    if (!textsAreSimilar(rangeText, hlData.text)) {
      // try text search as backup
      return restoreHighlightByText(hlData);
    }

    const spans = applyHighlightToRange(range, hlData.color, hlData.id);
    if (spans.length > 0) {
      attachHighlightListeners(hlData.id);
      return true;
    }

    return false;
  } catch (e) {
    console.warn("[ColorCoder] restoreHighlight error:", e);
    return false;
  }
}

// fallback: find text in the page and highlight it
// this is slower but handles dom changes better
function restoreHighlightByText(hlData) {
  try {
    const searchText = hlData.text;
    if (!searchText || searchText.length < 3) return false;

    // walk all text nodes looking for a match
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      // skip if inside a colorcoder span already
      if (node.parentElement && node.parentElement.closest(".colorcoder-highlight")) continue;

      const idx = node.textContent.indexOf(searchText);
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + searchText.length);
        const spans = applyHighlightToRange(range, hlData.color, hlData.id);
        if (spans.length > 0) {
          attachHighlightListeners(hlData.id);
          return true;
        }
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

// checks if two strings are similar enough (handles minor dom text changes)
// uses a simple ratio - good enough for our purposes
function textsAreSimilar(a, b) {
  if (!a || !b) return false;
  a = a.trim().toLowerCase();
  b = b.trim().toLowerCase();
  if (a === b) return true;
  // if one contains the other its probably fine
  if (a.includes(b) || b.includes(a)) return true;
  // levenshtein would be better but thats overkill lol
  // just check length ratio
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return ratio > 0.85;
}

// ---- FLOATING MENU (selection menu) ----

// shows the little floating menu when user selects text
function showFloatingMenu(rect) {
  removeFloatingMenu();

  floatingMenu = document.createElement("div");
  floatingMenu.id = "colorcoder-floating-menu";
  floatingMenu.innerHTML = `
    <div class="cc-menu-label">Highlight</div>
    <div class="cc-color-btns">
      <button class="cc-color-btn" data-color="red" style="background:${COLOR_MAP.red.bg}" title="Red"></button>
      <button class="cc-color-btn" data-color="blue" style="background:${COLOR_MAP.blue.bg}" title="Blue"></button>
      <button class="cc-color-btn" data-color="green" style="background:${COLOR_MAP.green.bg}" title="Green"></button>
      <button class="cc-color-btn" data-color="yellow" style="background:${COLOR_MAP.yellow.bg}" title="Yellow"></button>
    </div>
  `;

  document.body.appendChild(floatingMenu);

  // position it above the selection
  // using getBoundingClientRect like the spec says
  const menuRect = floatingMenu.getBoundingClientRect();
  let top = rect.top + window.scrollY - menuRect.height - 10;
  let left = rect.left + window.scrollX + (rect.width / 2) - (floatingMenu.offsetWidth / 2);

  // make sure it doesnt go off screen
  if (top < window.scrollY + 5) top = rect.bottom + window.scrollY + 10;
  if (left < 5) left = 5;
  if (left + floatingMenu.offsetWidth > window.innerWidth - 5) {
    left = window.innerWidth - floatingMenu.offsetWidth - 5;
  }

  floatingMenu.style.top = top + "px";
  floatingMenu.style.left = left + "px";

  // add click handlers for each color
  floatingMenu.querySelectorAll(".cc-color-btn").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault(); // dont lose selection
      const color = btn.getAttribute("data-color");
      handleHighlightCreate(color);
    });
  });
}

function removeFloatingMenu() {
  if (floatingMenu) {
    floatingMenu.remove();
    floatingMenu = null;
  }
}

// ---- HIGHLIGHT CREATION ----

// the main function that gets called when user picks a color
function handleHighlightCreate(color) {
  if (!currentRange || currentRange.collapsed) return;

  const id = makeId();
  const hlData = captureHighlightData(currentRange, color, id);

  // apply the visual highlight
  const spans = applyHighlightToRange(currentRange, color, id);

  if (spans.length === 0) {
    // hmm didnt work - maybe selection was weird
    removeFloatingMenu();
    return;
  }

  // save it
  pageHighlights.push(hlData);
  saveHighlights();

  attachHighlightListeners(id);
  removeFloatingMenu();

  // clear selection
  window.getSelection().removeAllRanges();
  currentRange = null;
}

// ---- HIGHLIGHT CLICK MENU ----

// shows the menu that pops up when you click an existing highlight
function showHighlightMenu(hlId, x, y) {
  removeHighlightMenu();

  const hlData = pageHighlights.find((h) => h.id === hlId);
  if (!hlData) return;

  highlightMenu = document.createElement("div");
  highlightMenu.id = "colorcoder-highlight-menu";

  const colorBtns = Object.entries(COLOR_MAP)
    .map(
      ([c, vals]) =>
        `<button class="cc-recolor-btn ${c === hlData.color ? "active" : ""}" 
          data-color="${c}" 
          style="background:${vals.bg}"
          title="${c}"></button>`
    )
    .join("");

  highlightMenu.innerHTML = `
    <div class="cc-hl-menu-colors">
      <span class="cc-hl-menu-label">Color:</span>
      ${colorBtns}
    </div>
    <button class="cc-delete-btn" data-id="${hlId}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
      </svg>
      Delete
    </button>
  `;

  document.body.appendChild(highlightMenu);

  // position it
  let top = y + window.scrollY - highlightMenu.offsetHeight - 5;
  let left = x + window.scrollX - highlightMenu.offsetWidth / 2;
  if (top < window.scrollY) top = y + window.scrollY + 20;
  if (left < 5) left = 5;

  highlightMenu.style.top = top + "px";
  highlightMenu.style.left = left + "px";

  // recolor buttons
  highlightMenu.querySelectorAll(".cc-recolor-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const newColor = btn.getAttribute("data-color");
      recolorHighlight(hlId, newColor);
      removeHighlightMenu();
    });
  });

  // delete button
  highlightMenu.querySelector(".cc-delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteHighlight(hlId);
    removeHighlightMenu();
  });
}

function removeHighlightMenu() {
  if (highlightMenu) {
    highlightMenu.remove();
    highlightMenu = null;
  }
}

// attaches click listeners to all spans with a given id
function attachHighlightListeners(hlId) {
  const spans = document.querySelectorAll(`[${HIGHLIGHT_ATTR}="${hlId}"]`);
  spans.forEach((span) => {
    // remove old listener first to prevent duplicates
    span.removeEventListener("click", span._ccClickHandler);
    span._ccClickHandler = function (e) {
      e.stopPropagation();
      showHighlightMenu(hlId, e.clientX, e.clientY);
    };
    span.addEventListener("click", span._ccClickHandler);
  });
}

// ---- MODIFYING HIGHLIGHTS ----

// changes the color of an existing highlight - just updates spans and storage
function recolorHighlight(hlId, newColor) {
  // update DOM
  const spans = document.querySelectorAll(`[${HIGHLIGHT_ATTR}="${hlId}"]`);
  spans.forEach((span) => {
    span.style.backgroundColor = COLOR_MAP[newColor].bg;
    span.style.color = COLOR_MAP[newColor].text;
    span.setAttribute("data-colorcoder-color", newColor);
  });

  // update our array
  const hl = pageHighlights.find((h) => h.id === hlId);
  if (hl) {
    hl.color = newColor;
    saveHighlights();
  }
}

// removes a highlight from DOM and storage
// gotta be careful not to break surrounding text nodes
function deleteHighlight(hlId) {
  const spans = document.querySelectorAll(`[${HIGHLIGHT_ATTR}="${hlId}"]`);
  spans.forEach((span) => {
    // replace span with its text content - keeps the text in place
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parent.normalize(); // merge adjacent text nodes back
  });

  // remove from array
  pageHighlights = pageHighlights.filter((h) => h.id !== hlId);
  saveHighlights();
}

// deletes ALL highlights on this page
// called from popup
function clearAllHighlights() {
  // copy ids to avoid mutation issues
  const ids = pageHighlights.map((h) => h.id);
  for (const id of ids) {
    const spans = document.querySelectorAll(`[${HIGHLIGHT_ATTR}="${id}"]`);
    spans.forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize();
    });
  }
  pageHighlights = [];
  saveHighlights(); // saves empty array

  removeFloatingMenu();
  removeHighlightMenu();
}



// ---- INIT ----

// run when page loads - restore saved highlights
// wrapped in a small timeout so the page dom is ready
// i hope this works on all sites lol
(function init() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(loadHighlights, 300);
    });
  } else {
    setTimeout(loadHighlights, 300);
  }
})();
