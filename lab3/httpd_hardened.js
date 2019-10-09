'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const moment = require('moment');
const mustacheExpress = require('mustache-express');

// Constants related to password security taken from lab 2
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DERIVED_KEY_LENGTH = 128;
const PBKDF2_DIGEST = 'sha512';
// Cookie names
const COOKIE_SESSION_ID = 'sessionid';
const COOKIE_USERNAME = 'username';
// Files and directories
const PASSWORD_FILE = 'passwd';
const SQUEAK_FILE = 'squeaks';
const TEMPLATE_DIR = 'templates';
// Session management
const SECRET = 'F9911FA3CB173770F399160B46590E77';
const SESSION_EXPIRATION_MINUTES = 5;
// CSRF-related
const IV_LENGTH = 16;
const AUTHTAG_LENGTH = 16;
const ONETIME_KEY_SALT_LENGTH = 64;
const MIN_CIPHERTEXT_LENGTH = IV_LENGTH + AUTHTAG_LENGTH + ONETIME_KEY_SALT_LENGTH;
const MASTER_KEY = '530CE32AAC715AAA849027BCC26C6C64';
const CSRF_TOKEN_EXPIRATION_MINUTES = 1; // WATCH THIS! It's for illustrative purposes!

const serverRoot = __dirname;

const sslOptions = {
    key: fs.readFileSync('cert/server.key'),
    cert: fs.readFileSync('cert/server.crt')
};

let userCredentials = readJSONFile(PASSWORD_FILE);

const app = express();
app.engine('mustache', mustacheExpress());
app.set('view engine', 'mustache');
app.set('views', path.join(serverRoot, TEMPLATE_DIR));
app.use(cookieParser());
app.use(authenticationHandler);
app.use(express.json());
app.use(express.urlencoded({extended: false}))
app.use('/', express.static('public', {index: false, redirect: false}));
app.get('/', (req, res, next) => errorHandled(getRoot, req, res, next));
app.post('/signin', (req, res, next) => errorHandled(postSignIn, req, res, next));
app.post('/signup', (req, res, next) => errorHandled(postSignUp, req, res, next));
app.post('/signout', (req, res, next) => errorHandled(postSignOut, req, res, next));
app.use('/squeak', csrfHandler);
app.post('/squeak', (req, res, next) => errorHandled(postSqueak, req, res, next));
app.use(errorHandler);

const server = https.createServer(sslOptions, app);

server.listen(8000);

// Routes

// Wrapper that provides somewhat gracious error handling of all possible errors triggered by the synchronous code
function errorHandled(fn, req, res, next) {
    try {
        fn(req, res, next);
    } catch (e) {
        return next(e);
    }
}

function getRoot(req, res, next) {
    if (req.sessionId) {
        return renderMainPage(req, res);
    } else {
        return res.sendFile(path.join(serverRoot, TEMPLATE_DIR, 'index.html'));
    }
}

function postSignIn(req, res) {
    let username = req.body.username;
    let password = req.body.password;
    if (username && password) {
        if (authenticate(username, password)) {
            initiateSession(res, username);
        } else {
            res.type('application/json').status(200).send(JSON.stringify(false));
        }
    } else {
        res.status(400).end();
    }
}

function postSignUp(req, res) {
    let username = req.body.username;
    let password = req.body.password;
    if (allowedUsername(username)) {
        if (allowedPassword(password, username)) {
            addUserCredentials(createEncryptedCredentials(username, password));
            initiateSession(res, username);
        } else {
            res.type('application/json').status(200).send(JSON.stringify({reason: 'password'}));
        }
    } else {
        res.type('application/json').status(200).send(JSON.stringify({reason: 'username'}));
    }
}

function postSignOut(req, res) {
    res.clearCookie(COOKIE_SESSION_ID);
    res.clearCookie(COOKIE_USERNAME);
    res.redirect('/');
}

