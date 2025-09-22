const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { query } = require('../config/database');

// PUBLIC_INTERFACE
/**
 * Middleware to authenticate JWT tokens
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Access token required'
      });
    }

    const decoded = jwt.verify(token, config.jwt.secret);
    
    // Check if user still exists and is active
    const userResult = await query(
      'SELECT id, email, status, is_driver FROM users WHERE id = $1 AND status = $2',
      [decoded.userId, 'active']
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired token'
      });
    }

    req.user = {
      id: decoded.userId,
      email: userResult.rows[0].email,
      status: userResult.rows[0].status,
      isDriver: userResult.rows[0].is_driver
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: 'error',
        message: 'Token expired'
      });
    }
    
    return res.status(401).json({
      status: 'error',
      message: 'Invalid token'
    });
  }
};

// PUBLIC_INTERFACE
/**
 * Middleware to check if user is a driver
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requireDriver = (req, res, next) => {
  if (!req.user.isDriver) {
    return res.status(403).json({
      status: 'error',
      message: 'Driver access required'
    });
  }
  next();
};

// PUBLIC_INTERFACE
/**
 * Middleware to check admin permissions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requireAdmin = async (req, res, next) => {
  try {
    const adminResult = await query(
      `SELECT ar.permissions 
       FROM admin_users au 
       JOIN admin_roles ar ON au.role_id = ar.id 
       WHERE au.user_id = $1 AND au.is_active = true AND ar.is_active = true`,
      [req.user.id]
    );

    if (adminResult.rows.length === 0) {
      return res.status(403).json({
        status: 'error',
        message: 'Admin access required'
      });
    }

    req.user.adminPermissions = adminResult.rows[0].permissions;
    next();
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error checking admin permissions'
    });
  }
};

// PUBLIC_INTERFACE
/**
 * Middleware to check specific admin permission
 * @param {string} permission - Permission to check
 * @returns {Function} Express middleware function
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user.adminPermissions || !req.user.adminPermissions[permission]) {
      return res.status(403).json({
        status: 'error',
        message: `Permission required: ${permission}`
      });
    }
    next();
  };
};

// PUBLIC_INTERFACE
/**
 * Optional authentication middleware (doesn't fail if no token)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, config.jwt.secret);
      const userResult = await query(
        'SELECT id, email, status, is_driver FROM users WHERE id = $1 AND status = $2',
        [decoded.userId, 'active']
      );

      if (userResult.rows.length > 0) {
        req.user = {
          id: decoded.userId,
          email: userResult.rows[0].email,
          status: userResult.rows[0].status,
          isDriver: userResult.rows[0].is_driver
        };
      }
    }

    next();
  } catch (error) {
    // Ignore token errors in optional auth
    next();
  }
};

module.exports = {
  authenticateToken,
  requireDriver,
  requireAdmin,
  requirePermission,
  optionalAuth
};
