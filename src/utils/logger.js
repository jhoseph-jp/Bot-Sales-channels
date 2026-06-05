const pino = require('pino');
const path = require('path');
const fs = require('fs-extra');

// Garante que a pasta de logs existe
const logDir = path.resolve(process.cwd(), 'logs');
fs.ensureDirSync(logDir);

const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      },
      level: process.env.LOG_LEVEL || 'info'
    },
    {
      target: 'pino/file',
      options: {
        destination: path.join(logDir, 'app.log'),
        mkdir: true
      },
      level: 'info'
    },
    {
      target: 'pino/file',
      options: {
        destination: path.join(logDir, 'error.log'),
        mkdir: true
      },
      level: 'error'
    }
  ]
});

const logger = pino(transport);

module.exports = logger;
