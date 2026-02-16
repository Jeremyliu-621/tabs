# Tabs - Chrome Extension

Automatically learn which tabs belong together and switch between projects with one click. Eliminate the barrier to starting work by automating your workspace setup.

## 🚀 Overview

**Tabs** is an intelligent Chrome extension designed to solve the context-switching problem. People juggling multiple projects often waste significant time manually reopening tabs. This extension passively learns which tabs belong together, groups them into projects, and allows you to switch between them instantly.

## ✨ Key Features

- **Passive Tab Tracking**: Silently monitors tab events and time spent to understand your work patterns.
- **Automatic Project Detection**: Uses AI (Claude/OpenAI) and local heuristics to group related tabs into projects.
- **One-Click Project Switching**: Switch contexts instantly. The extension closes current tabs and opens the exact tabs needed for your next project.
- **Smart Restore**: Resume your last project with a single click when reopening Chrome.
- **Manual Control**: Create, rename, edit, or delete projects manually.

## 🛠️ Tech Stack

- **Manifest V3**: Built with the latest Chrome extension standards.
- **Vanilla JavaScript**: Lightweight and fast, using ES6+ features and async/await.
- **Chrome APIs**: Leverages `chrome.tabs`, `chrome.storage.local`, and `chrome.idle`.
- **AI Integration**: Supports Anthropic (Claude) and OpenAI APIs for intelligent project grouping.

## 📦 Project Structure

```text
.
├── manifest.json              # Extension configuration
├── background/                # Service worker for tab tracking and analysis
├── popup/                     # Extension popup UI (HTML, JS, CSS)
├── shared/                    # Shared utility logic and storage abstractions
├── assets/                    # Icons and static assets
├── .git/                      # Git repository metadata
└── .forAIs/                   # Project documentation and context for AI agents
```

## 📥 Installation

Follow these steps to run the extension locally:

1. **Clone or Download** this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** by toggling the switch in the top right corner.
4. Click the **Load unpacked** button.
5. Select the `tabs` directory (the one containing `manifest.json`).
6. The "Tabs" extension should now appear in your list of extensions.
7. Click the extension icon to start managing your projects!

## 🤖 AI Configuration

To enable AI-powered project detection:
1. Open the settings (gear icon) in the extension popup.
2. Enter your **Anthropic** or **OpenAI** API key.
3. Choose your preferred AI provider.
4. Use the "✨ Detect Projects" button to trigger an intelligent analysis of your current tabs.

---
*Built for productivity.*
