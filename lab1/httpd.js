var http = require('http');
var fs = require('fs');
var url = require('url');

var server = http.createServer((req, res) => {
    route(req, res);
});

server.listen(8000);

function route(req, res) {
    let routes = {'/information': information};
    let route = routes[url.parse(req.url, true).pathname];
    if (route === undefined) {
        staticContent(req, res);
    } else {
        route.call(null, req, res);
    }
}

function information(req, res) {
    fs.readFile('./templates/information.template', 'utf8', (error, content) => {
        let parsedUrl = url.parse(req.url, true);
        res.writeHead(200, {'Content-Type': 'text/html'});
        content = content.replace('{{method}}', req.method).replace('{{path}}', parsedUrl.pathname);
        if (parsedUrl.search) {
            content = content.replace('{{query}}', parsedUrl.search);
            let queries = '';
            parsedUrl.search.substr(1).split('&').forEach(function (e) {
                queries += '<li>' + e + '</li>';
            });
            content = content.replace('{{queries}}', queries);
        } else {
            content = content.replace('{{query}}', '').replace('{{queries}}', '');
        }
        res.end(content);
    });
}

function staticContent(req, res) {
    let parsedUrl = url.parse(req.url, true);
    let path = './public' + parsedUrl.pathname;
    console.log('[' + new Date().toString() + '] ' + req.url + '=>' + path);
    fs.readFile(path, 'utf8', (error, content) => {
        res.writeHead(200, {'Content-Type': getMimeType(path)});
        res.end(content);
    });
}

function getMimeType(path) {
    const mimeTypes = {
        "html": "text/html",
        "js": "text/javascript",
        "css": "text/css"
    };

    let extension = path.split('.').pop();
    return mimeTypes[extension] ? mimeTypes[extension] : 'text/plain';
}

