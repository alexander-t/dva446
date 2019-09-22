'use strict';
const http = require('http');
const fs = require('fs');
const url = require('url');
const path = require('path');
const createDOMPurify = require('dompurify');
const {JSDOM} = require('jsdom');
const window = (new JSDOM('')).window;
const DOMPurify = createDOMPurify(window);

const PUBLIC_DIR = 'public';
const TEMPLATE_DIR = 'templates';
const MAX_URL_LENGTH = 2000; // Rough approximation based on RFC 2616
const DEFAULT_MIME_TYPE = 'application/octet-stream';

const serverRoot = process.cwd();

let routes = {};

verifyServerDirectories(serverRoot);
// Here an elevated privileges check should be performed, but it's lab 1.1...

addRoute('/information', information);

const server = http.createServer((req, res) => {
    try {
        route(req, res);
    } catch (e) {
        if (e instanceof URIError) {
            respondWithBadRequest(res);
        } else {
            // Should some unhandled synchronous call slip through.
            console.error(e);
            respondWithInternalServerError(res);
        }
    }
});

server.listen(8000);

function addRoute(route, handler) {
    // This is restrictive, yes, but the goal is to support robust routes, not to please people who want esoteric paths
    if (!route.match(/^(\/[a-zA-Z0-9_\-]+)+$/)) {
        throw new Error('Routes must start with a / and they must contain only letters, digits, and dashes');
    }

    if (handler && typeof handler === 'function') {
        routes[route] = handler;
    } else {
        throw new Error(`Invalid route handler for ${route}`);
    }
}

function route(req, res) {

    // Allowing only GET and not HEAD is a little stingy, but it reduces the code size and complexity
    if (req.method === 'GET') {
        if (req.url.length > MAX_URL_LENGTH) {
            respondWithURITooLong(res);
        } else {
            let parsedUrl = url.parse(req.url, true);
            let path = decodeURIComponent(parsedUrl.pathname);
            if (routes.hasOwnProperty(path)) {
                routes[path].call(null, req, res);
            } else {
                staticContent(req, res);
            }
        }
    } else {
        respondWithMethodNotAllowed(res);
    }
}

// Doesn't handle the case of the template being not an HTML file or too large, but the main thing here is the
// resilience to XSS.
function information(req, res) {
    let templatePath = path.join(serverRoot, TEMPLATE_DIR, 'information.template');
    fs.readFile(templatePath, 'utf8', (error, content) => {
        if (error) {
            respondWithInternalServerError(res);
        } else {
            res.writeHead(200, {'Content-Type': 'text/html'});
            let parsedUrl = url.parse(req.url, true);
            let sanitizedQuery = DOMPurify.sanitize(parsedUrl.search);
            content = content.replace('{{method}}', req.method).replace('{{path}}', parsedUrl.pathname);
            if (sanitizedQuery) {
                content = content.replace('{{query}}', sanitizedQuery);
                let queries = '';
                sanitizedQuery.substr(1).split('&amp;').forEach((e) => {
                    queries += `<li>${e}</li>`;
                });
                content = content.replace('{{queries}}', queries);
            } else {
                content = content.replace('{{query}}', '').replace('{{queries}}', '');
            }
            res.end(content);
        }
    });
}

function staticContent(req, res) {
    let parsedUrl = url.parse(req.url, true);
    let filePath = path.join(serverRoot, PUBLIC_DIR, decodeURIComponent(parsedUrl.pathname));
    console.log(`[${new Date().toString()}] ${req.url} => ${filePath}`);

    fs.stat(filePath, (err, stats) => {
        if (err) {
            if (err.code === 'ENOENT') {
                respondWithFileNotFound(res);
            } else {
                respondWithInternalServerError(res);
            }
        } else {
            if (stats.isFile()) {
                serveFileAsStream(filePath, res, respondWithFileNotFound);
            } else {
                if (stats.isDirectory()) {
                    let indexHtmlPath = path.join(filePath, 'index.html');
                    serveFileAsStream(indexHtmlPath, res, respondWithForbidden);
                } else {
                    respondWithForbidden(res);
                }
            }
        }
    });
}

/**
 * Serves a file as a stream to allow large files without clogging the memory.
 * @param {string} filePath - File path to serve
 * @param res response - Response to write to
 * @param {function} notFoundHandler - Handler to invoke if the file doesn't exist
 */
function serveFileAsStream(filePath, res, notFoundHandler) {
    let sout = fs.createReadStream(filePath);
    sout.on('open', () => {
        res.writeHead(200, {'Content-Type': getMimeType(filePath)});
    }).on('data', (data) => {
        res.write(data.toString());
    }).on('close', () => {
        res.end();
    }).on('error', (err) => {
        if (err.code === 'ENOENT') {
            notFoundHandler.call(null, res);
        } else {
            respondWithInternalServerError(res);
        }
    });
}

/**
 * Returns a mime type for the file at the end of the specified path. Only the most common mime types are
 * supported.
 * @param {string} path - path to extract the mime type from
 * @returns {string} the mime type deduced from the path or application/octet-stream
 */
function getMimeType(path) {
    const mimeTypes = {
        'html': 'text/html',
        'js': 'text/javascript',
        'css': 'text/css',
        'txt': 'text/plain',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'zip': 'application/zip',
    };

    if (path) {
        let extension = path.toLowerCase().split('.').pop();
        return mimeTypes[extension] ? mimeTypes[extension] : DEFAULT_MIME_TYPE;
    } else {
        return DEFAULT_MIME_TYPE;
    }
}

/* Verifies that there's a public directory in the current working directory. Doesn't guard against removal
  during operation, but ensures a sane startup.
 */
function verifyServerDirectories(serverRoot) {
    verifyDirectory(path.join(serverRoot, PUBLIC_DIR));
    verifyDirectory(path.join(serverRoot, TEMPLATE_DIR));
}

function verifyDirectory(dir) {
    fs.accessSync(dir, fs.constants.F_OK | fs.constants.R_OK);
    if (!fs.lstatSync(dir).isDirectory()) {
        throw new Error(`${dir} exists, but isn't a directory`);
    }
}

// Yes, these four could obviously be parameterized, but their current form promotes readability
function respondWithInternalServerError(res) {
    res.writeHead(500);
    res.end();
}

function respondWithBadRequest(res) {
    res.writeHead(400);
    res.end();
}

function respondWithForbidden(res) {
    res.writeHead(403);
    res.end();
}

function respondWithFileNotFound(res) {
    res.writeHead(404);
    res.end();
}

function respondWithMethodNotAllowed(res) {
    res.writeHead(405);
    res.end();
}

function respondWithURITooLong(res) {
    res.writeHead(414);
    res.end();
}

