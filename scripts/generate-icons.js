/**
 * Generate simple PNG icons for the Tabs extension.
 * Uses raw PNG binary construction — no dependencies.
 *
 * Creates a warm tan (#D4A574) circle on a cream (#FAF9F7) background.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 48, 128];
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Colors
const BG = { r: 250, g: 249, b: 247 };       // #FAF9F7
const ACCENT = { r: 212, g: 165, b: 116 };   // #D4A574
const DARK = { r: 45, g: 43, b: 40 };        // #2D2B28

function createPNG(size) {
    const channels = 4; // RGBA
    const rawData = [];

    const cx = size / 2;
    const cy = size / 2;
    const outerR = size * 0.42;
    const innerR = size * 0.28;

    for (let y = 0; y < size; y++) {
        rawData.push(0); // PNG filter byte: None
        for (let x = 0; x < size; x++) {
            const dx = x - cx + 0.5;
            const dy = y - cy + 0.5;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= innerR) {
                // Inner dark circle (the "tab" icon center)
                rawData.push(DARK.r, DARK.g, DARK.b, 255);
            } else if (dist <= outerR) {
                // Outer accent ring
                rawData.push(ACCENT.r, ACCENT.g, ACCENT.b, 255);
            } else if (dist <= outerR + 1.5) {
                // Anti-alias edge
                const alpha = Math.max(0, Math.min(255, Math.round((outerR + 1.5 - dist) * 170)));
                rawData.push(ACCENT.r, ACCENT.g, ACCENT.b, alpha);
            } else {
                // Transparent background
                rawData.push(0, 0, 0, 0);
            }
        }
    }

    const rawBuf = Buffer.from(rawData);
    const compressed = zlib.deflateSync(rawBuf);

    // Build PNG
    const chunks = [];

    // Signature
    chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    // IHDR
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr.writeUInt8(8, 8);   // bit depth
    ihdr.writeUInt8(6, 9);   // color type: RGBA
    ihdr.writeUInt8(0, 10);  // compression
    ihdr.writeUInt8(0, 11);  // filter
    ihdr.writeUInt8(0, 12);  // interlace
    chunks.push(makeChunk('IHDR', ihdr));

    // IDAT
    chunks.push(makeChunk('IDAT', compressed));

    // IEND
    chunks.push(makeChunk('IEND', Buffer.alloc(0)));

    return Buffer.concat(chunks);
}

function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);

    const typeB = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeB, data]);

    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData) >>> 0, 0);

    return Buffer.concat([len, typeB, data, crc]);
}

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
    }
    return crc ^ 0xFFFFFFFF;
}

// Generate
if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

for (const size of SIZES) {
    const png = createPNG(size);
    const outPath = path.join(ASSETS_DIR, `icon-${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`Created ${outPath} (${png.length} bytes)`);
}

console.log('Done!');
