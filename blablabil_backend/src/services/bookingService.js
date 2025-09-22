const { query, transaction } = require('../config/database');

class BookingService {
  // PUBLIC_INTERFACE
  /**
   * Create a new booking
   * @param {string} passengerId - Passenger user ID
   * @param {Object} bookingData - Booking data
   * @returns {Promise<Object>} Created booking
   */
  async createBooking(passengerId, bookingData) {
    const {
      trip_id,
      seats_booked,
      pickup_location,
      dropoff_location,
      pickup_latitude,
      pickup_longitude,
      dropoff_latitude,
      dropoff_longitude,
      payment_method,
      special_requests
    } = bookingData;

    return transaction(async (client) => {
      // Get trip details and verify availability
      const tripResult = await client.query(
        `SELECT t.*, u.first_name as driver_first_name, u.last_name as driver_last_name 
         FROM trips t 
         JOIN users u ON t.driver_id = u.id 
         WHERE t.id = $1 AND t.status = $2 AND t.departure_time > CURRENT_TIMESTAMP`,
        [trip_id, 'active']
      );

      if (tripResult.rows.length === 0) {
        throw new Error('Trip not found or not available for booking');
      }

      const trip = tripResult.rows[0];

      // Check if passenger is trying to book their own trip
      if (trip.driver_id === passengerId) {
        throw new Error('Cannot book your own trip');
      }

      // Check if passenger already has a booking for this trip
      const existingBookingResult = await client.query(
        'SELECT id FROM bookings WHERE trip_id = $1 AND passenger_id = $2',
        [trip_id, passengerId]
      );

      if (existingBookingResult.rows.length > 0) {
        throw new Error('You already have a booking for this trip');
      }

      // Check seat availability
      if (trip.available_seats < seats_booked) {
        throw new Error(`Only ${trip.available_seats} seats available`);
      }

      // Calculate total price
      const total_price = parseFloat(trip.price_per_seat) * seats_booked;

      // Verify payment method and user balance if using credit
      if (payment_method === 'credit') {
        const userResult = await client.query(
          'SELECT credit_balance FROM users WHERE id = $1',
          [passengerId]
        );

        if (userResult.rows.length === 0) {
          throw new Error('User not found');
        }

        const creditBalance = parseFloat(userResult.rows[0].credit_balance);
        if (creditBalance < total_price) {
          throw new Error('Insufficient credit balance');
        }
      }

      // Create booking
      const bookingResult = await client.query(
        `INSERT INTO bookings 
         (trip_id, passenger_id, seats_booked, pickup_location, dropoff_location, 
          pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude, 
          total_price, payment_method, special_requests) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
         RETURNING *`,
        [trip_id, passengerId, seats_booked, pickup_location, dropoff_location,
         pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude,
         total_price, payment_method, special_requests]
      );

      const booking = bookingResult.rows[0];

      // Update trip availability
      await client.query(
        'UPDATE trips SET available_seats = available_seats - $1 WHERE id = $2',
        [seats_booked, trip_id]
      );

      // Process payment based on method
      if (payment_method === 'credit') {
        // Deduct credit immediately
        const userResult = await client.query(
          'SELECT credit_balance FROM users WHERE id = $1',
          [passengerId]
        );

        const currentBalance = parseFloat(userResult.rows[0].credit_balance);
        const newBalance = currentBalance - total_price;

        await client.query(
          `INSERT INTO credit_transactions 
           (user_id, amount, transaction_type, description, balance_before, balance_after, booking_id) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [passengerId, -total_price, 'payment', 
           'Payment for trip booking', currentBalance, newBalance, booking.id]
        );

        // Auto-confirm booking for credit payments
        await client.query(
          'UPDATE bookings SET status = $1, confirmed_at = CURRENT_TIMESTAMP WHERE id = $2',
          ['confirmed', booking.id]
        );

        booking.status = 'confirmed';
        booking.confirmed_at = new Date();
      } else if (trip.auto_accept_bookings) {
        // Auto-confirm if driver has this setting enabled
        await client.query(
          'UPDATE bookings SET status = $1, confirmed_at = CURRENT_TIMESTAMP WHERE id = $2',
          ['confirmed', booking.id]
        );

        booking.status = 'confirmed';
        booking.confirmed_at = new Date();
      }

      // Log booking creation
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description, related_trip_id, related_booking_id) 
         VALUES ($1, $2, $3, $4, $5)`,
        [passengerId, 'booking_creation', 
         `Booked ${seats_booked} seat(s) for trip from ${trip.origin_city} to ${trip.destination_city}`,
         trip_id, booking.id]
      );

      return booking;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Confirm a booking (driver action)
   * @param {string} bookingId - Booking ID
   * @param {string} driverId - Driver ID
   * @returns {Promise<Object>} Updated booking
   */
  async confirmBooking(bookingId, driverId) {
    return transaction(async (client) => {
      // Verify booking belongs to driver's trip
      const bookingResult = await client.query(
        `SELECT b.*, t.driver_id, t.origin_city, t.destination_city 
         FROM bookings b 
         JOIN trips t ON b.trip_id = t.id 
         WHERE b.id = $1`,
        [bookingId]
      );

      if (bookingResult.rows.length === 0) {
        throw new Error('Booking not found');
      }

      const booking = bookingResult.rows[0];

      if (booking.driver_id !== driverId) {
        throw new Error('Not authorized to confirm this booking');
      }

      if (booking.status !== 'pending') {
        throw new Error('Booking is not in pending status');
      }

      // Confirm booking
      await client.query(
        'UPDATE bookings SET status = $1, confirmed_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['confirmed', bookingId]
      );

      // Log confirmation
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description, related_booking_id) 
         VALUES ($1, $2, $3, $4)`,
        [driverId, 'booking_confirmation', 'Confirmed passenger booking', bookingId]
      );

      booking.status = 'confirmed';
      booking.confirmed_at = new Date();
      return booking;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Cancel a booking
   * @param {string} bookingId - Booking ID
   * @param {string} userId - User ID (passenger or driver)
   * @param {string} reason - Cancellation reason
   * @returns {Promise<boolean>} Success status
   */
  async cancelBooking(bookingId, userId, reason) {
    return transaction(async (client) => {
      // Get booking details
      const bookingResult = await client.query(
        `SELECT b.*, t.driver_id, t.departure_time, t.origin_city, t.destination_city 
         FROM bookings b 
         JOIN trips t ON b.trip_id = t.id 
         WHERE b.id = $1`,
        [bookingId]
      );

      if (bookingResult.rows.length === 0) {
        throw new Error('Booking not found');
      }

      const booking = bookingResult.rows[0];

      // Check authorization
      if (booking.passenger_id !== userId && booking.driver_id !== userId) {
        throw new Error('Not authorized to cancel this booking');
      }

      if (booking.status === 'cancelled') {
        throw new Error('Booking is already cancelled');
      }

      // Check cancellation policy (example: no cancellation within 2 hours of departure)
      const departureTime = new Date(booking.departure_time);
      const now = new Date();
      const hoursUntilDeparture = (departureTime - now) / (1000 * 60 * 60);

      let refundPercentage = 1.0; // 100% refund by default

      if (hoursUntilDeparture < 2) {
        refundPercentage = 0.5; // 50% refund if within 2 hours
      } else if (hoursUntilDeparture < 24) {
        refundPercentage = 0.8; // 80% refund if within 24 hours
      }

      // Cancel booking
      await client.query(
        `UPDATE bookings SET status = $1, cancelled_at = CURRENT_TIMESTAMP, 
         cancelled_by = $2, cancellation_reason = $3 WHERE id = $4`,
        ['cancelled', userId, reason, bookingId]
      );

      // Return seats to trip availability
      await client.query(
        'UPDATE trips SET available_seats = available_seats + $1 WHERE id = $2',
        [booking.seats_booked, booking.trip_id]
      );

      // Process refund if payment was made
      if (booking.payment_method === 'credit' && booking.status === 'confirmed') {
        const refundAmount = parseFloat(booking.total_price) * refundPercentage;

        if (refundAmount > 0) {
          const userResult = await client.query(
            'SELECT credit_balance FROM users WHERE id = $1',
            [booking.passenger_id]
          );

          const currentBalance = parseFloat(userResult.rows[0].credit_balance);
          const newBalance = currentBalance + refundAmount;

          await client.query(
            `INSERT INTO credit_transactions 
             (user_id, amount, transaction_type, description, balance_before, balance_after, booking_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [booking.passenger_id, refundAmount, 'refund', 
             `Booking cancellation refund (${Math.round(refundPercentage * 100)}%)`, 
             currentBalance, newBalance, booking.id]
          );
        }
      }

      // Log cancellation
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description, related_booking_id) 
         VALUES ($1, $2, $3, $4)`,
        [userId, 'booking_cancellation', `Cancelled booking: ${reason}`, bookingId]
      );

      return true;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Get user's bookings (as passenger)
   * @param {string} passengerId - Passenger ID
   * @param {string} status - Status filter
   * @param {number} limit - Limit
   * @param {number} offset - Offset
   * @returns {Promise<Array>} User's bookings
   */
  async getUserBookings(passengerId, status = null, limit = 20, offset = 0) {
    let whereConditions = ['b.passenger_id = $1'];
    let queryParams = [passengerId];
    let paramCount = 2;

    if (status) {
      whereConditions.push(`b.status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    queryParams.push(limit, offset);

    const result = await query(
      `SELECT b.*, 
              t.origin_city, t.destination_city, t.departure_time, t.estimated_arrival_time,
              u.first_name as driver_first_name, u.last_name as driver_last_name,
              u.phone_number as driver_phone, u.avg_rating_as_driver,
              v.make as vehicle_make, v.model as vehicle_model, v.color as vehicle_color
       FROM bookings b 
       JOIN trips t ON b.trip_id = t.id 
       JOIN users u ON t.driver_id = u.id 
       LEFT JOIN vehicles v ON t.vehicle_id = v.id 
       WHERE ${whereConditions.join(' AND ')} 
       ORDER BY t.departure_time DESC 
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      queryParams
    );

    return result.rows;
  }

  // PUBLIC_INTERFACE
  /**
   * Get trip's bookings (driver view)
   * @param {string} tripId - Trip ID
   * @param {string} driverId - Driver ID
   * @returns {Promise<Array>} Trip bookings
   */
  async getTripBookings(tripId, driverId) {
    // Verify trip belongs to driver
    const tripResult = await query(
      'SELECT id FROM trips WHERE id = $1 AND driver_id = $2',
      [tripId, driverId]
    );

    if (tripResult.rows.length === 0) {
      throw new Error('Trip not found or not owned by driver');
    }

    const result = await query(
      `SELECT b.*, 
              u.first_name, u.last_name, u.phone_number, u.avg_rating_as_passenger
       FROM bookings b 
       JOIN users u ON b.passenger_id = u.id 
       WHERE b.trip_id = $1 
       ORDER BY b.created_at ASC`,
      [tripId]
    );

    return result.rows;
  }

  // PUBLIC_INTERFACE
  /**
   * Get booking details by ID
   * @param {string} bookingId - Booking ID
   * @param {string} userId - Requesting user ID
   * @returns {Promise<Object>} Booking details
   */
  async getBookingById(bookingId, userId) {
    const result = await query(
      `SELECT b.*, 
              t.origin_city, t.destination_city, t.departure_time, t.estimated_arrival_time,
              t.driver_id, t.origin_address, t.destination_address,
              u.first_name as driver_first_name, u.last_name as driver_last_name,
              u.phone_number as driver_phone,
              p.first_name as passenger_first_name, p.last_name as passenger_last_name,
              p.phone_number as passenger_phone
       FROM bookings b 
       JOIN trips t ON b.trip_id = t.id 
       JOIN users u ON t.driver_id = u.id 
       JOIN users p ON b.passenger_id = p.id 
       WHERE b.id = $1`,
      [bookingId]
    );

    if (result.rows.length === 0) {
      throw new Error('Booking not found');
    }

    const booking = result.rows[0];

    // Check authorization
    if (booking.passenger_id !== userId && booking.driver_id !== userId) {
      throw new Error('Not authorized to view this booking');
    }

    return booking;
  }

  // PUBLIC_INTERFACE
  /**
   * Update booking special requests
   * @param {string} bookingId - Booking ID
   * @param {string} passengerId - Passenger ID
   * @param {string} specialRequests - Special requests
   * @returns {Promise<Object>} Updated booking
   */
  async updateBookingRequests(bookingId, passengerId, specialRequests) {
    return transaction(async (client) => {
      // Verify booking belongs to passenger
      const bookingResult = await client.query(
        'SELECT id, status FROM bookings WHERE id = $1 AND passenger_id = $2',
        [bookingId, passengerId]
      );

      if (bookingResult.rows.length === 0) {
        throw new Error('Booking not found or not owned by passenger');
      }

      if (bookingResult.rows[0].status === 'cancelled') {
        throw new Error('Cannot update cancelled booking');
      }

      // Update special requests
      const result = await client.query(
        'UPDATE bookings SET special_requests = $1 WHERE id = $2 RETURNING *',
        [specialRequests, bookingId]
      );

      // Log update
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description, related_booking_id) 
         VALUES ($1, $2, $3, $4)`,
        [passengerId, 'booking_update', 'Updated booking special requests', bookingId]
      );

      return result.rows[0];
    });
  }
}

module.exports = new BookingService();
