let querystring = require("querystring");
let session = {
    sessionid: {$ne: '555c27db9238f11337d8ab8e2ed10a171da6ff98f5a7366a41d3bd91d903daaecc8e5fd22441d183824da40309c9b269bc516e42d170a314a599e9c04e169a80'},
    username: ''
};
console.log(querystring.escape(JSON.stringify(session)));