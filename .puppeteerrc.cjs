const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Garante que o Chrome seja instalado na pasta raiz do projeto
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
