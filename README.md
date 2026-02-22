# Tabs

A browser extension for AI-powered automated tab grouping and project management.

## Installation

1. Clone or download this repository.
2. Open Google Chrome and go to `chrome://extensions/`.
3. Enable Developer mode in the top right corner.
4. Click Load unpacked.
5. Select the `tabs` directory containing `manifest.json`.

## Configuration

The extension requires a Gemini API key for intelligent grouping.

1. Copy `config.example.js` to `config.js`.
2. Open `config.js` and replace `YOUR_GEMINI_API_KEY_HERE` with your API key.
3. Obtain a key at [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey).

Alternatively, you can provide an API key in the extension settings popup.
