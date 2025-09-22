const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query, transaction } = require('../config/database');
const config = require('../config/config');

class AuthService {
  // PUBLIC_INTERFACE
  /**
   * Generate JWT access and refresh tokens
   * @param {Object} user - User object
   * @returns {Promise<Object>} Token pair
   */
  async generateTokens(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      isDriver: user.is_driver
    };

    const accessToken = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn
    });

    const refreshToken = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.refreshExpiresIn
    });

    // Store session in database
    const sessionToken = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO user_sessions (user_id, session_token, expires_at) 
       VALUES ($1, $2, $3)`,
      [user.id, sessionToken, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)] // 30 days
    );

    return {
      accessToken,
      refreshToken,
      sessionToken,
      expiresIn: config.jwt.expiresIn
    };
  }

  // PUBLIC_INTERFACE
  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object>} New token pair
   */
  async refreshToken(refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, config.jwt.secret);
      
      // Check if user is still active
      const userResult = await query(
        'SELECT id, email, is_driver, status FROM users WHERE id = $1 AND status = $2',
        [decoded.userId, 'active']
      );

      if (userResult.rows.length === 0) {
        throw new Error('User not found or inactive');
      }

      return this.generateTokens(userResult.rows[0]);
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  // PUBLIC_INTERFACE
  /**
   * Create password reset token
   * @param {string} email - User email
   * @returns {Promise<string>} Reset token
   */
  async createPasswordResetToken(email) {
    const userResult = await query(
      'SELECT id FROM users WHERE email = $1 AND status = $2',
      [email, 'active']
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const userId = userResult.rows[0].id;
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) 
       VALUES ($1, $2, $3)`,
      [userId, resetToken, expiresAt]
    );

    return resetToken;
  }

  // PUBLIC_INTERFACE
  /**
   * Reset password using reset token
   * @param {string} token - Reset token
   * @param {string} newPassword - New password
   * @returns {Promise<boolean>} Success status
   */
  async resetPassword(token, newPassword) {
    return transaction(async (client) => {
      // Find valid reset token
      const tokenResult = await client.query(
        `SELECT user_id FROM password_reset_tokens 
         WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP AND used = false`,
        [token]
      );

      if (tokenResult.rows.length === 0) {
        throw new Error('Invalid or expired reset token');
      }

      const userId = tokenResult.rows[0].user_id;

      // Hash new password
      const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);

      // Update user password
      await client.query(
        'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [passwordHash, userId]
      );

      // Mark token as used
      await client.query(
        'UPDATE password_reset_tokens SET used = true WHERE token = $1',
        [token]
      );

      // Invalidate all existing sessions for security
      await client.query(
        'DELETE FROM user_sessions WHERE user_id = $1',
        [userId]
      );

      return true;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Change user password
   * @param {string} userId - User ID
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<boolean>} Success status
   */
  async changePassword(userId, currentPassword, newPassword) {
    return transaction(async (client) => {
      // Verify current password
      const userResult = await client.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);

      // Update password
      await client.query(
        'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [passwordHash, userId]
      );

      // Log password change
      await client.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, activity_description) 
         VALUES ($1, $2, $3)`,
        [userId, 'password_change', 'User changed password']
      );

      return true;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Logout user and invalidate session
   * @param {string} userId - User ID
   * @param {string} sessionToken - Session token to invalidate
   * @returns {Promise<boolean>} Success status
   */
  async logout(userId, sessionToken) {
    if (sessionToken) {
      await query(
        'DELETE FROM user_sessions WHERE user_id = $1 AND session_token = $2',
        [userId, sessionToken]
      );
    } else {
      // Logout from all sessions
      await query(
        'DELETE FROM user_sessions WHERE user_id = $1',
        [userId]
      );
    }

    return true;
  }

  // PUBLIC_INTERFACE
  /**
   * Verify email with verification token
   * @param {string} userId - User ID
   * @param {string} verificationToken - Email verification token
   * @returns {Promise<boolean>} Success status
   */
  async verifyEmail(userId, verificationToken) {
    // In a real implementation, this would verify against stored verification tokens
    await query(
      'UPDATE users SET email_verified = true WHERE id = $1',
      [userId]
    );

    await query(
      `INSERT INTO user_activity_logs (user_id, activity_type, activity_description) 
       VALUES ($1, $2, $3)`,
      [userId, 'email_verification', 'Email address verified']
    );

    return true;
  }

  // PUBLIC_INTERFACE
  /**
   * Verify phone number with verification code
   * @param {string} userId - User ID
   * @param {string} verificationCode - Phone verification code
   * @returns {Promise<boolean>} Success status
   */
  async verifyPhone(userId, verificationCode) {
    // In a real implementation, this would verify against sent SMS codes
    await query(
      'UPDATE users SET phone_verified = true WHERE id = $1',
      [userId]
    );

    await query(
      `INSERT INTO user_activity_logs (user_id, activity_type, activity_description) 
       VALUES ($1, $2, $3)`,
      [userId, 'phone_verification', 'Phone number verified']
    );

    return true;
  }

  // PUBLIC_INTERFACE
  /**
   * Clean up expired sessions and tokens
   * @returns {Promise<number>} Number of cleaned up records
   */
  async cleanupExpiredTokens() {
    return transaction(async (client) => {
      // Clean up expired sessions
      const sessionsResult = await client.query(
        'DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP'
      );

      // Clean up expired password reset tokens
      const tokensResult = await client.query(
        'DELETE FROM password_reset_tokens WHERE expires_at < CURRENT_TIMESTAMP'
      );

      return sessionsResult.rowCount + tokensResult.rowCount;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Get user's active sessions
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Active sessions
   */
  async getUserSessions(userId) {
    const result = await query(
      `SELECT id, device_info, ip_address, created_at, last_activity 
       FROM user_sessions 
       WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP 
       ORDER BY last_activity DESC`,
      [userId]
    );

    return result.rows;
  }

  // PUBLIC_INTERFACE
  /**
   * Validate session token
   * @param {string} sessionToken - Session token
   * @returns {Promise<Object>} Session data
   */
  async validateSession(sessionToken) {
    const result = await query(
      `SELECT s.user_id, s.expires_at, u.status 
       FROM user_sessions s 
       JOIN users u ON s.user_id = u.id 
       WHERE s.session_token = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
      [sessionToken]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid session');
    }

    const session = result.rows[0];
    if (session.status !== 'active') {
      throw new Error('User account is not active');
    }

    // Update last activity
    await query(
      'UPDATE user_sessions SET last_activity = CURRENT_TIMESTAMP WHERE session_token = $1',
      [sessionToken]
    );

    return session;
  }
}

module.exports = new AuthService();
