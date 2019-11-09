'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const moment = require('moment');
const mustacheExpress = require('mustache-express');
const MongoClient = require('mongodb').MongoClient;

const COOKIE_NAME = "squeak-session";

// Files and directories
const TEMPLATE_DIR = 'templates';
const CERT_DIR = 'cert';
// Session management
const SESSION_EXPIRATION_MINUTES = 15;

const serverRoot = __dirname;
const sslOptions = {
    key: fs.readFileSync(path.join(serverRoot, CERT_DIR, 'server.key')),
    cert: fs.readFileSync(path.join(serverRoot, CERT_DIR, 'server.crt'))
};

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
app.post('/squeak', (req, res, next) => errorHandled(postSqueak, req, res, next));
app.use(errorHandler);

let mongoURL = getMongoURLOrDie();
let squeaks = {};
let credentials = {};
let sessions = {};

MongoClient.connect(mongoURL, {useNewUrlParser: true})
    .then((cluster) => {
            let db = cluster.db('Squeak!');
            squeaks = db.collection('squeaks');
            credentials = db.collection('credentials');
            sessions = db.collection('sessions');

            removeOldSessions();

            const server = https.createServer(sslOptions, app);
            server.listen(8000);
        }
    )
    .catch((error) => {
            console.error(error);
        }
    );

// Routes
async function errorHandled(fn, req, res, next) {
    try {
        await fn(req, res, next);
    } catch (e) {
        return next(e);
    }
}

async function getRoot(req, res, next) {
    if (req.sessionId) {
        return await renderMainPage(req, res);
    } else {
        res.render('start');
    }
}

async function postSignIn(req, res) {
    let username = req.body.username;
    let password = req.body.password;
    if (username && password) {
        try {
            if (await authenticate(username, password)) {
                initiateSession(res, username);
            } else {
                res.type('application/json').status(200).send(JSON.stringify(false));
            }
        } catch (e) {
            // Hide the error from the user
            console.error(e);
            res.type('application/json').status(200).send(JSON.stringify(false));
        }
    } else {
        res.status(400).end();
    }
}

async function postSignUp(req, res) {
    let username = req.body.username;
    let password = req.body.password;
    if (await allowedUsername(username)) {
        if (allowedPassword(password, username)) {
            await addUserCredentials(username, password);
            initiateSession(res, username);
        } else {
            res.type('application/json').status(200).send(JSON.stringify({reason: 'password'}));
        }
    } else {
        res.type('application/json').status(200).send(JSON.stringify({reason: 'username'}));
    }
}

async function postSignOut(req, res) {
    const sessionId = req.sessionId;
    if (sessionId) {
        await sessions.findOneAndDelete({sessionId: sessionId});
    }
    res.clearCookie(COOKIE_NAME);
    res.redirect('/');
}

async function postSqueak(req, res) {
    let username = req.username;
    let squeak = req.body.squeak;
    let recipient = req.body.recipient ? req.body.recipient : 'all';
    if (username && squeak && squeak.length > 0) {
        await addSqueak(username, recipient, squeak);
    }
    res.redirect('/');
}

// Credentials management

async function addUserCredentials(username, password) {
    return await credentials.insertOne({username: username, password: password})
}

async function authenticate(username, password) {
    return await credentials.findOne({username: username, password: password}) != null;
}

// Session management

// Initiates a session by setting up the required cookies and a positive response payload
async function initiateSession(res, username) {
    let cookie = {sessionid: await generatePersistedSessionId(), username: username};
    res.type('application/json').status(200)
        .cookie(COOKIE_NAME, JSON.stringify(cookie), {httpOnly: true, secure: true})
        .send(JSON.stringify({success: true}));
}

async function generatePersistedSessionId() {
    const sessionId = crypto.randomBytes(64).toString('hex');
    const expirationTime = Date.now() + SESSION_EXPIRATION_MINUTES * 60000;
    // Store a string sessionId. Optimizing for readability.
    await sessions.insertOne({sessionId: sessionId, expires: expirationTime});
    return sessionId;
}

async function isSessionActive(sessionId) {
    return await sessions.findOne({sessionId: sessionId, expires: {$gt: Date.now()}}) != null;
}

// Middleware

async function authenticationHandler(req, res, next) {
    let session = extractValidSession(req);
    if (session && await isSessionActive(session.sessionid)) {
        req.sessionId = session.sessionid;
        req.username = session.username;
    }
    next();
}

function extractValidSession(req) {
    let session = null;
    try {
        session = JSON.parse(req.cookies[COOKIE_NAME]);
        if (session.sessionid && session.username) {
            return session;
        }
    } catch (e) {
    }
    return session;
}

function errorHandler(err, req, res, next) {
    console.error(err);
    res.status(err.status || 500);
    res.end();
}

// Business logic?

async function allowedUsername(username) {
    try {
        return username
            && username.match(/^[a-zA-Z][a-zA-Z_\.\- ]{2,62}[a-zA-Z]$/)
            && null == await credentials.findOne({username: username});
    } catch (error) {
        console.error(error);
        return false;
    }
}

function allowedPassword(password, username) {
    const MIN_PASSWORD_LENGTH = 8;
    return password && password.length >= MIN_PASSWORD_LENGTH && !password.includes(username);
}

async function renderMainPage(req, res) {
    let username = req.username;
    Promise.all([getUsers(), getSqueaks('all'), getSqueaks(username)]).then(
        results => {
            res.render('main', {
                name: username,
                users: results[0],
                squeaks: results[1],
                squeals: results[2]
            });
        });
}

async function addSqueak(username, recipient, squeak) {
    let time = moment().format('ddd hh:mm');
    await squeaks.insertOne({
        name: username,
        time: time,
        recipient: recipient,
        squeak: squeak
    });
}

async function getSqueaks(username) {
    // This will so break if many squeaks are returned, but limited result sets and pagination are out of scope.
    return await squeaks.find({recipient: username}).toArray();
}

async function getUsers() {
    // The usernames are distinct, but to a MongoDB novice, this seems like the cleanest query.
    return await credentials.distinct('username');
}

async function removeOldSessions() {
    console.log("Removing old sessions...");
    // Restarting the server kills even non-expired sessions.
    await sessions.deleteMany({});
}

function getMongoURLOrDie() {
    if (process.env.MONGO_URL) {
        return process.env.MONGO_URL;
    } else {
        console.error("MONGO_URL not set. Quitting!");
        process.exit(1);
    }
}