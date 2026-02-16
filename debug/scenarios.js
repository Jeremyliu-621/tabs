/**
 * Test Scenario Library — 10 realistic browsing patterns for clustering evaluation.
 *
 * Each scenario returns { name, description, simulates, timespan, events[] }.
 * Events follow the schema: { id, type, domain, url, title, timestamp, tabId }.
 * Timestamps are generated relative to Date.now() so they always fall within
 * the clustering engine's data-retention window.
 */

// ── Helpers ──────────────────────────────────────────────────

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let _nextTabId = 1000;
let _nextEventId = 1;

function resetIds() {
    _nextTabId = 1000;
    _nextEventId = 1;
}

function makeTabId() {
    return _nextTabId++;
}

function makeEventId() {
    return `evt-${_nextEventId++}`;
}

function extractDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

/**
 * Generate a realistic session of tab events.
 * @param {number} startTime - Timestamp for the first event
 * @param {Array<{url: string, title: string}>} tabs - Tabs to open in order
 * @returns {Array} Array of tab events
 */
function generateSession(startTime, tabs) {
    const events = [];
    let t = startTime;

    for (let i = 0; i < tabs.length; i++) {
        const tabId = makeTabId();
        const domain = extractDomain(tabs[i].url);

        // Created event
        events.push({
            id: makeEventId(),
            type: 'created',
            domain,
            url: tabs[i].url,
            title: tabs[i].title,
            timestamp: t,
            tabId,
        });

        // Activated event 2-3 seconds later
        t += 2000 + Math.floor(Math.random() * 1000);
        events.push({
            id: makeEventId(),
            type: 'activated',
            domain,
            url: tabs[i].url,
            title: tabs[i].title,
            timestamp: t,
            tabId,
        });

        // Gap before next tab: 5-10 seconds
        t += 5000 + Math.floor(Math.random() * 5000);
    }

    // Sprinkle some random tab-switch (activated) events within the session
    const tabList = tabs.map((tab, idx) => ({
        ...tab,
        domain: extractDomain(tab.url),
        tabId: 1000 + idx + (_nextTabId - tabs.length - 1000),
    }));
    // Actually, let's use the real tabIds. We stored them sequentially starting
    // from the value before the loop. Let's just add a couple of re-activations.
    const sessionEndTime = t;
    for (let i = 0; i < Math.min(3, tabs.length); i++) {
        const randomTab = tabs[Math.floor(Math.random() * tabs.length)];
        t = sessionEndTime + (i + 1) * 3000;
        events.push({
            id: makeEventId(),
            type: 'activated',
            domain: extractDomain(randomTab.url),
            url: randomTab.url,
            title: randomTab.title,
            timestamp: t,
            tabId: makeTabId(),
        });
    }

    return events;
}

// ── Scenarios ────────────────────────────────────────────────

function studentMultipleCourses() {
    resetIds();
    const now = Date.now();
    const dayAgo = now - 1 * DAY;

    const session1Start = dayAgo + 9 * HOUR; // 9am yesterday
    const session2Start = dayAgo + 11 * HOUR; // 11am
    const session3Start = dayAgo + 14 * HOUR; // 2pm
    const session4Start = dayAgo + 20 * HOUR; // 8pm

    const session1 = generateSession(session1Start, [
        { url: 'https://quercus.utoronto.ca/courses/ECE110', title: 'ECE110 - Signals' },
        { url: 'https://overleaf.com/project/lab-report', title: 'Lab Report 3' },
        { url: 'https://matlab.com/simulation', title: 'MATLAB Simulator' },
    ]);

    const session2 = generateSession(session2Start, [
        { url: 'https://quercus.utoronto.ca/courses/APS105', title: 'APS105 - Computer Fundamentals' },
        { url: 'https://onlinegdb.com/c-compiler', title: 'Online C Compiler' },
        { url: 'https://cplusplus.com/reference', title: 'C++ Reference' },
    ]);

    const session3 = generateSession(session3Start, [
        { url: 'https://quercus.utoronto.ca/courses/ECE110', title: 'ECE110 - Signals' },
        { url: 'https://overleaf.com/project/lab-report', title: 'Lab Report 3' },
        { url: 'https://matlab.com/simulation', title: 'MATLAB Simulator' },
    ]);

    const session4 = generateSession(session4Start, [
        { url: 'https://quercus.utoronto.ca/courses/MAT292', title: 'MAT292 - Calculus' },
        { url: 'https://wolframalpha.com', title: 'Wolfram Alpha' },
        { url: 'https://khanacademy.org/math', title: 'Khan Academy - Calculus' },
    ]);

    const events = [...session1, ...session2, ...session3, ...session4];

    return {
        name: 'Student - Multiple Courses',
        description: 'A student juggling 3 different courses on the same day',
        simulates: 'Same-day context switching with shared tools (Quercus)',
        timespan: '1 day',
        events,
    };
}

