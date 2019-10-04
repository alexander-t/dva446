'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');

const TEMPLATE_DIR = 'templates';

const serverRoot = process.cwd();

const sslOptions = {
    key: fs.readFileSync('cert/server.key'),
    cert: fs.readFileSync('cert/server.crt')
};

const app = express();
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
    console.log("/signin");
}

function postSignUp(req, res) {
    console.log("/signup");
}

function postSignOut(req, res) {
    console.log("/signin");
}

function postSqueak(req, res) {
    console.log("/squeak");
}
