/**
 * Sistema de logs profissional com Winston
 * @module utils/logger
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs-extra');
const config = require('../config/env');

// Criar diretório de logs se não existir
fs.ensureDirSync(path.dirname(config.LOG_FILE));

/**
 * Formato customizado para logs
 */
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    
    if (stack) {
      log += `\n${stack}`;
    }
    
    return log;
  })
);

/**
 * Cria a instância do logger
 */
const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: customFormat,
  defaultMeta: { service: 'ml-bot' },
  transports: [
    // Log em arquivo
    new winston.transports.File({
      filename: config.LOG_FILE,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    // Log em console (apenas em desenvolvimento)
    ...(config.IS_DEVELOPMENT
      ? [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            ),
          }),
        ]
      : []),
  ],
});

/**
 * Métodos de logging
 */
const logMethods = {
  /**
   * Log de informação
   * @param {string} message - Mensagem
   * @param {object} meta - Metadados adicionais
   */
  info: (message, meta = {}) => logger.info(message, meta),

  /**
   * Log de aviso
   * @param {string} message - Mensagem
   * @param {object} meta - Metadados adicionais
   */
  warn: (message, meta = {}) => logger.warn(message, meta),

  /**
   * Log de erro
   * @param {string} message - Mensagem
   * @param {Error|object} error - Erro ou metadados
   * @param {object} meta - Metadados adicionais
   */
  error: (message, error = {}, meta = {}) => {
    if (error instanceof Error) {
      logger.error(message, { ...meta, stack: error.stack, errorMessage: error.message });
    } else {
      logger.error(message, { ...error, ...meta });
    }
  },

  /**
   * Log de debug
   * @param {string} message - Mensagem
   * @param {object} meta - Metadados adicionais
   */
  debug: (message, meta = {}) => logger.debug(message, meta),
};

module.exports = logMethods;