function canvaThreeProjects() {
    resetIds();
    const now = Date.now();
    const dayAgo = now - 1 * DAY;

    const session1 = generateSession(dayAgo + 9 * HOUR, [
        { url: 'https://canva.com/design/instagram-post', title: 'Instagram Post Design' },
        { url: 'https://instagram.com', title: 'Instagram' },
        { url: 'https://buffer.com', title: 'Buffer - Schedule Posts' },
    ]);

    const session2 = generateSession(dayAgo + 14 * HOUR, [
        { url: 'https://canva.com/design/client-deck', title: 'Client Presentation' },
        { url: 'https://slides.google.com/presentation', title: 'Google Slides' },
        { url: 'https://acmecorp.com/dashboard', title: 'Acme Corp Dashboard' },
    ]);

    const session3 = generateSession(dayAgo + 19 * HOUR, [
        { url: 'https://canva.com/design/poster', title: 'Research Poster' },
        { url: 'https://quercus.utoronto.ca/courses/ECE110', title: 'ECE110' },
        { url: 'https://docs.google.com/document', title: 'Research Notes' },
    ]);

    return {
        name: 'Canva - Three Projects',
        description: 'Using Canva for 3 completely different projects on the same day',
        simulates: 'Same tool (Canva) in multiple unrelated projects',
        timespan: '1 day',
        events: [...session1, ...session2, ...session3],
    };
}

function freelancerMultipleClients() {
    resetIds();
    const now = Date.now();

    // Days 1-2: Client A
    const clientA1 = generateSession(now - 7 * DAY + 10 * HOUR, [
        { url: 'https://figma.com/client-a', title: 'Client A Mockups' },
        { url: 'https://slack.com/client-a-workspace', title: 'Client A Workspace' },
        { url: 'https://github.com/client-a-repo', title: 'Client A Repository' },
    ]);
    const clientA2 = generateSession(now - 6 * DAY + 10 * HOUR, [
        { url: 'https://figma.com/client-a', title: 'Client A Mockups' },
        { url: 'https://slack.com/client-a-workspace', title: 'Client A Workspace' },
        { url: 'https://github.com/client-a-repo', title: 'Client A Repository' },
    ]);

    // Days 3-4: Client B
    const clientB1 = generateSession(now - 5 * DAY + 10 * HOUR, [
        { url: 'https://figma.com/client-b', title: 'Client B Designs' },
        { url: 'https://slack.com/client-b-workspace', title: 'Client B Workspace' },
        { url: 'https://github.com/client-b-repo', title: 'Client B Repository' },
    ]);
    const clientB2 = generateSession(now - 4 * DAY + 10 * HOUR, [
        { url: 'https://figma.com/client-b', title: 'Client B Designs' },
        { url: 'https://slack.com/client-b-workspace', title: 'Client B Workspace' },
        { url: 'https://github.com/client-b-repo', title: 'Client B Repository' },
    ]);

    // Days 5-6: Client C
    const clientC1 = generateSession(now - 3 * DAY + 10 * HOUR, [
        { url: 'https://figma.com/client-c', title: 'Client C Project' },
        { url: 'https://notion.com/client-c', title: 'Client C Docs' },
        { url: 'https://trello.com/client-c', title: 'Client C Board' },
    ]);
    const clientC2 = generateSession(now - 2 * DAY + 10 * HOUR, [
        { url: 'https://figma.com/client-c', title: 'Client C Project' },
        { url: 'https://notion.com/client-c', title: 'Client C Docs' },
        { url: 'https://trello.com/client-c', title: 'Client C Board' },
    ]);

    // Day 7: Back to Client A
    const clientA3 = generateSession(now - 1 * DAY + 10 * HOUR, [
        { url: 'https://figma.com/client-a', title: 'Client A Mockups' },
        { url: 'https://slack.com/client-a-workspace', title: 'Client A Workspace' },
        { url: 'https://github.com/client-a-repo', title: 'Client A Repository' },
    ]);

    return {
        name: 'Freelancer - Multiple Clients',
        description: 'Freelancer working on 3 different client projects throughout the week',
        simulates: 'Similar tools (Figma, Slack, GitHub) for different clients across multiple days',
        timespan: '7 days',
        events: [...clientA1, ...clientA2, ...clientB1, ...clientB2, ...clientC1, ...clientC2, ...clientA3],
    };
}

