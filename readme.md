# ColorCoder 
**A local-first study highlighter for Chrome**

highlight stuff on any webpage. it saves. it comes back when you reload. you can organize it. pretty cool honestly

---

## Setup (like 2 mins)

1. **Download / clone this folder** somewhere on your computer

2. **Open Chrome** and go to `chrome://extensions/`

3. **Enable Developer Mode** - toggle in the top right corner

4. Click **"Load unpacked"** and select the `ColorCoder` folder

5. Thats it. The extension icon appears in your toolbar. Pin it if you want




### Highlighting Text
- Go to any webpage
- **Select any text** with your mouse
- A small floating menu will appear near your selection
- Click one of the **4 color circles** (Red, Blue, Green, Yellow)
- The text gets highlighted instantly

### Managing Highlights
- **Click any highlighted text** to open the edit menu
- From there you can:
  - **Change the color** - click any color circle
  - **Delete** - click the trash/Delete button

### The Popup Dashboard
Click the ColorCoder icon in the toolbar to open the popup. From here you can:

- **Switch between sites** - the dropdown at the top shows all pages where you've made highlights. your current page is marked with ★
- **Filter by color** - click the tab buttons (All / Red / Blue / Green / Yellow)
- **Click any highlight** to jump to it on the page (it scrolls + flashes it)
- **Delete individual highlights** - hover over an item, click the X button
- **Copy All Highlights** - exports everything as clean formatted text to your clipboard. great for pasting into notes
- **Clear All** - removes every highlight on the selected site (asks you to confirm first)




## Files
```
ColorCoder/
├── manifest.json   - extension config (MV3)
├── content.js      - main engine, injected into every page
├── popup.html      - popup UI layout
├── popup.js        - popup logic
├── styles.css      - styles for floating menus + highlights
└── README.md       - ur reading it
```

---



## Privacy
everything is stored locally using `chrome.storage.local`. nothing is sent anywhere. no servers, no accounts, no tracking. just your browser.

---

*made with way too much caffeine and stack overflow tabs*