function postSqueak(req, res) {
    let username = req.username;
    let squeak = req.body.squeak;
    if (username && squeak && squeak.length > 0) {
        let squeaks = readJSONFile(SQUEAK_FILE);
        squeaks.push({name: username, date: moment().format('ddd h:mm'), squeak: squeak});
        fs.writeFileSync(path.join(serverRoot, SQUEAK_FILE), JSON.stringify(squeaks));
    }
    res.redirect('/');
}

// Credentials management
function addUserCredentials(credentials) {
    // Happily ignoring I/O-related errors and race conditions for the sake of simplicity
    let persistentCredentials = readJSONFile(PASSWORD_FILE);
    persistentCredentials.push(credentials);
    fs.writeFileSync(path.join(serverRoot, PASSWORD_FILE), JSON.stringify(persistentCredentials));
    userCredentials = persistentCredentials;
}

function createEncryptedCredentials(username, password) {
    const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
    return {
        username: username,
        salt: salt,
        iterations: PBKDF2_ITERATIONS,
        key: crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_DERIVED_KEY_LENGTH, PBKDF2_DIGEST).toString('hex')
    };
}

function authenticate(username, password) {
    let credentials = userCredentials.find(c => c.username === username);
    return credentials && credentials.key === crypto.pbkdf2Sync(password, credentials.salt, credentials.iterations, PBKDF2_DERIVED_KEY_LENGTH, PBKDF2_DIGEST).toString('hex');
}

// Session management

// Initiates a session by setting up the required cookies and a positive response payload
function initiateSession(res, username) {
    res.type('application/json').status(200)
        .cookie(COOKIE_SESSION_ID, generateSessionId(username), {httpOnly: true, secure: true})
        .cookie(COOKIE_USERNAME, username, {httpOnly: true, secure: true})
        .send(JSON.stringify({success: true}));
}

/**
 * Generates a session id on the following form:
 * expiration time-data-sha256(expiration time||data)
 * @param username - Used as session-specific data
 * @returns {string} The session id
 */
function generateSessionId(username) {
    let expirationTime = Date.now() + SESSION_EXPIRATION_MINUTES * 60000;
    // Not necessary, strictly speaking, but fun.
    let data = digestUsername(username);
    let digest = digestSessionData(expirationTime, data);
    return `${expirationTime}-${data}-${digest}`;
}

function digestUsername(username) {
    return crypto.createHash('sha256').update(username).digest('hex');
}

function digestSessionData(expirationTime, data) {
    return crypto.createHash('sha256').update(expirationTime + data + SECRET).digest('hex');
}

function isSessionActive(sessionId, username) {
    // First a loose validation of the format
    if (sessionId.match(/^\d+\-[a-f\d]+\-[a-f\d]+$/)) {
        let fields = sessionId.split('-');
        let usernameHash = digestUsername(username);

        if (usernameHash === fields[1]) {
            // Now, check if the fields have been tampered with, most notably the expiration time
            if (digestSessionData(fields[0], fields[1]) === fields[2]) {
                return Date.now() - fields[0] <= 0;
            }
        }
    }
    return false;
}

// Middleware
function authenticationHandler(req, res, next) {
    let sessionId = req.cookies.sessionid;
    let username = req.cookies.username;
    if (sessionId && username && isSessionActive(sessionId, username)) {
        req.sessionId = sessionId;
        req.username = username;
    }
    next();
}

function csrfHandler(req, res, next) {
    if (isCsrfTokenValid(req.body.CSRFToken, req.sessionId)) {
        next();
    } else {
        if (req.sessionId) {
            res.status(403).send('CSRF protection kicked in!');
        } else {
            res.redirect('/');
        }
    }
}

function errorHandler(err, req, res, next) {
    console.error(err);
    res.status(err.status || 500);
    res.end();
}

// Encryption
function encrypt(plainText) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(ONETIME_KEY_SALT_LENGTH);
    const oneTimeKey = generateOneTimeKey(salt);
    const aes256gcmCipher = crypto.createCipheriv('aes-256-gcm', oneTimeKey, iv);
    const encrypted = Buffer.concat([aes256gcmCipher.update(plainText, 'utf8'), aes256gcmCipher.final()]);
    const authTag = aes256gcmCipher.getAuthTag();
    return Buffer.concat([salt, iv, authTag, encrypted]).toString('base64');
}