function rapidContextSwitching() {
    resetIds();
    const now = Date.now();
    const sessionStart = now - 1 * HOUR;

    // All within 30 minutes, gaps < 10 min (single session)
    const events = [];
    let t = sessionStart;

    const segments = [
        // 0-5 min: Client A
        [
            { url: 'https://figma.com/client-a', title: 'Client A Mockups' },
            { url: 'https://slack.com/client-a', title: 'Client A Slack' },
        ],
        // 5-10 min: Client B
        [
            { url: 'https://notion.com/client-b', title: 'Client B Notes' },
            { url: 'https://trello.com/client-b', title: 'Client B Board' },
        ],
        // 10-15 min: Back to Client A
        [
            { url: 'https://figma.com/client-a', title: 'Client A Mockups' },
            { url: 'https://slack.com/client-a', title: 'Client A Slack' },
        ],
        // 15-20 min: Personal
        [
            { url: 'https://instagram.com', title: 'Instagram' },
            { url: 'https://canva.com/personal', title: 'Personal Design' },
        ],
        // 20-25 min: Back to Client A
        [
            { url: 'https://figma.com/client-a', title: 'Client A Mockups' },
            { url: 'https://slack.com/client-a', title: 'Client A Slack' },
        ],
    ];

    for (const segment of segments) {
        events.push(...generateSession(t, segment));
        t += 5 * MINUTE; // 5-minute segments, all within one session gap
    }

    return {
        name: 'Rapid Context Switching',
        description: 'ADHD-style work pattern — switching between projects every 5 minutes',
        simulates: 'Multiple projects within one session (no 10-min gaps)',
        timespan: '1 hour',
        events,
    };
}

