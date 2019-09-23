'use strict';
const https = require('https');
const fs = require('fs');
const url = require('url');
const path = require('path');

const PUBLIC_DIR = 'public';

const serverRoot = process.cwd();

let household = {
    kitchen: {
        lights: {stove: false, ceiling: false},
        temperature: 24
    },
    livingroom: {
        lights: {sofa: true, ceiling: false},
        temperature: 22
    },
    bedroom: {
        lights: {bed: true, ceiling: false},
        temperature: 20
    }
};

const sslOptions = {
    key: fs.readFileSync('cert/server.key'),
    cert: fs.readFileSync('cert/server.crt')
};

const server = https.createServer(sslOptions, (req, res) => {
    try {
        route(req, res);
    } catch (e) {
        if (e instanceof URIError) {
            // Feedback from lab 1 :)
            respondWithBadRequest(res);
        } else {
            // Should some unhandled synchronous call slip through.
            console.error(e);
            respondWithInternalServerError(res);
        }
    }
});

server.listen(8000);

// I didn't follow the recommendation for two routing tables here. This is simple too.
function route(req, res) {
    let path = url.parse(req.url, true).pathname;
    if (path.match(/^\/[a-zA-Z]+\/lights\/[a-zA-Z]+$/)) {
        let roomAndLight = path.substr(1).split("/");
        if (req.method === 'GET') {
            getLightStatus(roomAndLight[0], roomAndLight[2], res);
        } else if (req.method === 'POST') {
            toggleLight(roomAndLight[0], roomAndLight[2], res);
        } else {
            respondWithMethodNotAllowed(res);
        }
    } else if (path.match(/^\/[a-zA-Z]+\/temperature+$/)) {
        if (req.method === 'GET') {
            getTemperature(path.substr(1).split("/")[0], res);
        } else {
            respondWithMethodNotAllowed(res);
        }
    } else {
        if (req.method === 'GET') {
            staticContent(req, res);
        } else {
            respondWithMethodNotAllowed(res);
        }
    }
}

function getLightStatus(room, light, res) {
    respondWithStatusAsJSON({room: room, light: light, status: household[room].lights[light]}, res);
}

function toggleLight(room, light, res) {
    household[room].lights[light] = !household[room].lights[light];
    respondWithStatusAsJSON({room: room, light: light, status: household[room].lights[light]}, res);
}

function getTemperature(room, res) {
    respondWithStatusAsJSON({room: room, temperature: household[room].temperature}, res);
}

function respondWithStatusAsJSON(status, res) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(status));
}

////////////////////////////////////////////////
// Reused from lab 1 without modification starts
////////////////////////////////////////////////
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

/////////////////////////////////////////////
// Reuse from lab 1 without modification ends
/////////////////////////////////////////////
