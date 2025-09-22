const axios = require('axios');
const { query, transaction } = require('../config/database');
const config = require('../config/config');

class PaymentService {
  // PUBLIC_INTERFACE
  /**
   * Initialize Vipps payment
   * @param {string} userId - User ID
   * @param {number} amount - Payment amount in NOK
   * @param {string} description - Payment description
   * @param {string} bookingId - Related booking ID (optional)
   * @returns {Promise<Object>} Payment initialization result
   */
  async initializeVippsPayment(userId, amount, description, bookingId = null) {
    return transaction(async (client) => {
      // Create payment record
      const paymentResult = await client.query(
        `INSERT INTO payments 
         (user_id, booking_id, amount, currency, payment_method, payment_description, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [userId, bookingId, amount, 'NOK', 'vipps', description, 'pending']
      );

      const payment = paymentResult.rows[0];

      try {
        // Get Vipps access token
        const accessToken = await this.getVippsAccessToken();

        // Initialize payment with Vipps
        const vippsResponse = await axios.post(
          `${config.apis.vipps.baseUrl}/ecomm/v2/payments`,
          {
            customerInfo: {
              mobileNumber: await this.getUserPhoneNumber(userId)
            },
            merchantInfo: {
              merchantSerialNumber: config.apis.vipps.merchantSerialNumber,
              callbackPrefix: `${process.env.SITE_URL || 'http://localhost:3000'}/api/payments/vipps/callback`,
              fallBack: `${process.env.SITE_URL || 'http://localhost:3000'}/payment/fallback`
            },
            transaction: {
              amount: Math.round(amount * 100), // Convert to øre
              transactionText: description,
              orderId: payment.id
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Ocp-Apim-Subscription-Key': config.apis.vipps.subscriptionKey,
              'Merchant-Serial-Number': config.apis.vipps.merchantSerialNumber
            }
          }
        );

        // Update payment with Vipps reference
        await client.query(
          'UPDATE payments SET external_payment_id = $1, status = $2 WHERE id = $3',
          [vippsResponse.data.orderId, 'processing', payment.id]
        );

        return {
          paymentId: payment.id,
          vippsUrl: vippsResponse.data.url,
          orderId: vippsResponse.data.orderId
        };

      } catch (error) {
        // Update payment status to failed
        await client.query(
          'UPDATE payments SET status = $1, failure_reason = $2 WHERE id = $3',
          ['failed', error.message, payment.id]
        );

        throw new Error('Failed to initialize Vipps payment: ' + error.message);
      }
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Process Vipps payment callback
   * @param {string} orderId - Vipps order ID
   * @param {Object} callbackData - Vipps callback data
   * @returns {Promise<Object>} Processing result
   */
  async processVippsCallback(orderId, callbackData) {
    return transaction(async (client) => {
      // Find payment by external ID
      const paymentResult = await client.query(
        'SELECT * FROM payments WHERE external_payment_id = $1',
        [orderId]
      );

      if (paymentResult.rows.length === 0) {
        throw new Error('Payment not found');
      }

      const payment = paymentResult.rows[0];

      try {
        // Get payment details from Vipps
        const accessToken = await this.getVippsAccessToken();
        const paymentDetails = await this.getVippsPaymentDetails(orderId, accessToken);

        if (paymentDetails.transactionInfo.status === 'CHARGED') {
          // Payment successful
          await client.query(
            'UPDATE payments SET status = $1, processed_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['completed', payment.id]
          );

          // If this was for a booking, update booking status
          if (payment.booking_id) {
            await client.query(
              'UPDATE bookings SET payment_status = $1 WHERE id = $2',
              ['completed', payment.booking_id]
            );
          }

          // Log successful payment
          await client.query(
            `INSERT INTO user_activity_logs 
             (user_id, activity_type, activity_description, related_booking_id) 
             VALUES ($1, $2, $3, $4)`,
            [payment.user_id, 'payment_completed', 
             `Vipps payment completed: ${payment.amount} NOK`, payment.booking_id]
          );

          return { status: 'success', payment };

        } else if (paymentDetails.transactionInfo.status === 'CANCELLED') {
          // Payment cancelled
          await client.query(
            'UPDATE payments SET status = $1 WHERE id = $2',
            ['cancelled', payment.id]
          );

          return { status: 'cancelled', payment };

        } else {
          // Payment failed
          await client.query(
            'UPDATE payments SET status = $1, failure_reason = $2 WHERE id = $3',
            ['failed', paymentDetails.transactionInfo.statusDescription, payment.id]
          );

          return { status: 'failed', payment };
        }

      } catch (error) {
        await client.query(
          'UPDATE payments SET status = $1, failure_reason = $2 WHERE id = $3',
          ['failed', error.message, payment.id]
        );

        throw error;
      }
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Process credit payment
   * @param {string} userId - User ID
   * @param {number} amount - Payment amount
   * @param {string} description - Payment description
   * @param {string} bookingId - Related booking ID
   * @returns {Promise<Object>} Payment result
   */
  async processCreditPayment(userId, amount, description, bookingId) {
    return transaction(async (client) => {
      // Check user credit balance
      const userResult = await client.query(
        'SELECT credit_balance FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const creditBalance = parseFloat(userResult.rows[0].credit_balance);
      if (creditBalance < amount) {
        throw new Error('Insufficient credit balance');
      }

      // Create payment record
      const paymentResult = await client.query(
        `INSERT INTO payments 
         (user_id, booking_id, amount, currency, payment_method, payment_description, status, processed_at, completed_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
         RETURNING *`,
        [userId, bookingId, amount, 'NOK', 'credit', description, 'completed']
      );

      const payment = paymentResult.rows[0];

      // Deduct credit from user balance
      const newBalance = creditBalance - amount;
      await client.query(
        `INSERT INTO credit_transactions 
         (user_id, amount, transaction_type, description, balance_before, balance_after, payment_id, booking_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, -amount, 'payment', description, creditBalance, newBalance, payment.id, bookingId]
      );

      // Update booking payment status
      await client.query(
        'UPDATE bookings SET payment_status = $1 WHERE id = $2',
        ['completed', bookingId]
      );

      return { status: 'success', payment };
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Process refund
   * @param {string} paymentId - Original payment ID
   * @param {number} refundAmount - Refund amount
   * @param {string} reason - Refund reason
   * @returns {Promise<Object>} Refund result
   */
  async processRefund(paymentId, refundAmount, reason) {
    return transaction(async (client) => {
      // Get original payment
      const paymentResult = await client.query(
        'SELECT * FROM payments WHERE id = $1 AND status = $2',
        [paymentId, 'completed']
      );

      if (paymentResult.rows.length === 0) {
        throw new Error('Payment not found or not eligible for refund');
      }

      const payment = paymentResult.rows[0];

      if (refundAmount > parseFloat(payment.amount)) {
        throw new Error('Refund amount cannot exceed original payment amount');
      }

      try {
        if (payment.payment_method === 'vipps') {
          // Process Vipps refund
          const accessToken = await this.getVippsAccessToken();
          
          await axios.post(
            `${config.apis.vipps.baseUrl}/ecomm/v2/payments/${payment.external_payment_id}/refund`,
            {
              merchantInfo: {
                merchantSerialNumber: config.apis.vipps.merchantSerialNumber
              },
              transaction: {
                amount: Math.round(refundAmount * 100), // Convert to øre
                transactionText: reason
              }
            },
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': config.apis.vipps.subscriptionKey,
                'Merchant-Serial-Number': config.apis.vipps.merchantSerialNumber
              }
            }
          );

        } else if (payment.payment_method === 'credit') {
          // Add credit back to user account
          const userResult = await client.query(
            'SELECT credit_balance FROM users WHERE id = $1',
            [payment.user_id]
          );

          const currentBalance = parseFloat(userResult.rows[0].credit_balance);
          const newBalance = currentBalance + refundAmount;

          await client.query(
            `INSERT INTO credit_transactions 
             (user_id, amount, transaction_type, description, balance_before, balance_after, payment_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [payment.user_id, refundAmount, 'refund', reason, currentBalance, newBalance, paymentId]
          );
        }

        // Update payment record
        await client.query(
          'UPDATE payments SET refunded_amount = $1, refunded_at = CURRENT_TIMESTAMP, refund_reason = $2 WHERE id = $3',
          [refundAmount, reason, paymentId]
        );

        return { status: 'success', refundAmount };

      } catch (error) {
        throw new Error('Failed to process refund: ' + error.message);
      }
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Get user's payment history
   * @param {string} userId - User ID
   * @param {number} limit - Limit
   * @param {number} offset - Offset
   * @returns {Promise<Array>} Payment history
   */
  async getUserPaymentHistory(userId, limit = 20, offset = 0) {
    const result = await query(
      `SELECT p.*, b.trip_id,
              t.origin_city, t.destination_city, t.departure_time
       FROM payments p 
       LEFT JOIN bookings b ON p.booking_id = b.id 
       LEFT JOIN trips t ON b.trip_id = t.id 
       WHERE p.user_id = $1 
       ORDER BY p.created_at DESC 
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return result.rows;
  }

  // Private helper methods

  /**
   * Get Vipps access token
   * @returns {Promise<string>} Access token
   */
  async getVippsAccessToken() {
    const response = await axios.post(
      `${config.apis.vipps.baseUrl}/accesstoken/get`,
      {},
      {
        headers: {
          'client_id': config.apis.vipps.clientId,
          'client_secret': config.apis.vipps.clientSecret,
          'Ocp-Apim-Subscription-Key': config.apis.vipps.subscriptionKey
        }
      }
    );

    return response.data.access_token;
  }

  /**
   * Get payment details from Vipps
   * @param {string} orderId - Order ID
   * @param {string} accessToken - Access token
   * @returns {Promise<Object>} Payment details
   */
  async getVippsPaymentDetails(orderId, accessToken) {
    const response = await axios.get(
      `${config.apis.vipps.baseUrl}/ecomm/v2/payments/${orderId}/details`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Ocp-Apim-Subscription-Key': config.apis.vipps.subscriptionKey,
          'Merchant-Serial-Number': config.apis.vipps.merchantSerialNumber
        }
      }
    );

    return response.data;
  }

  /**
   * Get user phone number for Vipps
   * @param {string} userId - User ID
   * @returns {Promise<string>} Phone number
   */
  async getUserPhoneNumber(userId) {
    const result = await query(
      'SELECT phone_number FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    return result.rows[0].phone_number;
  }
}

module.exports = new PaymentService();
