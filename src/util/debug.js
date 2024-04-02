let logger;
let errorLogger;

/**
 * enable the logger
 */
export function setLogger() {
    /*eslint-disable */
    logger = console.log;
    errorLogger = console.error;
    /*eslint-enable */
}

/**
 * if the logger is enabled?
 * @returns 
 */
export function isEnable() {
    return logger != null;
}

/**
 * log the message
 * @param {*} message 
 * @param  {...any} optionalParams 
 */
export function log(message, ...optionalParams) {
    if (logger) {
        logger(message, ...optionalParams);
    }
}

/**
 * log the error message
 * @param {*} message 
 * @param  {...any} optionalParams 
 */
export function error(message, ...optionalParams) {
    if (errorLogger) {
        errorLogger(message, ...optionalParams);
    }
}
