const {join} = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer.
  cacheDirectory: join(process.env.HOME || process.env.USERPROFILE, '.cache', 'puppeteer'),
};