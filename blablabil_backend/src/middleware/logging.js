const { query } = require('../config/database');

// PUBLIC_INTERFACE
/**
 * Middleware to log user activities for audit trail
 * @param {string} activityType - Type of activity being logged
 * @returns {Function} Express middleware function
 */
const logUserActivity = (activityType) => {
  return async (req, res, next) => {
    // Store original res.json to capture response
    const originalJson = res.json;
    
    res.json = function(body) {
      // Log the activity after response is sent
      setImmediate(async () => {
        try {
          if (req.user && req.user.id) {
            const metadata = {
              method: req.method,
              path: req.path,
              query: req.query,
              params: req.params,
              statusCode: res.statusCode,
              success: res.statusCode < 400
            };

            // Don't log sensitive data
            if (req.body && !req.path.includes('/auth/')) {
              metadata.bodyKeys = Object.keys(req.body);
            }

            await query(
              `INSERT INTO user_activity_logs 
               (user_id, activity_type, activity_description, ip_address, user_agent, metadata) 
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                req.user.id,
                activityType,
                `${req.method} ${req.path}`,
                req.ip,
                req.get('User-Agent'),
                JSON.stringify(metadata)
              ]
            );
          }
        } catch (error) {
          console.error('Failed to log user activity:', error);
        }
      });

      // Call original json method
      return originalJson.call(this, body);
    };

    next();
  };
};

// PUBLIC_INTERFACE
/**
 * Middleware to log system events
 * @param {string} logLevel - Log level (DEBUG, INFO, WARN, ERROR, FATAL)
 * @param {string} category - Log category
 * @returns {Function} Express middleware function
 */
const logSystemEvent = (logLevel, category) => {
  return async (req, res, next) => {
    const originalJson = res.json;
    
    res.json = function(body) {
      setImmediate(async () => {
        try {
          const message = `${req.method} ${req.path} - ${res.statusCode}`;
          const additionalData = {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            responseTime: Date.now() - req.startTime,
            userAgent: req.get('User-Agent')
          };

          await query(
            `INSERT INTO system_logs 
             (log_level, log_category, message, user_id, ip_address, user_agent, additional_data) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              logLevel,
              category,
              message,
              req.user ? req.user.id : null,
              req.ip,
              req.get('User-Agent'),
              JSON.stringify(additionalData)
            ]
          );
        } catch (error) {
          console.error('Failed to log system event:', error);
        }
      });

      return originalJson.call(this, body);
    };

    // Add start time for response time calculation
    req.startTime = Date.now();
    next();
  };
};

// PUBLIC_INTERFACE
/**
 * Middleware to log GDPR-related data processing activities
 * @param {string} processingType - Type of data processing
 * @returns {Function} Express middleware function
 */
const logGDPRActivity = (processingType) => {
  return async (req, res, next) => {
    const originalJson = res.json;
    
    res.json = function(body) {
      setImmediate(async () => {
        try {
          if (req.user && res.statusCode < 400) {
            const dataCategories = [];
            
            // Determine data categories based on processing type
            switch (processingType) {
              case 'export':
                dataCategories.push('personal_data', 'trip_data', 'payment_data');
                break;
              case 'consent_update':
                dataCategories.push('consent_data');
                break;
              case 'anonymize':
              case 'delete':
                dataCategories.push('all_user_data');
                break;
            }

            await query(
              `INSERT INTO gdpr_data_logs 
               (user_id, processing_type, processing_reason, data_categories, status) 
               VALUES ($1, $2, $3, $4, $5)`,
              [
                req.user.id,
                processingType,
                `${processingType} request via API`,
                dataCategories,
                'completed'
              ]
            );
          }
        } catch (error) {
          console.error('Failed to log GDPR activity:', error);
        }
      });

      return originalJson.call(this, body);
    };

    next();
  };
};

// PUBLIC_INTERFACE
/**
 * Middleware to log authentication events
 * @param {string} eventType - Type of auth event (login, logout, register, etc.)
 * @returns {Function} Express middleware function
 */
const logAuthEvent = (eventType) => {
  return async (req, res, next) => {
    const originalJson = res.json;
    
    res.json = function(body) {
      setImmediate(async () => {
        try {
          const success = res.statusCode < 400;
          const message = `${eventType} ${success ? 'successful' : 'failed'}`;
          
          await query(
            `INSERT INTO system_logs 
             (log_level, log_category, message, user_id, ip_address, user_agent, additional_data) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              success ? 'INFO' : 'WARN',
              'authentication',
              message,
              req.user ? req.user.id : null,
              req.ip,
              req.get('User-Agent'),
              JSON.stringify({
                eventType,
                success,
                email: req.body ? req.body.email : null,
                timestamp: new Date().toISOString()
              })
            ]
          );
        } catch (error) {
          console.error('Failed to log auth event:', error);
        }
      });

      return originalJson.call(this, body);
    };

    next();
  };
};

// PUBLIC_INTERFACE
/**
 * Request logging middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logMessage = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`;
    
    if (res.statusCode >= 400) {
      console.error(logMessage);
    } else {
      console.log(logMessage);
    }
  });

  next();
};

module.exports = {
  logUserActivity,
  logSystemEvent,
  logGDPRActivity,
  logAuthEvent,
  requestLogger
};
