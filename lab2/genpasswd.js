'use strict';
/*
 * Undocumented password file entry generator :)
 */
const crypto = require('crypto');
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DERIVED_KEY_LENGTH = 128;
const PBKDF2_DIGEST = 'sha512';

let args = process.argv.slice(2);
if (args.length === 2) {
    let entry = {};
    entry.username = args[0];
    crypto.randomBytes(SALT_LENGTH, (err, buffer) => {
        entry.salt = buffer.toString('hex');
        entry.iterations = PBKDF2_ITERATIONS;
        crypto.pbkdf2(args[1], entry.salt, PBKDF2_ITERATIONS, PBKDF2_DERIVED_KEY_LENGTH, PBKDF2_DIGEST, (err, derivedKey) => {
                entry.key = derivedKey.toString('hex');
                console.log(JSON.stringify(entry));
            }
        );
    });
} else {
    console.error("Invalid use");
}