function spotifyBackground() {
    resetIds();
    const now = Date.now();
    const dayAgo = now - 1 * DAY;

    // Spotify is opened once and stays active throughout
    const spotifyTab = makeTabId();
    const spotifyDomain = 'open.spotify.com';
    const spotifyUrl = 'https://open.spotify.com/playlist/daily-mix';
    const spotifyTitle = 'Daily Mix - Spotify';

    const events = [];

    // Open Spotify at 9am
    const spotifyStart = dayAgo + 9 * HOUR;
    events.push({
        id: makeEventId(), type: 'created', domain: spotifyDomain,
        url: spotifyUrl, title: spotifyTitle, timestamp: spotifyStart, tabId: spotifyTab,
    });
    events.push({
        id: makeEventId(), type: 'activated', domain: spotifyDomain,
        url: spotifyUrl, title: spotifyTitle, timestamp: spotifyStart + 2000, tabId: spotifyTab,
    });

    // Session 1: Coding 9am-12pm
    const coding = generateSession(dayAgo + 9 * HOUR + 5 * MINUTE, [
        { url: 'https://github.com/my-repo', title: 'My Repository' },
        { url: 'https://stackoverflow.com/questions', title: 'Stack Overflow' },
    ]);
    // Re-activate spotify mid-session
    coding.push({
        id: makeEventId(), type: 'activated', domain: spotifyDomain,
        url: spotifyUrl, title: spotifyTitle, timestamp: dayAgo + 10 * HOUR, tabId: spotifyTab,
    });

    // Session 2: Writing 2pm-5pm
    const writing = generateSession(dayAgo + 14 * HOUR, [
        { url: 'https://notion.com/my-notes', title: 'My Notes' },
        { url: 'https://grammarly.com', title: 'Grammarly' },
    ]);
    writing.push({
        id: makeEventId(), type: 'activated', domain: spotifyDomain,
        url: spotifyUrl, title: spotifyTitle, timestamp: dayAgo + 15 * HOUR, tabId: spotifyTab,
    });

    // Session 3: Design 7pm-9pm
    const design = generateSession(dayAgo + 19 * HOUR, [
        { url: 'https://figma.com/my-design', title: 'My Design' },
        { url: 'https://pinterest.com/inspiration', title: 'Pinterest Inspiration' },
    ]);
    design.push({
        id: makeEventId(), type: 'activated', domain: spotifyDomain,
        url: spotifyUrl, title: spotifyTitle, timestamp: dayAgo + 20 * HOUR, tabId: spotifyTab,
    });

    events.push(...coding, ...writing, ...design);

    return {
        name: 'Spotify Background',
        description: 'Spotify open in background while working on 3 different projects',
        simulates: 'Long-running background tab pollution',
        timespan: '1 day',
        events,
    };
}

function coffeeBreakGap() {
    resetIds();
    const now = Date.now();
    const todayStart = now - 3 * HOUR;

    // Session 1: Coding 9:00-9:30
    const coding1 = generateSession(todayStart, [
        { url: 'https://github.com/my-project', title: 'My Project - GitHub' },
        { url: 'https://stackoverflow.com/questions/async', title: 'How to use async/await' },
    ]);

    // Coffee break 9:30-9:45 (15 min gap — exceeds session threshold? depends on settings)
    // YouTube shorts during break
    const coffeeBreak = generateSession(todayStart + 30 * MINUTE, [
        { url: 'https://youtube.com/shorts/abc123', title: 'Funny Cat Video' },
    ]);

    // Session 2: Resume coding 9:45-10:15 (15 min after coffee break start)
    const coding2 = generateSession(todayStart + 45 * MINUTE, [
        { url: 'https://github.com/my-project', title: 'My Project - GitHub' },
        { url: 'https://stackoverflow.com/questions/promises', title: 'JavaScript Promises Guide' },
    ]);

    return {
        name: 'Coffee Break Gap',
        description: 'Working on same project with a 15-minute coffee break (YouTube Shorts)',
        simulates: 'Session gap testing — should merge into one project despite gap',
        timespan: '2 hours',
        events: [...coding1, ...coffeeBreak, ...coding2],
    };
}

function procrastinationDrift() {
    resetIds();
    const now = Date.now();
    const sessionStart = now - 1 * HOUR;

    // 9:00-9:20: Coding (within one session)
    const coding1 = generateSession(sessionStart, [
        { url: 'https://github.com/my-project', title: 'My Project - GitHub' },
        { url: 'https://stackoverflow.com/questions/react', title: 'React Hooks Guide' },
    ]);

    // 9:20-9:45: YouTube rabbit hole (still within same session — no 10-min gap)
    const youtube = generateSession(sessionStart + 8 * MINUTE, [
        { url: 'https://youtube.com/watch?v=cat1', title: 'Funny Cat Compilation' },
        { url: 'https://youtube.com/watch?v=music1', title: 'Lo-fi Hip Hop Radio' },
        { url: 'https://youtube.com/watch?v=tech1', title: 'Why React is Amazing' },
    ]);

    // 9:45-10:00: Back to coding (no gap, just switching back)
    const coding2 = generateSession(sessionStart + 25 * MINUTE, [
        { url: 'https://github.com/my-project', title: 'My Project - GitHub' },
        { url: 'https://stackoverflow.com/questions/state', title: 'React State Management' },
    ]);

    return {
        name: 'Procrastination Drift',
        description: 'Start coding, drift to YouTube, come back to coding',
        simulates: 'Distraction filtering — YouTube should be excluded',
        timespan: '1 hour',
        events: [...coding1, ...youtube, ...coding2],
    };
}

