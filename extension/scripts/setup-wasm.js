/**
 * LatencyLens — WASM Setup Script
 *
 * Downloads tree-sitter WASM files needed for AST-based C++ analysis.
 * Run with: npm run setup-wasm
 *
 * Downloads:
 * - tree-sitter.wasm (core parser runtime)
 * - tree-sitter-cpp.wasm (C++ grammar)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WASM_DIR = path.join(__dirname, '..', 'wasm');

const FILES = [
    {
        name: 'tree-sitter.wasm',
        url: 'https://unpkg.com/web-tree-sitter@0.22.6/tree-sitter.wasm',
    },
    {
        name: 'tree-sitter-cpp.wasm',
        // From tree-sitter grammars repository
        url: 'https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-cpp.wasm',
    },
];

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get = url.startsWith('https') ? https.get : http.get;

        get(url, (response) => {
            // Follow redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                download(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode} for ${url}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', reject);
    });
}

async function main() {
    // Create wasm directory
    if (!fs.existsSync(WASM_DIR)) {
        fs.mkdirSync(WASM_DIR, { recursive: true });
        console.log(`Created ${WASM_DIR}`);
    }

    for (const file of FILES) {
        const dest = path.join(WASM_DIR, file.name);
        if (fs.existsSync(dest)) {
            const stats = fs.statSync(dest);
            if (stats.size > 1000) {
                console.log(`✓ ${file.name} already exists (${(stats.size / 1024).toFixed(0)}KB)`);
                continue;
            }
        }
        console.log(`Downloading ${file.name}...`);
        try {
            await download(file.url, dest);
            const stats = fs.statSync(dest);
            console.log(`✓ ${file.name} (${(stats.size / 1024).toFixed(0)}KB)`);
        } catch (e) {
            console.error(`✗ Failed to download ${file.name}: ${e.message}`);
            console.error('  The extension will fall back to enhanced regex analysis.');
        }
    }

    console.log('\nWASM setup complete.');
}

main().catch(console.error);
