'use strict';
const https = require('https');
const fs = require('fs');
const url = require('url');
const path = require('path');
const querystring = require('querystring');
const cookie = require('cookie');

const PUBLIC_DIR = 'public';
const TEMPLATE_DIR = 'templates';
const PASSWD_FILE = 'passwd';
const MAX_LOGIN_PAGE_BODY = 4096;
const SESSION_COOKIE = 'athome-session';
const DEFAULT_MIME_TYPE = 'application/octet-stream';

const serverRoot = process.cwd();
let nextSessionId = 1;
// This ever-growing array can cause an DoS attack :)
let activeSessions = [];

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

// No error handling for SSL options and passwords... Let's save some space.
const sslOptions = {
    key: fs.readFileSync('cert/server.key'),
    cert: fs.readFileSync('cert/server.crt')
};
const passwords = JSON.parse(fs.readFileSync(path.join(serverRoot, PASSWD_FILE), 'utf8'));

const server = https.createServer(sslOptions, (req, res) => {
    try {
        if (req.method === 'GET') {
            routeGet(req, res);
        } else if (req.method === 'POST') {
            routePost(req, res);
        } else {
            respondWithMethodNotAllowed(res);
        }
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

/*
* About the logic here: I _did_ explore the option of writing a proper router that supported a "middleware",
* which in this case was the validateSession method. However, this got quite complicated when exact routes and
* regex routes were added into the mix, with the middleware, and so on. The code started requiring unit tests
* for this logic, and I decided to do the naive copy and paste solution, because the focus of the exercise
* is directory traversal and session hijacking attacks, not routing.
*/
function routeGet(req, res) {
    let parsedPath = url.parse(req.url, true).pathname;
    if (parsedPath === '/') {
        validateSession(req, (error, data) => {
            if (error) {
                redirectToLoginPage(res);
            } else {
                serveStaticTemplate('index.html', res);
            }
        });
    } else if (parsedPath === '/login') {
        serveStaticTemplate('login.html', res);
    } else if (parsedPath.match(/^\/[a-zA-Z]+\/lights\/[a-zA-Z]+$/)) {
        validateSession(req, (error, data) => {
            if (error) {
                respondWithForbidden(res);
            } else {
                let roomAndLight = parsedPath.substr(1).split("/");
                getLightStatus(roomAndLight[0], roomAndLight[2], res);
            }
        });
    } else if (parsedPath.match(/^\/[a-zA-Z]+\/temperature+$/)) {
        validateSession(req, (error, data) => {
            if (error) {
                respondWithForbidden(res);
            } else {
                getTemperature(parsedPath.substr(1).split("/")[0], res);
            }
        });
    } else {
        staticContent(req, res);
    }
}

function routePost(req, res) {
    let parsedPath = url.parse(req.url, true).pathname;
    if (parsedPath === '/login') {
        extractLoginCredentials(req, (username, password) => {
            if (authenticate(username, password)) {
                activeSessions[nextSessionId] = true;
                redirectToMainPageSettingSessionId(res, nextSessionId++);
            } else {
                // This is really hurtful to me, but the naive and ugly solution is the simplest and doesn't add templating complexity
                serveStaticTemplate('login_failed.html', res);
            }
        });
    } else if (parsedPath === '/logout') {
        validateSession(req, (error, data) => {
            if (error) {
                respondWithForbidden(res);
            } else {
                activeSessions[data] = false;
                // Strictly speaking, the redirect isn't needed here, because it happens on the client side.
                redirectToLoginPage(res);
            }
        });
    } else if (parsedPath.match(/^\/[a-zA-Z]+\/lights\/[a-zA-Z]+$/)) {
        validateSession(req, (error, data) => {
            if (error) {
                respondWithForbidden(res);
            } else {
                let roomAndLight = parsedPath.substr(1).split("/");
                toggleLight(roomAndLight[0], roomAndLight[2], res);
            }
        });
    } else {
        respondWithFileNotFound(res);
    }
}

// Authentication
function extractLoginCredentials(req, callback) {
    let requestBody = '';
    req.on('data', data => {
        requestBody += data;

        // Programming by Stack Overflow: it _is_ wise to kill a session that tries to flood the simple login page...
        if (requestBody.length > MAX_LOGIN_PAGE_BODY) {
            req.connection.destroy();
        }
    }).on('end', () => {
        let postData = querystring.parse(requestBody);

        // Handle leniently: if they're missing, so be it. The caller will have to worry.
        callback.call(null, postData.username, postData.password);
    });
}

function authenticate(username, password) {
    return passwords.hasOwnProperty(username) && passwords[username] === password;
}

function validateSession(req, callback) {
    let cookieHeader = req.headers['cookie'];
    if (cookieHeader) {
        try {
            let sessionCookie = cookie.parse(cookieHeader)[SESSION_COOKIE];
            if (sessionCookie) {
                if (activeSessions[sessionCookie]) {
                    callback(null, sessionCookie);
                } else {
                    // One can easily argue that an inactive session is normal condition, but this handling is consistent with the other paths
                    callback(new Error('Session inactive'));
                }
            } else {
                callback(new Error('Session cookie missing'));
            }
        } catch (e) {
            callback(new Error('Session cookie missing'));
        }
    } else {
        callback(new Error('Session cookie missing'));
    }
}

// Business logic
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

function serveStaticTemplate(file, res) {
    if (file.match(/^[a-zA-Z_\-]+\.?[a-zA-Z]+$/)) {
        let templatePath = path.join(serverRoot, TEMPLATE_DIR, file);
        fs.readFile(templatePath, 'utf8', (error, content) => {
            if (error) {
                respondWithInternalServerError(res);
            } else {
                res.writeHead(200, {'Content-Type': 'text/html'});
                res.end(content);
            }
        });
    } else {
        throw new Error('Template files must match the following regex: ^[a-zA-Z_\-]+\\.?[a-zA-Z]+$');
    }
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
        res.write(data);
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
function redirectToMainPageSettingSessionId(res, sessionId) {
    res.writeHead(302, {'Location': '/', 'Set-Cookie': `${SESSION_COOKIE}=${sessionId}`});
    res.end();
}

function redirectToLoginPage(res) {
    res.writeHead(302, {'Location': '/login'});
    res.end();
}