function deepResearcher() {
    resetIds();
    const now = Date.now();

    // Day 1: Initial research (10 tabs)
    const day1Tabs = [
        { url: 'https://arxiv.org/abs/2301.01234', title: 'Attention Is All You Need v2' },
        { url: 'https://arxiv.org/abs/2302.05678', title: 'Scaling Laws for Neural LMs' },
        { url: 'https://en.wikipedia.org/wiki/Transformer_(machine_learning_model)', title: 'Transformer - Wikipedia' },
        { url: 'https://scholar.google.com/search/transformers', title: 'Google Scholar - Transformers' },
        { url: 'https://paperswithcode.com/method/transformer', title: 'Papers With Code - Transformer' },
        { url: 'https://arxiv.org/abs/2303.09012', title: 'Vision Transformers Survey' },
        { url: 'https://distill.pub/2021/gnn', title: 'Understanding GNNs' },
        { url: 'https://huggingface.co/docs/transformers', title: 'HuggingFace Docs' },
        { url: 'https://lilianweng.github.io/attention', title: 'Attention Mechanisms - Lilian Weng' },
        { url: 'https://jalammar.github.io/illustrated-transformer', title: 'Illustrated Transformer' },
    ];
    const day1 = generateSession(now - 3 * DAY + 10 * HOUR, day1Tabs);

    // Day 2: Deep dive (10 new tabs + some revisits)
    const day2Tabs = [
        { url: 'https://arxiv.org/abs/2304.11111', title: 'Efficient Attention Mechanisms' },
        { url: 'https://github.com/related-repo/transformer-impl', title: 'Transformer Implementation' },
        { url: 'https://en.wikipedia.org/wiki/Transformer_(machine_learning_model)', title: 'Transformer - Wikipedia' },
        { url: 'https://scholar.google.com/search/efficient-attention', title: 'Google Scholar - Efficient Attention' },
        { url: 'https://arxiv.org/abs/2305.22222', title: 'Flash Attention Paper' },
        { url: 'https://openreview.net/forum?id=abc', title: 'OpenReview - Flash Attention' },
        { url: 'https://proceedings.neurips.cc/paper/2023', title: 'NeurIPS 2023 Proceedings' },
        { url: 'https://blog.research.google/transformers', title: 'Google Research Blog' },
        { url: 'https://pytorch.org/docs/attention', title: 'PyTorch Attention Docs' },
        { url: 'https://wandb.ai/experiments/attention', title: 'W&B Attention Experiments' },
    ];
    const day2 = generateSession(now - 2 * DAY + 10 * HOUR, day2Tabs);

    // Day 3: Review (revisiting some from both days)
    const day3Tabs = [
        { url: 'https://arxiv.org/abs/2301.01234', title: 'Attention Is All You Need v2' },
        { url: 'https://arxiv.org/abs/2304.11111', title: 'Efficient Attention Mechanisms' },
        { url: 'https://scholar.google.com/search/transformers', title: 'Google Scholar - Transformers' },
    ];
    const day3 = generateSession(now - 1 * DAY + 14 * HOUR, day3Tabs);

    return {
        name: 'Deep Research',
        description: 'Opening 20+ tabs incrementally over 3 days for one research paper',
        simulates: 'Incremental tab opening — might incorrectly split into multiple projects',
        timespan: '3 days',
        events: [...day1, ...day2, ...day3],
    };
}

function oldProject() {
    resetIds();
    const now = Date.now();

    // 8 days ago — should trigger archival
    const session = generateSession(now - 8 * DAY + 14 * HOUR, [
        { url: 'https://github.com/old-repo', title: 'Old Repo - GitHub' },
        { url: 'https://figma.com/old-design', title: 'Old Design - Figma' },
        { url: 'https://notion.com/old-notes', title: 'Old Notes - Notion' },
    ]);

    return {
        name: 'Old Project',
        description: "Project that hasn't been touched in 8 days (should be archived)",
        simulates: 'Archival system — archived flag should be true',
        timespan: '8 days ago',
        events: session,
    };
}

