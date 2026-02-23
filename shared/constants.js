// ── Storage Keys ──────────────────────────────────────────────
export const STORAGE_KEYS = {
  TAB_EVENTS: 'tab_events',       // Array of raw tab event records
  SESSIONS: 'sessions',           // Array of detected browsing sessions
  PROJECTS: 'projects',           // Array of auto-detected / manual projects
  SETTINGS: 'settings',           // User preferences
  BLACKLIST: 'domain_blacklist',  // Array of blacklisted domain strings
  CLUSTERING_SETTINGS: 'clustering_settings', // User-editable clustering params
  LAST_ACTIVE_PROJECT: 'last_active_project',
  AI_API_KEY: 'ai_api_key',       // Gemini API key
  AI_CACHE: 'ai_cache',           // Cached AI clustering results
  AI_METADATA: 'ai_analysis_metadata', // Analysis metadata (timestamps, counts)
};

// ── Tracking Thresholds ──────────────────────────────────────
export const TRACKING = {
  /** Minimum time (ms) a tab must be focused to count as "visited" */
  MIN_FOCUS_DURATION: 2000,

  /** Default gap (ms) between tab activity that defines a new session boundary */
  SESSION_GAP: 15 * 60 * 1000, // 15 minutes (user-editable)

  /** Debounce delay (ms) for rapid tab events */
  DEBOUNCE_DELAY: 500,
};

// ── Clustering Defaults ──────────────────────────────────────
// These are the defaults; user can override via Settings in the popup.
export const CLUSTERING = {
  /** Only process events from the last N ms */
  DATA_RETENTION: 7 * 24 * 60 * 60 * 1000, // 7 days

  /** Archive projects not accessed within this window */
  ARCHIVE_THRESHOLD: 7 * 24 * 60 * 60 * 1000, // 7 days

  /** Jaccard similarity threshold to merge session into existing project */
  OVERLAP_THRESHOLD: 0.8,

  /** Minimum domains in a session to create a project candidate */
  MIN_CLUSTER_SIZE: 2,

  /** Maximum auto-detected active projects to display */
  MAX_AUTO_PROJECTS: 10,
};

// ── Data Retention ───────────────────────────────────────────
export const RETENTION = {
  /** Max age (ms) for raw tab events before pruning */
  MAX_EVENT_AGE: 30 * 24 * 60 * 60 * 1000, // 30 days

  /** Max number of tab events to keep in storage */
  MAX_EVENTS: 10000,
};

// ── Tab Event Types ──────────────────────────────────────────
export const EVENT_TYPES = {
  CREATED: 'created',
  ACTIVATED: 'activated',
  UPDATED: 'updated',
  REMOVED: 'removed',
};

// ── URLs to ignore ───────────────────────────────────────────
export const IGNORED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'about:',
  'edge://',
  'brave://',
];

// ── AI Clustering ───────────────────────────────────────────
export const AI = {
  /** Gemini API endpoint */
  GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',

  /** Request timeout in milliseconds */
  REQUEST_TIMEOUT: 10000, // 10 seconds

  /** Minimum tabs required before running AI analysis */
  MIN_TABS_FOR_ANALYSIS: 2,

  /** Trigger: Run analysis if this many new tabs opened */
  TRIGGER_NEW_TABS: 2,

  /** Trigger: Run analysis if this many minutes elapsed */
  TRIGGER_TIME_MINUTES: 1,

  /** Maximum tabs to send to AI (privacy/performance) */
  MAX_TABS_TO_ANALYZE: 100,

  /** Only analyze tabs from last N hours */
  ANALYSIS_WINDOW_HOURS: 24,
};