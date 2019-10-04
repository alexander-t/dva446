'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
var cookieParser = require('cookie-parser')

const TEMPLATE_DIR = 'templates';

const serverRoot = process.cwd();

const sslOptions = {
    key: fs.readFileSync('cert/server.key'),
    cert: fs.readFileSync('cert/server.crt')
};

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
    if (req.body.username && req.body.password) {
        if (req.body.username === 'alex' && req.body.password === 'alex') {
            res.type('application/json').status(200).send(JSON.stringify(true));
        } else {
            res.type('application/json').status(200).send(JSON.stringify(false));
        }
    } else {
        res.status(400).end();
    }
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