function randomMix() {
    resetIds();
    const now = Date.now();

    // Student pattern (2 days ago)
    const studentSession = generateSession(now - 2 * DAY + 10 * HOUR, [
        { url: 'https://quercus.utoronto.ca/courses/ECE110', title: 'ECE110 - Signals' },
        { url: 'https://overleaf.com/project/lab-report', title: 'Lab Report 3' },
        { url: 'https://matlab.com/simulation', title: 'MATLAB Simulator' },
    ]);

    const studentSession2 = generateSession(now - 2 * DAY + 14 * HOUR, [
        { url: 'https://quercus.utoronto.ca/courses/APS105', title: 'APS105 - Computer Fundamentals' },
        { url: 'https://onlinegdb.com/c-compiler', title: 'Online C Compiler' },
    ]);

    // Freelancer pattern (4 days ago)
    const freelancerSession = generateSession(now - 4 * DAY + 10 * HOUR, [
        { url: 'https://figma.com/client-x', title: 'Client X Mockups' },
        { url: 'https://slack.com/client-x', title: 'Client X Slack' },
        { url: 'https://github.com/client-x-repo', title: 'Client X Repo' },
    ]);

    // Procrastination (today)
    const procrastination = generateSession(now - 2 * HOUR, [
        { url: 'https://youtube.com/watch?v=random1', title: 'Random YouTube Video' },
        { url: 'https://reddit.com/r/programming', title: 'r/programming' },
        { url: 'https://twitter.com/home', title: 'Twitter / X' },
    ]);

    // Spotify throughout
    const spotifyEvents = [];
    const spotifyTab = makeTabId();
    for (let d = 4; d >= 0; d--) {
        spotifyEvents.push({
            id: makeEventId(), type: 'activated',
            domain: 'open.spotify.com',
            url: 'https://open.spotify.com/playlist/daily-mix',
            title: 'Daily Mix - Spotify',
            timestamp: now - d * DAY + 12 * HOUR,
            tabId: spotifyTab,
        });
    }

    // Some coding (today)
    const codingToday = generateSession(now - 1 * HOUR, [
        { url: 'https://github.com/my-side-project', title: 'Side Project - GitHub' },
        { url: 'https://stackoverflow.com/questions/typescript', title: 'TypeScript Tips' },
        { url: 'https://docs.github.com/actions', title: 'GitHub Actions Docs' },
    ]);

    return {
        name: 'Random Mix',
        description: 'Combination of multiple realistic patterns',
        simulates: 'Real-world messy browsing',
        timespan: '7 days',
        events: [
            ...freelancerSession, ...studentSession, ...studentSession2,
            ...procrastination, ...spotifyEvents, ...codingToday,
        ],
    };
}

// ── Exports ──────────────────────────────────────────────────

export const ALL_SCENARIOS = [
    { id: 'student', emoji: '👨‍🎓', label: 'Student - 3 Courses', generate: studentMultipleCourses },
    { id: 'canva', emoji: '🎨', label: 'Canva - 3 Projects', generate: canvaThreeProjects },
    { id: 'freelancer', emoji: '💼', label: 'Freelancer - 3 Clients', generate: freelancerMultipleClients },
    { id: 'rapid', emoji: '⚡', label: 'Rapid Switching', generate: rapidContextSwitching },
    { id: 'spotify', emoji: '🎵', label: 'Spotify Background', generate: spotifyBackground },
    { id: 'coffee', emoji: '☕', label: 'Coffee Break Gap', generate: coffeeBreakGap },
    { id: 'procrastination', emoji: '📱', label: 'Procrastination Drift', generate: procrastinationDrift },
    { id: 'researcher', emoji: '📚', label: 'Deep Researcher', generate: deepResearcher },
    { id: 'old', emoji: '📦', label: 'Old Project (7+ days)', generate: oldProject },
    { id: 'random', emoji: '🎲', label: 'Random Mix', generate: randomMix },
];
