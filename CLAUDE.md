# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VocabMeld is a Chrome Extension (Manifest V3) for immersive language learning. It intelligently replaces vocabulary on web pages with translations based on Krashen's "Comprehensible Input" (i+1) theory.

## Development Commands

```bash
# Generate icon assets (creates HTML in icons/ to download PNGs)
npm run build

# Watch mode for development
npm run watch
```

**No build step required for code changes** - this is a vanilla JavaScript project. After modifying code:
1. Go to `chrome://extensions/`
2. Click the refresh button on the VocabMeld extension

## Architecture

### Extension Components (Manifest V3)

```
js/
├── background.js      # Service worker: handles commands, context menus, TTS, messaging
├── content.js         # Core logic: injected into pages, handles DOM replacement & UI
├── popup.js           # Extension popup: quick stats and controls
├── options.js         # Settings page: configuration management
├── core/
│   ├── config.js      # Configuration constants and defaults
│   └── storage.js     # Chrome storage abstraction (sync/local)
└── services/
    ├── api-service.js         # LLM API calls (OpenAI-compatible endpoints)
    ├── cache-service.js       # LRU cache (2000 words max)
    ├── content-segmenter.js   # DOM traversal and text segmentation
    ├── processing-service.js  # Orchestrates translation workflow
    └── text-replacer.js       # Range API-based DOM text replacement
```

### Data Flow

1. **Page Processing**: `content.js` → `content-segmenter.js` segments DOM → `processing-service.js` orchestrates
2. **Translation**: Check `cache-service.js` → call `api-service.js` for uncached words → filter by CEFR difficulty
3. **DOM Update**: `text-replacer.js` uses Range API to replace text nodes without breaking page structure

### Storage Strategy

- **chrome.storage.sync**: User preferences, learned words, memorize list (synced across devices)
- **chrome.storage.local**: Translation cache (2000 word LRU), statistics

### Key Constants (in content.js)

- `CEFR_LEVELS`: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
- `INTENSITY_CONFIG`: low (4), medium (8), high (14) replacements per paragraph
- `CACHE_MAX_SIZE`: 2000 words
- `SKIP_TAGS`: Elements to never process (SCRIPT, STYLE, CODE, PRE, etc.)

## Code Patterns

### Content Script Limitations

`content.js` cannot use ES modules. All code is wrapped in an IIFE and dependencies are inlined.

### Difficulty Filtering

Words are filtered client-side: only display words at or above user's selected CEFR level.

```javascript
// User selects B2 → shows B2, C1, C2 (wordIdx >= userIdx)
function isDifficultyCompatible(wordDifficulty, userDifficulty) {
  return CEFR_LEVELS.indexOf(wordDifficulty) >= CEFR_LEVELS.indexOf(userDifficulty);
}
```

### Content Fingerprinting

Each text segment gets a hash fingerprint (first 100 chars) to prevent duplicate processing.

## Keyboard Shortcuts

- `Alt+T`: Process current page (defined in manifest.json commands)

## Supported LLM APIs

Any OpenAI-compatible endpoint: OpenAI, DeepSeek, Moonshot, Groq, Ollama (local)
