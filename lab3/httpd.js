'use strict';
const https = require('https');
const fs = require('fs');
const express = require('express');

const sslOptions = {
    key: fs.readFileSync('cert/server.key'),
    cert: fs.readFileSync('cert/server.crt')
};

const app = express();
app.get('/', (req, res) => res.send('Hello World!'))

const server = https.createServer(sslOptions, app);

server.listen(8000);
