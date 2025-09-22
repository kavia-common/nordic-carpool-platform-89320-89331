const nodemailer = require('nodemailer');
const twilio = require('twilio');
const { query, transaction } = require('../config/database');
const config = require('../config/config');

class NotificationService {
  constructor() {
    // Initialize email transporter
    this.emailTransporter = nodemailer.createTransporter({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth: {
        user: config.email.smtp.user,
        pass: config.email.smtp.pass
      }
    });

    // Initialize Twilio client
    if (config.sms.twilio.accountSid && config.sms.twilio.authToken) {
      this.twilioClient = twilio(
        config.sms.twilio.accountSid,
        config.sms.twilio.authToken
      );
    }
  }

  // PUBLIC_INTERFACE
  /**
   * Send notification to user
   * @param {string} userId - User ID
   * @param {string} templateName - Notification template name
   * @param {Object} templateData - Data for template variables
   * @param {Array} channels - Notification channels ['email', 'sms', 'push']
   * @returns {Promise<Object>} Notification results
   */
  async sendNotification(userId, templateName, templateData, channels = ['email']) {
    return transaction(async (client) => {
      // Get user preferences
      const userResult = await client.query(
        `SELECT email, phone_number, languages, email_notifications, 
                sms_notifications, push_notifications 
         FROM users WHERE id = $1`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = userResult.rows[0];
      const userLanguage = user.languages || 'nb';

      // Get notification template
      const templateResult = await client.query(
        'SELECT * FROM notification_templates WHERE template_name = $1 AND language = $2 AND is_active = true',
        [templateName, userLanguage]
      );

      if (templateResult.rows.length === 0) {
        // Fallback to Norwegian if user language not available
        const fallbackResult = await client.query(
          'SELECT * FROM notification_templates WHERE template_name = $1 AND language = $2 AND is_active = true',
          [templateName, 'nb']
        );

        if (fallbackResult.rows.length === 0) {
          throw new Error(`Template ${templateName} not found`);
        }
      }

      const template = templateResult.rows[0] || fallbackResult.rows[0];
      const results = {};

      // Process each requested channel
      for (const channel of channels) {
        // Check user preferences
        if (channel === 'email' && !user.email_notifications) continue;
        if (channel === 'sms' && !user.sms_notifications) continue;
        if (channel === 'push' && !user.push_notifications) continue;

        try {
          // Get channel-specific template
          const channelTemplate = template.template_type === channel ? template : 
            await this.getChannelTemplate(templateName, channel, userLanguage);

          if (!channelTemplate) continue;

          // Render template
          const subject = this.renderTemplate(channelTemplate.subject_template, templateData);
          const message = this.renderTemplate(channelTemplate.body_template, templateData);

          // Create notification record
          const notificationResult = await client.query(
            `INSERT INTO notifications 
             (user_id, title, message, notification_type, channel, related_trip_id, related_booking_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING *`,
            [userId, subject, message, templateName, channel, 
             templateData.trip_id, templateData.booking_id]
          );

          const notification = notificationResult.rows[0];

          // Send notification based on channel
          switch (channel) {
            case 'email':
              results.email = await this.sendEmail(user.email, subject, message, notification.id);
              break;
            case 'sms':
              results.sms = await this.sendSMS(user.phone_number, message, notification.id);
              break;
            case 'push':
              results.push = await this.sendPushNotification(userId, subject, message, notification.id);
              break;
          }

        } catch (error) {
          console.error(`Failed to send ${channel} notification:`, error);
          results[channel] = { success: false, error: error.message };
        }
      }

      return results;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Send email notification
   * @param {string} email - Recipient email
   * @param {string} subject - Email subject
   * @param {string} message - Email message
   * @param {string} notificationId - Notification ID for tracking
   * @returns {Promise<Object>} Send result
   */
  async sendEmail(email, subject, message, notificationId) {
    try {
      const mailOptions = {
        from: config.email.smtp.user,
        to: email,
        subject: subject,
        html: this.formatEmailMessage(message),
        text: message
      };

      const result = await this.emailTransporter.sendMail(mailOptions);

      // Update notification status
      await query(
        'UPDATE notifications SET status = $1, sent_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['sent', notificationId]
      );

      return { success: true, messageId: result.messageId };

    } catch (error) {
      // Update notification status
      await query(
        'UPDATE notifications SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', error.message, notificationId]
      );

      throw error;
    }
  }

  // PUBLIC_INTERFACE
  /**
   * Send SMS notification
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} message - SMS message
   * @param {string} notificationId - Notification ID for tracking
   * @returns {Promise<Object>} Send result
   */
  async sendSMS(phoneNumber, message, notificationId) {
    if (!this.twilioClient) {
      throw new Error('SMS service not configured');
    }

    try {
      const result = await this.twilioClient.messages.create({
        body: message,
        from: config.sms.twilio.phoneNumber,
        to: phoneNumber
      });

      // Update notification status
      await query(
        'UPDATE notifications SET status = $1, sent_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['sent', notificationId]
      );

      return { success: true, sid: result.sid };

    } catch (error) {
      // Update notification status
      await query(
        'UPDATE notifications SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', error.message, notificationId]
      );

      throw error;
    }
  }

  // PUBLIC_INTERFACE
  /**
   * Send push notification (placeholder for future implementation)
   * @param {string} userId - User ID
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {string} notificationId - Notification ID for tracking
   * @returns {Promise<Object>} Send result
   */
  async sendPushNotification(userId, title, message, notificationId) {
    // Placeholder for push notification implementation
    // In a real implementation, this would integrate with FCM, APNs, or a service like OneSignal
    
    try {
      // Simulate push notification sending
      console.log(`Push notification to user ${userId}: ${title} - ${message}`);

      // Update notification status
      await query(
        'UPDATE notifications SET status = $1, sent_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['sent', notificationId]
      );

      return { success: true, placeholder: true };

    } catch (error) {
      await query(
        'UPDATE notifications SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', error.message, notificationId]
      );

      throw error;
    }
  }

  // PUBLIC_INTERFACE
  /**
   * Get user notifications
   * @param {string} userId - User ID
   * @param {boolean} unreadOnly - Get only unread notifications
   * @param {number} limit - Limit
   * @param {number} offset - Offset
   * @returns {Promise<Array>} User notifications
   */
  async getUserNotifications(userId, unreadOnly = false, limit = 20, offset = 0) {
    let whereConditions = ['user_id = $1'];
    let queryParams = [userId];

    if (unreadOnly) {
      whereConditions.push('read_at IS NULL');
    }

    queryParams.push(limit, offset);

    const result = await query(
      `SELECT id, title, message, notification_type, channel, status, 
              created_at, read_at, related_trip_id, related_booking_id 
       FROM notifications 
       WHERE ${whereConditions.join(' AND ')} 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      queryParams
    );

    return result.rows;
  }

  // PUBLIC_INTERFACE
  /**
   * Mark notification as read
   * @param {string} notificationId - Notification ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async markNotificationAsRead(notificationId, userId) {
    const result = await query(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2',
      [notificationId, userId]
    );

    return result.rowCount > 0;
  }

  // PUBLIC_INTERFACE
  /**
   * Mark all notifications as read for user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Number of notifications marked as read
   */
  async markAllNotificationsAsRead(userId) {
    const result = await query(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND read_at IS NULL',
      [userId]
    );

    return result.rowCount;
  }

  // PUBLIC_INTERFACE
  /**
   * Send booking confirmation notification
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Object>} Notification results
   */
  async sendBookingConfirmation(bookingId) {
    const bookingResult = await query(
      `SELECT b.*, t.origin_city, t.destination_city, t.departure_time,
              u.first_name, u.last_name
       FROM bookings b 
       JOIN trips t ON b.trip_id = t.id 
       JOIN users u ON b.passenger_id = u.id 
       WHERE b.id = $1`,
      [bookingId]
    );

    if (bookingResult.rows.length === 0) {
      throw new Error('Booking not found');
    }

    const booking = bookingResult.rows[0];
    const templateData = {
      passenger_name: `${booking.first_name} ${booking.last_name}`,
      origin: booking.origin_city,
      destination: booking.destination_city,
      date: new Date(booking.departure_time).toLocaleDateString('nb-NO'),
      time: new Date(booking.departure_time).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }),
      seats: booking.seats_booked,
      price: booking.total_price,
      booking_id: booking.id,
      trip_id: booking.trip_id
    };

    return this.sendNotification(
      booking.passenger_id,
      'booking_confirmation',
      templateData,
      ['email', 'sms']
    );
  }

  // PUBLIC_INTERFACE
  /**
   * Send trip reminder notification
   * @param {string} tripId - Trip ID
   * @returns {Promise<Array>} Notification results for all passengers
   */
  async sendTripReminder(tripId) {
    const bookingsResult = await query(
      `SELECT b.*, t.origin_city, t.destination_city, t.departure_time,
              u.first_name, u.last_name
       FROM bookings b 
       JOIN trips t ON b.trip_id = t.id 
       JOIN users u ON b.passenger_id = u.id 
       WHERE b.trip_id = $1 AND b.status = 'confirmed'`,
      [tripId]
    );

    const results = [];

    for (const booking of bookingsResult.rows) {
      const hoursUntilDeparture = Math.round(
        (new Date(booking.departure_time) - new Date()) / (1000 * 60 * 60)
      );

      const templateData = {
        passenger_name: `${booking.first_name} ${booking.last_name}`,
        origin: booking.origin_city,
        destination: booking.destination_city,
        hours: hoursUntilDeparture,
        trip_id: tripId,
        booking_id: booking.id
      };

      try {
        const result = await this.sendNotification(
          booking.passenger_id,
          'trip_reminder',
          templateData,
          ['sms']
        );
        results.push({ bookingId: booking.id, result });
      } catch (error) {
        results.push({ bookingId: booking.id, error: error.message });
      }
    }

    return results;
  }

  // Private helper methods

  /**
   * Get channel-specific template
   * @param {string} templateName - Template name
   * @param {string} channel - Channel type
   * @param {string} language - Language
   * @returns {Promise<Object>} Template
   */
  async getChannelTemplate(templateName, channel, language) {
    const result = await query(
      'SELECT * FROM notification_templates WHERE template_name = $1 AND template_type = $2 AND language = $3 AND is_active = true',
      [templateName, channel, language]
    );

    return result.rows[0] || null;
  }

  /**
   * Render template with data
   * @param {string} template - Template string
   * @param {Object} data - Template data
   * @returns {string} Rendered template
   */
  renderTemplate(template, data) {
    if (!template) return '';
    
    let rendered = template;
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`{${key}}`, 'g');
      rendered = rendered.replace(regex, value || '');
    }
    return rendered;
  }

  /**
   * Format email message with HTML
   * @param {string} message - Plain text message
   * @returns {string} HTML formatted message
   */
  formatEmailMessage(message) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #6B7280; color: white; padding: 20px; text-align: center;">
              <h1>BlablaBil</h1>
            </div>
            <div style="padding: 20px; background-color: #f9f9f9;">
              ${message.replace(/\n/g, '<br>')}
            </div>
            <div style="text-align: center; padding: 20px; font-size: 12px; color: #666;">
              <p>BlablaBil - Din pålitelige kjørepartner i Norge</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}

module.exports = new NotificationService();
