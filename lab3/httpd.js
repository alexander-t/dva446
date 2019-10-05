'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

// Constants related to password security taken from lab 2
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DERIVED_KEY_LENGTH = 128;
const PBKDF2_DIGEST = 'sha512';

const MIN_USERNAME_LENGTH = 4;
const MIN_PASSWORD_LENGTH = 8;

const PASSWORD_FILE = 'passwd';
const TEMPLATE_DIR = 'templates';

const serverRoot = process.cwd();

const sslOptions = {
    key: fs.readFileSync('cert/server.key'),
    cert: fs.readFileSync('cert/server.crt')
};

let userCredentials = readPasswordFile();

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use('/', express.static('public', {index: false, redirect: false}));
app.get('/', (req, res) => getRoot(req, res));
app.post('/signin', (req, res) => postSignIn(req, res));
app.post('/signup', (req, res) => postSignUp(req, res));
app.post('/signout', (req, res) => postSignOut(req, res));
app.post('/squeak', (req, res) => postSqueak(req, res));

const server = https.createServer(sslOptions, app);

server.listen(8000);

// Routes
function getRoot(req, res) {
    res.sendFile(path.join(serverRoot, TEMPLATE_DIR, 'index.html'));
}

function postSignIn(req, res) {
    let username = req.body.username;
    let password = req.body.password;
    if (username && password) {
        if (authenticate(username, password)) {
            res.type('application/json').status(200).send(JSON.stringify(true));
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
    if (username && username.length >= MIN_USERNAME_LENGTH && !userCredentials.find(c => c.username === username)) {
        if (password && password.length >= MIN_PASSWORD_LENGTH && !(new RegExp(username)).test(password)) {
            addUserCredentials(createEncryptedCredentials(username, password));
            res.type('application/json').status(200).send(JSON.stringify('success'));
        } else {
            res.type('application/json').status(200).send(JSON.stringify({reason: 'password'}));
        }
    } else {
        res.type('application/json').status(200).send(JSON.stringify({reason: 'username'}));
    }
}

function postSignOut(req, res) {
    console.log("/signin");
}

function postSqueak(req, res) {
    console.log("/squeak");
}

// Credentials management
function readPasswordFile() {
    // Quite simplified: The password file is expected to be there and have valid contents. No error handling to
    // keep the exercise uncluttered.
    return JSON.parse(fs.readFileSync(path.join(serverRoot, PASSWORD_FILE), 'utf8'));
}

function addUserCredentials(credentials) {
    // Happily ignoring I/O-related errors and race conditions for the sake of simplicity
    let persistentCredentials = readPasswordFile();
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