function decrypt(base64CipherText) {
    const cipherTextBuffer = Buffer.from(base64CipherText, 'base64');
    if (cipherTextBuffer.length < MIN_CIPHERTEXT_LENGTH) {
        throw new Error('Invalid ciphertext: salt, iv, auth tag missing');
    }

    // This may be the first time in my life that I regret using constants
    const salt = cipherTextBuffer.slice(0, ONETIME_KEY_SALT_LENGTH);
    const iv = cipherTextBuffer.slice(ONETIME_KEY_SALT_LENGTH, ONETIME_KEY_SALT_LENGTH + IV_LENGTH);
    const authTag = cipherTextBuffer.slice(ONETIME_KEY_SALT_LENGTH + IV_LENGTH, ONETIME_KEY_SALT_LENGTH + IV_LENGTH + AUTHTAG_LENGTH);
    const cipherText = cipherTextBuffer.slice(ONETIME_KEY_SALT_LENGTH + IV_LENGTH + AUTHTAG_LENGTH);
    const oneTimeKey = generateOneTimeKey(salt);
    const aes256gcmDecipher = crypto.createDecipheriv('aes-256-gcm', oneTimeKey, iv);
    aes256gcmDecipher.setAuthTag(authTag);
    return aes256gcmDecipher.update(cipherText, 'binary', 'utf8') + aes256gcmDecipher.final('utf8');
}

function generateOneTimeKey(salt) {
    return crypto.pbkdf2Sync(MASTER_KEY, salt, 4096, 32, 'sha512');
}

// CSRF
function generateCsrfToken(sessionId) {
    let expirationTime = Date.now() + CSRF_TOKEN_EXPIRATION_MINUTES * 60000;
    // If bytes matter, encrypting a JSON object may not be 100% efficient, but in an exercise, so they don't.
    return encrypt(JSON.stringify({ts: expirationTime, sid: sessionId}));
}

function isCsrfTokenValid(csrfToken, sessionId) {
    if (csrfToken) {
        try {
            let tsAndSid = JSON.parse(decrypt(csrfToken));
            if (tsAndSid.ts && tsAndSid.sid && tsAndSid.sid.match(/\d{10}/)) {
                if (Date.now() - tsAndSid.ts > 0) {
                    // There is no real rationale behind being extra careful about logging CSRF token failures compared to (not) logging invalid session failures
                    console.error('CSRF token expired: ' + csrfToken);
                } else {
                    return tsAndSid.sid === sessionId;
                }
            }
        } catch (e) {
            // The most likely error is by far failed decryption because of an invalid cipher text (buffer) format.
            console.error('Invalid CSRF token: ' + csrfToken);
        }
    }
    return false;
}

// Business logic?
function allowedUsername(username) {
    return username
        && username.match(/^[a-zA-Z][a-zA-Z_\.\- ]{2,62}[a-zA-Z]$/)
        && !userCredentials.find(c => c.username === username);
}

function allowedPassword(password, username) {
    const MIN_PASSWORD_LENGTH = 8;
    return password && password.length >= MIN_PASSWORD_LENGTH && !password.includes(username);
}

function readJSONFile(filename) {
    // Quite simplified: The password file is expected to be there and have valid contents. No error handling to
    // keep the exercise uncluttered.
    return JSON.parse(fs.readFileSync(path.join(serverRoot, filename), 'utf8'));
}

function renderMainPage(req, res) {
    // Even the hardened version uses a synchronous operation which may block the the server for large files.
    // However, fixing this would require pagination as well, and that's not relevant to stored XSS protection.
    res.render('main', {
        name: req.username,
        csrfToken: generateCsrfToken(req.sessionId),
        squeaks: readJSONFile(SQUEAK_FILE)
    });
}