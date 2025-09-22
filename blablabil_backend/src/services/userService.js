const bcrypt = require('bcryptjs');
const { query, transaction } = require('../config/database');
const config = require('../config/config');

class UserService {
  // PUBLIC_INTERFACE
  /**
   * Create a new user account
   * @param {Object} userData - User registration data
   * @returns {Promise<Object>} Created user data
   */
  async createUser(userData) {
    const {
      email,
      phone_number,
      password,
      first_name,
      last_name,
      date_of_birth,
      gender,
      norwegian_id,
      languages = 'nb',
      data_processing_consent,
      marketing_consent = false
    } = userData;

    // Hash password
    const password_hash = await bcrypt.hash(password, config.security.bcryptRounds);

    return transaction(async (client) => {
      // Check if user already exists
      const existingUser = await client.query(
        'SELECT id FROM users WHERE email = $1 OR phone_number = $2',
        [email, phone_number]
      );

      if (existingUser.rows.length > 0) {
        throw new Error('User with this email or phone number already exists');
      }

      // Check Norwegian ID if provided
      if (norwegian_id) {
        const existingId = await client.query(
          'SELECT id FROM users WHERE norwegian_id = $1',
          [norwegian_id]
        );

        if (existingId.rows.length > 0) {
          throw new Error('User with this Norwegian ID already exists');
        }
      }

      // Insert user
      const result = await client.query(
        `INSERT INTO users 
         (email, phone_number, password_hash, first_name, last_name, date_of_birth, 
          gender, norwegian_id, languages, data_processing_consent, marketing_consent) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
         RETURNING id, email, phone_number, first_name, last_name, status, created_at`,
        [email, phone_number, password_hash, first_name, last_name, date_of_birth,
         gender, norwegian_id, languages, data_processing_consent, marketing_consent]
      );

      // Log user creation
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description) 
         VALUES ($1, $2, $3)`,
        [result.rows[0].id, 'user_registration', 'User account created']
      );

      return result.rows[0];
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Authenticate user login
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} User data if authentication successful
   */
  async authenticateUser(email, password) {
    const result = await query(
      `SELECT id, email, password_hash, first_name, last_name, status, 
              email_verified, phone_verified, is_driver 
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid credentials');
    }

    const user = result.rows[0];

    if (user.status !== 'active') {
      throw new Error('Account is not active');
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }

    // Update last login
    await query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Remove password hash from response
    delete user.password_hash;
    return user;
  }

