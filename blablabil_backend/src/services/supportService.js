const { query, transaction } = require('../config/database');

class SupportService {
  // PUBLIC_INTERFACE
  /**
   * Create a new support ticket
   * @param {string} userId - User ID
   * @param {Object} ticketData - Ticket data
   * @returns {Promise<Object>} Created ticket
   */
  async createSupportTicket(userId, ticketData) {
    const {
      subject,
      description,
      category,
      priority = 'medium',
      related_trip_id,
      related_booking_id
    } = ticketData;

    return transaction(async (client) => {
      // Create support ticket
      const ticketResult = await client.query(
        `INSERT INTO support_tickets 
         (user_id, subject, description, category, priority, related_trip_id, related_booking_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [userId, subject, description, category, priority, related_trip_id, related_booking_id]
      );

      const ticket = ticketResult.rows[0];

      // Create initial message
      await client.query(
        `INSERT INTO support_ticket_messages 
         (ticket_id, sender_id, message, message_type) 
         VALUES ($1, $2, $3, $4)`,
        [ticket.id, userId, description, 'text']
      );

      // Log ticket creation
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description) 
         VALUES ($1, $2, $3)`,
        [userId, 'support_ticket_created', `Created support ticket: ${subject}`]
      );

      return ticket;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Add message to support ticket
   * @param {string} ticketId - Ticket ID
   * @param {string} senderId - Sender user ID
   * @param {string} message - Message content
   * @param {boolean} isInternal - Whether message is internal (admin only)
   * @returns {Promise<Object>} Created message
   */
  async addTicketMessage(ticketId, senderId, message, isInternal = false) {
    return transaction(async (client) => {
      // Verify ticket exists and user has access
      const ticketResult = await client.query(
        `SELECT t.*, u.first_name, u.last_name 
         FROM support_tickets t 
         JOIN users u ON t.user_id = u.id 
         WHERE t.id = $1`,
        [ticketId]
      );

      if (ticketResult.rows.length === 0) {
        throw new Error('Support ticket not found');
      }

      const ticket = ticketResult.rows[0];

      // Check authorization (user owns ticket or is admin)
      if (ticket.user_id !== senderId && !isInternal) {
        // Check if sender is admin
        const adminResult = await client.query(
          'SELECT id FROM admin_users WHERE user_id = $1 AND is_active = true',
          [senderId]
        );

        if (adminResult.rows.length === 0) {
          throw new Error('Not authorized to add message to this ticket');
        }
      }

      // Create message
      const messageResult = await client.query(
        `INSERT INTO support_ticket_messages 
         (ticket_id, sender_id, message, message_type, is_internal) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING *`,
        [ticketId, senderId, message, 'text', isInternal]
      );

      // Update ticket status and timestamp
      let newStatus = ticket.status;
      if (ticket.user_id === senderId && ticket.status === 'resolved') {
        newStatus = 'open'; // Reopen if user responds to resolved ticket
      } else if (ticket.user_id !== senderId && ticket.status === 'open') {
        newStatus = 'in_progress'; // Mark as in progress when admin responds
      }

      await client.query(
        'UPDATE support_tickets SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newStatus, ticketId]
      );

      return messageResult.rows[0];
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Get user's support tickets
   * @param {string} userId - User ID
   * @param {string} status - Status filter
   * @param {number} limit - Limit
   * @param {number} offset - Offset
   * @returns {Promise<Array>} User's tickets
   */
  async getUserTickets(userId, status = null, limit = 20, offset = 0) {
    let whereConditions = ['user_id = $1'];
    let queryParams = [userId];
    let paramCount = 2;

    if (status) {
      whereConditions.push(`status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    queryParams.push(limit, offset);

    const result = await query(
      `SELECT id, subject, category, priority, status, created_at, updated_at,
              (SELECT COUNT(*) FROM support_ticket_messages WHERE ticket_id = support_tickets.id) as message_count
       FROM support_tickets 
       WHERE ${whereConditions.join(' AND ')} 
       ORDER BY updated_at DESC 
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      queryParams
    );

    return result.rows;
  }

  // PUBLIC_INTERFACE
  /**
   * Get support ticket details with messages
   * @param {string} ticketId - Ticket ID
   * @param {string} userId - Requesting user ID
   * @returns {Promise<Object>} Ticket details with messages
   */
  async getTicketDetails(ticketId, userId) {
    // Get ticket details
    const ticketResult = await query(
      `SELECT t.*, u.first_name, u.last_name, u.email,
              tr.origin_city, tr.destination_city, tr.departure_time,
              b.id as booking_id
       FROM support_tickets t 
       JOIN users u ON t.user_id = u.id 
       LEFT JOIN trips tr ON t.related_trip_id = tr.id 
       LEFT JOIN bookings b ON t.related_booking_id = b.id 
       WHERE t.id = $1`,
      [ticketId]
    );

    if (ticketResult.rows.length === 0) {
      throw new Error('Support ticket not found');
    }

    const ticket = ticketResult.rows[0];

    // Check authorization
    if (ticket.user_id !== userId) {
      // Check if user is admin
      const adminResult = await query(
        'SELECT id FROM admin_users WHERE user_id = $1 AND is_active = true',
        [userId]
      );

      if (adminResult.rows.length === 0) {
        throw new Error('Not authorized to view this ticket');
      }
    }

    // Get ticket messages
    const messagesResult = await query(
      `SELECT m.*, u.first_name, u.last_name, 
              CASE WHEN au.user_id IS NOT NULL THEN true ELSE false END as is_admin
       FROM support_ticket_messages m 
       JOIN users u ON m.sender_id = u.id 
       LEFT JOIN admin_users au ON m.sender_id = au.user_id AND au.is_active = true
       WHERE m.ticket_id = $1 AND (m.is_internal = false OR $2 IN (SELECT user_id FROM admin_users WHERE is_active = true))
       ORDER BY m.created_at ASC`,
      [ticketId, userId]
    );

    ticket.messages = messagesResult.rows;
    return ticket;
  }

  // PUBLIC_INTERFACE
  /**
   * Update support ticket status (admin function)
   * @param {string} ticketId - Ticket ID
   * @param {string} adminId - Admin user ID
   * @param {string} status - New status
   * @param {string} resolution - Resolution notes
   * @returns {Promise<Object>} Updated ticket
   */
  async updateTicketStatus(ticketId, adminId, status, resolution = null) {
    return transaction(async (client) => {
      // Verify admin permissions
      const adminResult = await client.query(
        'SELECT id FROM admin_users WHERE user_id = $1 AND is_active = true',
        [adminId]
      );

      if (adminResult.rows.length === 0) {
        throw new Error('Admin access required');
      }

      // Update ticket
      let updateQuery = 'UPDATE support_tickets SET status = $1, updated_at = CURRENT_TIMESTAMP';
      let queryParams = [status];
      let paramCount = 2;

      if (status === 'resolved' && resolution) {
        updateQuery += `, resolution = $${paramCount}, resolved_at = CURRENT_TIMESTAMP`;
        queryParams.push(resolution);
        paramCount++;
      } else if (status === 'closed') {
        updateQuery += ', closed_at = CURRENT_TIMESTAMP';
      }

      if (status === 'in_progress') {
        updateQuery += `, assigned_to = $${paramCount}`;
        queryParams.push(adminId);
        paramCount++;
      }

      updateQuery += ` WHERE id = $${paramCount} RETURNING *`;
      queryParams.push(ticketId);

      const result = await client.query(updateQuery, queryParams);

      if (result.rows.length === 0) {
        throw new Error('Ticket not found');
      }

      // Add internal note about status change
      await client.query(
        `INSERT INTO support_ticket_messages 
         (ticket_id, sender_id, message, message_type, is_internal) 
         VALUES ($1, $2, $3, $4, $5)`,
        [ticketId, adminId, `Status changed to: ${status}${resolution ? `. Resolution: ${resolution}` : ''}`, 
         'text', true]
      );

      return result.rows[0];
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Get FAQ categories and items
   * @param {string} language - Language code
   * @returns {Promise<Array>} FAQ categories with items
   */
  async getFAQs(language = 'nb') {
    const categoriesResult = await query(
      `SELECT id, name, description, display_order 
       FROM faq_categories 
       WHERE language = $1 AND is_active = true 
       ORDER BY display_order, name`,
      [language]
    );

    const categories = [];

    for (const category of categoriesResult.rows) {
      const itemsResult = await query(
        `SELECT id, question, answer, display_order, view_count, helpful_count 
         FROM faq_items 
         WHERE category_id = $1 AND is_active = true 
         ORDER BY display_order, helpful_count DESC`,
        [category.id]
      );

      categories.push({
        ...category,
        items: itemsResult.rows
      });
    }

    return categories;
  }

  // PUBLIC_INTERFACE
  /**
   * Search FAQ items
   * @param {string} searchTerm - Search term
   * @param {string} language - Language code
   * @returns {Promise<Array>} Matching FAQ items
   */
  async searchFAQs(searchTerm, language = 'nb') {
    const result = await query(
      `SELECT f.id, f.question, f.answer, f.view_count, f.helpful_count,
              c.name as category_name
       FROM faq_items f 
       JOIN faq_categories c ON f.category_id = c.id 
       WHERE f.language = $1 AND f.is_active = true AND c.is_active = true
       AND (f.question ILIKE $2 OR f.answer ILIKE $2) 
       ORDER BY f.helpful_count DESC, f.view_count DESC 
       LIMIT 10`,
      [language, `%${searchTerm}%`]
    );

    return result.rows;
  }

  // PUBLIC_INTERFACE
  /**
   * Mark FAQ item as viewed
   * @param {string} faqId - FAQ item ID
   * @returns {Promise<boolean>} Success status
   */
  async markFAQAsViewed(faqId) {
    const result = await query(
      'UPDATE faq_items SET view_count = view_count + 1 WHERE id = $1',
      [faqId]
    );

    return result.rowCount > 0;
  }

  // PUBLIC_INTERFACE
  /**
   * Mark FAQ item as helpful
   * @param {string} faqId - FAQ item ID
   * @returns {Promise<boolean>} Success status
   */
  async markFAQAsHelpful(faqId) {
    const result = await query(
      'UPDATE faq_items SET helpful_count = helpful_count + 1 WHERE id = $1',
      [faqId]
    );

    return result.rowCount > 0;
  }

  // PUBLIC_INTERFACE
  /**
   * Get all support tickets (admin function)
   * @param {Object} filters - Filter parameters
   * @param {number} limit - Limit
   * @param {number} offset - Offset
   * @returns {Promise<Array>} All tickets
   */
  async getAllTickets(filters = {}, limit = 20, offset = 0) {
    const { status, category, priority, assigned_to } = filters;
    
    let whereConditions = [];
    let queryParams = [];
    let paramCount = 1;

    if (status) {
      whereConditions.push(`t.status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    if (category) {
      whereConditions.push(`t.category = $${paramCount}`);
      queryParams.push(category);
      paramCount++;
    }

    if (priority) {
      whereConditions.push(`t.priority = $${paramCount}`);
      queryParams.push(priority);
      paramCount++;
    }

    if (assigned_to) {
      whereConditions.push(`t.assigned_to = $${paramCount}`);
      queryParams.push(assigned_to);
      paramCount++;
    }

    queryParams.push(limit, offset);

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT t.*, u.first_name, u.last_name, u.email,
              a.first_name as admin_first_name, a.last_name as admin_last_name,
              (SELECT COUNT(*) FROM support_ticket_messages WHERE ticket_id = t.id) as message_count
       FROM support_tickets t 
       JOIN users u ON t.user_id = u.id 
       LEFT JOIN users a ON t.assigned_to = a.id 
       ${whereClause}
       ORDER BY 
         CASE t.priority 
           WHEN 'urgent' THEN 1 
           WHEN 'high' THEN 2 
           WHEN 'medium' THEN 3 
           ELSE 4 
         END,
         t.updated_at DESC 
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      queryParams
    );

    return result.rows;
  }
}

module.exports = new SupportService();
