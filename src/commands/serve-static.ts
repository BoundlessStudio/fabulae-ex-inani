#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const cwd = process.cwd();

const contentTypes = new Map([
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".svg", "image/svg+xml"],
    [".webp", "image/webp"],
    [".map", "application/json; charset=utf-8"],
    [".txt", "text/plain; charset=utf-8"],
]);

function sendText(response, status, message) {
    response.writeHead(status, {"content-type": "text/plain; charset=utf-8"});
    response.end(message);
}

function safeFilePath(rootDir, urlPathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPathname);
    } catch {
        return undefined;
    }

    const relativePath = decoded.replace(/^\/+/, "") || "index.html";
    const resolved = path.resolve(rootDir, relativePath);
    const relativeToRoot = path.relative(rootDir, resolved);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return undefined;
    return resolved;
}

export function runServeStaticCommand(argv = process.argv.slice(2)) {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(`Usage: world-mapgen serve-legends [viewer-dir] [port]

Defaults:
  viewer-dir  output/legends
  port        PORT environment variable or 8787
`);
        return;
    }

    const rootArg = argv[0] || "output/legends";
    const portArg = argv[1] || process.env.PORT || "8787";
    const rootDir = path.resolve(cwd, rootArg);
    const port = Number(portArg);

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        console.error(`Invalid port "${portArg}"`);
        process.exit(2);
    }

    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        console.error(`Directory not found: ${rootDir}`);
        process.exit(2);
    }

    const server = http.createServer((request, response) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
            sendText(response, 405, "Method not allowed");
            return;
        }

        const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
        let filePath = safeFilePath(rootDir, requestUrl.pathname);
        if (!filePath) {
            sendText(response, 403, "Forbidden");
            return;
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, "index.html");
        }

        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            sendText(response, 404, "Not found");
            return;
        }

        response.writeHead(200, {
            "content-type": contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
            "cache-control": "no-store",
        });

        if (request.method === "HEAD") {
            response.end();
            return;
        }

        fs.createReadStream(filePath).pipe(response);
    });

    server.listen(port, "127.0.0.1", () => {
        const rootUrl = new URL(`http://127.0.0.1:${port}/`);
        console.log(`Serving ${rootDir}`);
        console.log(`Open ${rootUrl.href}`);
    });

    process.on("SIGINT", () => server.close(() => process.exit(0)));
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
