'use strict';
// These tests aren't beautiful, but they're just my regression suite for refactorings.
const URL = 'https://localhost:8000';
const VALID_USERNAME = 'alex';
const VALID_PASSWORD = 'secret';

module.exports = {
    'Unauthenticated access to / redirects to login page': (browser) => {
        browser
            .url(URL)
            .assert.visible('button[name=login-button]')
            .end();
    },
    'Invalid credentials show error message': (browser) => {
        browser
            .url(URL)
            .waitForElementVisible('button[name=login-button]')
            .setValue('input[name=username]', 'does-not-exist')
            .setValue('input[name=password]', 'wrong password')
            .click('button[type=submit]')
            .assert.containsText('div[role=alert]', 'Login failed. Invalid username or password.')
            .end();
    },
    'Valid login opens up the main page': (browser) => {
        browser
            .url(URL)
            .waitForElementVisible('button[name=login-button]')
            .setValue('input[name=username]', VALID_USERNAME)
            .setValue('input[name=password]', VALID_PASSWORD)
            .click('button[type=submit]')
            .assert.visible('button[name=logout-button]')
            .assert.containsText('h3', 'Kitchen')
            .end();
    },
    'Logging out takes you back to the login page': (browser) => {
        browser
            .url(URL)
            .waitForElementVisible('button[name=login-button]')
            .setValue('input[name=username]', VALID_USERNAME)
            .setValue('input[name=password]', VALID_PASSWORD)
            .click('button[type=submit]')
            .click('button[name=logout-button]')
            .assert.visible('button[name=login-button]')
            .assert.elementNotPresent('h3', 'Kitchen')
            .end();
    }
};