  // PUBLIC_INTERFACE
  /**
   * Get user profile by ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User profile data
   */
  async getUserProfile(userId) {
    const result = await query(
      `SELECT id, email, phone_number, first_name, last_name, date_of_birth, 
              gender, profile_picture_url, bio, languages, status, email_verified, 
              phone_verified, id_verified, is_driver, avg_rating_as_driver, 
              avg_rating_as_passenger, total_trips_as_driver, total_trips_as_passenger, 
              subscription_type, credit_balance, created_at 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    return result.rows[0];
  }

  // PUBLIC_INTERFACE
  /**
   * Update user profile
   * @param {string} userId - User ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated user data
   */
  async updateUserProfile(userId, updateData) {
    const allowedFields = [
      'first_name', 'last_name', 'date_of_birth', 'gender', 'bio', 
      'languages', 'profile_picture_url', 'email_notifications', 
      'sms_notifications', 'push_notifications', 'marketing_consent'
    ];

    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = $${paramCount}`);
        updateValues.push(value);
        paramCount++;
      }
    }

    if (updateFields.length === 0) {
      throw new Error('No valid fields to update');
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(userId);

    const result = await query(
      `UPDATE users SET ${updateFields.join(', ')} 
       WHERE id = $${paramCount} 
       RETURNING id, email, first_name, last_name, updated_at`,
      updateValues
    );

    return result.rows[0];
  }

  // PUBLIC_INTERFACE
  /**
   * Verify user's Norwegian ID
   * @param {string} userId - User ID
   * @param {string} norwegianId - Norwegian national ID
   * @returns {Promise<boolean>} Verification result
   */
  async verifyNorwegianId(userId, norwegianId) {
    // In a real implementation, this would call the Norwegian ID verification API
    // For now, we'll simulate the verification
    
    return transaction(async (client) => {
      // Update user record with verified ID
      await client.query(
        `UPDATE users 
         SET norwegian_id = $1, id_verified = true, id_verification_date = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [norwegianId, userId]
      );

      // Log verification activity
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description) 
         VALUES ($1, $2, $3)`,
        [userId, 'id_verification', 'Norwegian ID verified']
      );

      return true;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Verify user's driver license
   * @param {string} userId - User ID
   * @param {string} licenseNumber - Driver license number
   * @param {string} expiryDate - License expiry date
   * @returns {Promise<boolean>} Verification result
   */
  async verifyDriverLicense(userId, licenseNumber, expiryDate) {
    // In a real implementation, this would call the license verification API
    
    return transaction(async (client) => {
      // Update user record with driver license info
      await client.query(
        `UPDATE users 
         SET license_number = $1, license_expiry_date = $2, license_verified = true, 
             license_verification_date = CURRENT_TIMESTAMP, is_driver = true 
         WHERE id = $3`,
        [licenseNumber, expiryDate, userId]
      );

      // Log verification activity
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description) 
         VALUES ($1, $2, $3)`,
        [userId, 'license_verification', 'Driver license verified']
      );

      return true;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Add credit to user account
   * @param {string} userId - User ID
   * @param {number} amount - Credit amount to add
   * @param {string} transactionType - Type of transaction
   * @param {string} description - Transaction description
   * @returns {Promise<Object>} Credit transaction data
   */
  async addUserCredit(userId, amount, transactionType = 'purchase', description) {
    return transaction(async (client) => {
      // Get current balance
      const userResult = await client.query(
        'SELECT credit_balance FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const currentBalance = parseFloat(userResult.rows[0].credit_balance);
      const newBalance = currentBalance + amount;

      // Create credit transaction
      const transactionResult = await client.query(
        `INSERT INTO credit_transactions 
         (user_id, amount, transaction_type, description, balance_before, balance_after) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         RETURNING *`,
        [userId, amount, transactionType, description, currentBalance, newBalance]
      );

      return transactionResult.rows[0];
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Deduct credit from user account
   * @param {string} userId - User ID
   * @param {number} amount - Credit amount to deduct
   * @param {string} transactionType - Type of transaction
   * @param {string} description - Transaction description
   * @returns {Promise<Object>} Credit transaction data
   */
  async deductUserCredit(userId, amount, transactionType = 'payment', description) {
    return transaction(async (client) => {
      // Get current balance
      const userResult = await client.query(
        'SELECT credit_balance FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const currentBalance = parseFloat(userResult.rows[0].credit_balance);
      
      if (currentBalance < amount) {
        throw new Error('Insufficient credit balance');
      }

      const newBalance = currentBalance - amount;

      // Create credit transaction
      const transactionResult = await client.query(
        `INSERT INTO credit_transactions 
         (user_id, amount, transaction_type, description, balance_before, balance_after) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         RETURNING *`,
        [userId, -amount, transactionType, description, currentBalance, newBalance]
      );

      return transactionResult.rows[0];
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Get user's credit transaction history
   * @param {string} userId - User ID
   * @param {number} limit - Number of records to return
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} Credit transaction history
   */
  async getUserCreditHistory(userId, limit = 20, offset = 0) {
    const result = await query(
      `SELECT id, amount, transaction_type, description, balance_before, 
              balance_after, created_at, expires_at 
       FROM credit_transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return result.rows;
  }

  // PUBLIC_INTERFACE
  /**
   * Search users (admin function)
   * @param {Object} searchParams - Search parameters
   * @returns {Promise<Array>} Search results
   */
  async searchUsers(searchParams) {
    const { email, phone, name, status, limit = 50, offset = 0 } = searchParams;
    
    let whereConditions = [];
    let queryParams = [];
    let paramCount = 1;

    if (email) {
      whereConditions.push(`email ILIKE $${paramCount}`);
      queryParams.push(`%${email}%`);
      paramCount++;
    }

    if (phone) {
      whereConditions.push(`phone_number ILIKE $${paramCount}`);
      queryParams.push(`%${phone}%`);
      paramCount++;
    }

    if (name) {
      whereConditions.push(`(first_name ILIKE $${paramCount} OR last_name ILIKE $${paramCount})`);
      queryParams.push(`%${name}%`);
      paramCount++;
    }

    if (status) {
      whereConditions.push(`status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    queryParams.push(limit, offset);

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    const result = await query(
      `SELECT id, email, phone_number, first_name, last_name, status, 
              email_verified, phone_verified, id_verified, is_driver, 
              created_at, last_login 
       FROM users 
       ${whereClause} 
       ORDER BY created_at DESC 
       LIMIT $${paramCount - 1} OFFSET $${paramCount}`,
      queryParams
    );

    return result.rows;
  }
}

module.exports = new UserService();
