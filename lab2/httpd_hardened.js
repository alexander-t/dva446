'use strict';
const https = require('https');
const fs = require('fs');
const url = require('url');
const path = require('path');
const querystring = require('querystring');
const cookie = require('cookie');
const crypto = require('crypto');
const requestIp = require('request-ip');

const PUBLIC_DIR = 'public';
const TEMPLATE_DIR = 'templates';
const PASSWD_FILE = 'passwd';
const MAX_LOGIN_PAGE_BODY = 4096;
const SESSION_COOKIE = 'athome-session';
const DEFAULT_MIME_TYPE = 'application/octet-stream';
const PBKDF2_DERIVED_KEY_LENGTH = 128;
const PBKDF2_DIGEST = 'sha512';
const SESSION_EXPIRATION_MINUTES = 1; // ATTENTION! Set to one minute to demonstrate expiration
const SECRET = '2c24f798a41c92748db30cc261a0ea86414857b4ab21961cf82789cb8e2e85d4';

const serverRoot = process.cwd();
let nextSessionId = 1;

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
        if (parsedPath.match(/^\/[a-zA-Z0-9_\-]+(\/[a-zA-Z0-9_\-]+)*[a-z0-9_\-]+(\.?[a-z0-9_\-]+)*$/)) {
            staticContent(req, res);
        } else {
            respondWithFileNotFound(res);
        }
    }
}

function routePost(req, res) {
    let parsedPath = url.parse(req.url, true).pathname;
    if (parsedPath === '/login') {
        extractLoginCredentials(req, (username, password) => {
            if (authenticate(username, password)) {
                let sessionId = generateSessionId(req);
                redirectToMainPageSettingSessionId(res, sessionId);
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

// Really simple: no error handling and no support for multiple users. Highlights hash stretching though.
function authenticate(username, password) {
    let passwordFile = JSON.parse(fs.readFileSync('passwd'));
    return passwordFile.username === username &&
        passwordFile.key === crypto.pbkdf2Sync(password, passwordFile.salt, passwordFile.iterations, PBKDF2_DERIVED_KEY_LENGTH, PBKDF2_DIGEST).toString('hex');
}

/**
 * Generates a session id on the following form:
 * expiration time-data-sha256(expiration time||data)
 * @param req - Used to get some client-specific values that will be put in the data
 * @returns {string} The session id
 */
function generateSessionId(req) {
    let expirationTime = Date.now() + SESSION_EXPIRATION_MINUTES * 60000;
    let data = digestRequest(req);
    let digest = digestSessionData(expirationTime, data);
    return `${expirationTime}-${data}-${digest}`;
}

/**
 * Generates a SHA256 hash of the client's IP and user agent string.
 * @param req - Request used to get the client's IP and agent string
 * @returns {string} - Hash in hex
 */
function digestRequest(req) {
    return crypto.createHash('sha256').update(requestIp.getClientIp(req) + req.headers['user-agent']).digest('hex');
}

function digestSessionData(expirationTime, data) {
    return crypto.createHash('sha256').update(expirationTime + data + SECRET).digest('hex');
}

function validateSession(req, callback) {
    let cookieHeader = req.headers['cookie'];
    if (cookieHeader) {
        try {
            let sessionCookie = cookie.parse(cookieHeader)[SESSION_COOKIE];
            if (sessionCookie) {
                if (isSessionActive(req, sessionCookie)) {
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

function isSessionActive(req, cookieBody) {
    // First a loose validation of the format
    if (cookieBody.match(/^\d+\-[a-f\d]+\-[a-f\d]+$/)) {
        let fields = cookieBody.split('-');
        let requestHash = digestRequest(req);

        // First check if we think that the request originates from the same client (i.e. same IP and user agent)
        if (requestHash === fields[1]) {
            // Now, check if the fields have been tampered with, most notably the expiration time
            if (digestSessionData(fields[0], fields[1]) === fields[2]) {
                return Date.now() - fields[0] <= 0;
            }
        }
    }
    return false;
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
        let templatePath = path.join(serverRoot, TEMPLATE_DIR, path.normalize(file));
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
    let filePath = path.join(serverRoot, PUBLIC_DIR, path.normalize(decodeURIComponent(parsedUrl.pathname)));
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
    res.writeHead(302, {
        'Location': '/',
        'Set-Cookie': cookie.serialize(SESSION_COOKIE, sessionId, {httpOnly: true, secure: true})
    });
    res.end();
}

function redirectToLoginPage(res) {
    res.writeHead(302, {
        'Location': '/login',
        'Set-Cookie': cookie.serialize(SESSION_COOKIE, '', {expires: new Date().setTime(0)})
    });
    res.end();
}

