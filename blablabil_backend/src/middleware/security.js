const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const config = require('../config/config');

// PUBLIC_INTERFACE
/**
 * Rate limiting middleware for general API requests
 */
const generalRateLimit = rateLimit({
  windowMs: config.security.rateLimitWindowMs, // 15 minutes
  max: config.security.rateLimitMaxRequests, // Limit each IP to 100 requests per windowMs
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// PUBLIC_INTERFACE
/**
 * Strict rate limiting for authentication endpoints
 */
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login requests per windowMs
  message: {
    status: 'error',
    message: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// PUBLIC_INTERFACE
/**
 * Rate limiting for password reset requests
 */
const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 password reset requests per hour
  message: {
    status: 'error',
    message: 'Too many password reset attempts, please try again later.'
  }
});

// PUBLIC_INTERFACE
/**
 * Rate limiting for trip creation
 */
const tripCreationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 trip creations per hour
  message: {
    status: 'error',
    message: 'Too many trip creation attempts, please try again later.'
  }
});

// PUBLIC_INTERFACE
/**
 * Security headers middleware
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ['\'self\''],
      styleSrc: ['\'self\'', '\'unsafe-inline\''],
      scriptSrc: ['\'self\''],
      imgSrc: ['\'self\'', 'data:', 'https:'],
      connectSrc: ['\'self\'', 'https://api.vipps.no', 'https://api.vegvesen.no'],
      fontSrc: ['\'self\''],
      objectSrc: ['\'none\''],
      mediaSrc: ['\'self\''],
      frameSrc: ['\'none\'']
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
});

// PUBLIC_INTERFACE
/**
 * Middleware to sanitize user input
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const sanitizeInput = (req, res, next) => {
  // Remove potentially dangerous characters from string inputs
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
              .replace(/javascript:/gi, '')
              .replace(/on\w+\s*=/gi, '');
  };

  // Recursively sanitize object properties
  const sanitizeObject = (obj) => {
    if (obj === null || typeof obj !== 'object') return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }
    
    const sanitized = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (typeof obj[key] === 'string') {
          sanitized[key] = sanitizeString(obj[key]);
        } else {
          sanitized[key] = sanitizeObject(obj[key]);
        }
      }
    }
    return sanitized;
  };

  // Sanitize request body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  next();
};

// PUBLIC_INTERFACE
/**
 * Middleware to log security events
 * @param {string} eventType - Type of security event
 * @returns {Function} Express middleware function
 */
const logSecurityEvent = (eventType) => {
  return (req, res, next) => {
    const logData = {
      eventType,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
      userId: req.user ? req.user.id : null,
      path: req.path,
      method: req.method
    };

    console.log('Security Event:', logData);
    
    // In production, send to security monitoring service
    if (config.server.env === 'production') {
      // Log to security monitoring system
    }

    next();
  };
};

// PUBLIC_INTERFACE
/**
 * Middleware to check for suspicious activity
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const suspiciousActivityCheck = (req, res, next) => {
  const suspiciousPatterns = [
    /\b(union|select|insert|delete|drop|create|alter)\b/i,
    /<script/i,
    /javascript:/i,
    /\.\.\//,
    /etc\/passwd/i
  ];

  const checkString = (str) => {
    return suspiciousPatterns.some(pattern => pattern.test(str));
  };

  // Check various parts of the request
  const requestString = JSON.stringify({
    body: req.body,
    query: req.query,
    params: req.params
  });

  if (checkString(requestString)) {
    console.warn('Suspicious activity detected:', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      request: requestString,
      timestamp: new Date().toISOString()
    });

    return res.status(400).json({
      status: 'error',
      message: 'Invalid request detected'
    });
  }

  next();
};

module.exports = {
  generalRateLimit,
  authRateLimit,
  passwordResetRateLimit,
  tripCreationRateLimit,
  securityHeaders,
  sanitizeInput,
  logSecurityEvent,
  suspiciousActivityCheck
};
