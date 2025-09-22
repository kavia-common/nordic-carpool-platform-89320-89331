const { query, transaction } = require('../config/database');

class TripService {
  // PUBLIC_INTERFACE
  /**
   * Create a new trip
   * @param {string} driverId - Driver user ID
   * @param {Object} tripData - Trip data
   * @returns {Promise<Object>} Created trip
   */
  async createTrip(driverId, tripData) {
    const {
      vehicle_id,
      origin_city,
      destination_city,
      origin_address,
      destination_address,
      origin_latitude,
      origin_longitude,
      destination_latitude,
      destination_longitude,
      departure_time,
      estimated_arrival_time,
      distance_km,
      duration_minutes,
      price_per_seat,
      available_seats,
      total_seats,
      smoking_allowed = false,
      pets_allowed = false,
      music_allowed = true,
      max_two_passengers_back = false,
      trip_description,
      auto_accept_bookings = false,
      waypoints = []
    } = tripData;

    return transaction(async (client) => {
      // Verify driver exists and is verified
      const driverResult = await client.query(
        'SELECT id, license_verified FROM users WHERE id = $1 AND is_driver = true AND status = $2',
        [driverId, 'active']
      );

      if (driverResult.rows.length === 0) {
        throw new Error('Driver not found or not verified');
      }

      if (!driverResult.rows[0].license_verified) {
        throw new Error('Driver license must be verified to create trips');
      }

      // Verify vehicle belongs to driver
      if (vehicle_id) {
        const vehicleResult = await client.query(
          'SELECT id FROM vehicles WHERE id = $1 AND user_id = $2 AND is_active = true',
          [vehicle_id, driverId]
        );

        if (vehicleResult.rows.length === 0) {
          throw new Error('Vehicle not found or not owned by driver');
        }
      }

      // Create trip
      const tripResult = await client.query(
        `INSERT INTO trips 
         (driver_id, vehicle_id, origin_city, destination_city, origin_address, 
          destination_address, origin_latitude, origin_longitude, destination_latitude, 
          destination_longitude, departure_time, estimated_arrival_time, distance_km, 
          duration_minutes, price_per_seat, available_seats, total_seats, 
          smoking_allowed, pets_allowed, music_allowed, max_two_passengers_back, 
          trip_description, auto_accept_bookings) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) 
         RETURNING *`,
        [driverId, vehicle_id, origin_city, destination_city, origin_address,
         destination_address, origin_latitude, origin_longitude, destination_latitude,
         destination_longitude, departure_time, estimated_arrival_time, distance_km,
         duration_minutes, price_per_seat, available_seats, total_seats,
         smoking_allowed, pets_allowed, music_allowed, max_two_passengers_back,
         trip_description, auto_accept_bookings]
      );

      const trip = tripResult.rows[0];

      // Add waypoints if provided
      if (waypoints && waypoints.length > 0) {
        for (let i = 0; i < waypoints.length; i++) {
          const waypoint = waypoints[i];
          await client.query(
            `INSERT INTO trip_waypoints 
             (trip_id, city, address, latitude, longitude, stop_order, estimated_arrival_time) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [trip.id, waypoint.city, waypoint.address, waypoint.latitude,
             waypoint.longitude, i + 1, waypoint.estimated_arrival_time]
          );
        }
      }

      // Log trip creation
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description, related_trip_id) 
         VALUES ($1, $2, $3, $4)`,
        [driverId, 'trip_creation', `Created trip from ${origin_city} to ${destination_city}`, trip.id]
      );

      return trip;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Search for trips based on criteria
   * @param {Object} searchParams - Search parameters
   * @returns {Promise<Array>} Matching trips
   */
  async searchTrips(searchParams) {
    const {
      origin,
      destination,
      departure_date,
      seats_needed = 1,
      max_price,
      departure_time_from,
      departure_time_to,
      smoking_allowed,
      pets_allowed,
      limit = 20,
      offset = 0
    } = searchParams;

    let whereConditions = ['t.status = $1', 't.departure_time > CURRENT_TIMESTAMP', 't.available_seats >= $2'];
    let queryParams = ['active', seats_needed];
    let paramCount = 3;

    if (origin) {
      whereConditions.push(`t.origin_city ILIKE $${paramCount}`);
      queryParams.push(`%${origin}%`);
      paramCount++;
    }

    if (destination) {
      whereConditions.push(`t.destination_city ILIKE $${paramCount}`);
      queryParams.push(`%${destination}%`);
      paramCount++;
    }

    if (departure_date) {
      whereConditions.push(`DATE(t.departure_time) = $${paramCount}`);
      queryParams.push(departure_date);
      paramCount++;
    }

    if (departure_time_from) {
      whereConditions.push(`t.departure_time >= $${paramCount}`);
      queryParams.push(departure_time_from);
      paramCount++;
    }

    if (departure_time_to) {
      whereConditions.push(`t.departure_time <= $${paramCount}`);
      queryParams.push(departure_time_to);
      paramCount++;
    }

    if (max_price) {
      whereConditions.push(`t.price_per_seat <= $${paramCount}`);
      queryParams.push(max_price);
      paramCount++;
    }

    if (smoking_allowed !== undefined) {
      whereConditions.push(`t.smoking_allowed = $${paramCount}`);
      queryParams.push(smoking_allowed);
      paramCount++;
    }

    if (pets_allowed !== undefined) {
      whereConditions.push(`t.pets_allowed = $${paramCount}`);
      queryParams.push(pets_allowed);
      paramCount++;
    }

    queryParams.push(limit, offset);

    const result = await query(
      `SELECT t.*, 
              u.first_name AS driver_first_name, 
              u.last_name AS driver_last_name, 
              u.avg_rating_as_driver, 
              u.total_trips_as_driver,
              u.profile_picture_url AS driver_profile_picture,
              v.make AS vehicle_make, 
              v.model AS vehicle_model, 
              v.color AS vehicle_color,
              v.year AS vehicle_year
       FROM trips t 
       JOIN users u ON t.driver_id = u.id 
       LEFT JOIN vehicles v ON t.vehicle_id = v.id 
       WHERE ${whereConditions.join(' AND ')} 
       ORDER BY t.departure_time ASC 
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      queryParams
    );

    return result.rows;
  }

  // PUBLIC_INTERFACE
  /**
   * Get trip details by ID
   * @param {string} tripId - Trip ID
   * @param {string} userId - Requesting user ID (optional)
   * @returns {Promise<Object>} Trip details
   */
  async getTripById(tripId, userId = null) {
    const result = await query(
      `SELECT t.*, 
              u.first_name AS driver_first_name, 
              u.last_name AS driver_last_name, 
              u.avg_rating_as_driver, 
              u.total_trips_as_driver,
              u.profile_picture_url AS driver_profile_picture,
              u.phone_number AS driver_phone,
              v.make AS vehicle_make, 
              v.model AS vehicle_model, 
              v.color AS vehicle_color,
              v.year AS vehicle_year,
              v.license_plate,
              v.seats_available AS vehicle_seats
       FROM trips t 
       JOIN users u ON t.driver_id = u.id 
       LEFT JOIN vehicles v ON t.vehicle_id = v.id 
       WHERE t.id = $1`,
      [tripId]
    );

    if (result.rows.length === 0) {
      throw new Error('Trip not found');
    }

    const trip = result.rows[0];

    // Get waypoints
    const waypointsResult = await query(
      `SELECT city, address, latitude, longitude, stop_order, estimated_arrival_time 
       FROM trip_waypoints 
       WHERE trip_id = $1 
       ORDER BY stop_order`,
      [tripId]
    );

    trip.waypoints = waypointsResult.rows;

    // Get existing bookings count (don't show passenger details for privacy)
    const bookingsResult = await query(
      'SELECT COUNT(*) as booking_count FROM bookings WHERE trip_id = $1 AND status IN ($2, $3)',
      [tripId, 'confirmed', 'pending']
    );

    trip.current_bookings = parseInt(bookingsResult.rows[0].booking_count);

    // If user is provided, check if they have a booking for this trip
    if (userId) {
      const userBookingResult = await query(
        'SELECT id, status FROM bookings WHERE trip_id = $1 AND passenger_id = $2',
        [tripId, userId]
      );

      trip.user_booking = userBookingResult.rows[0] || null;
    }

    return trip;
  }

  // PUBLIC_INTERFACE
  /**
   * Update trip details
   * @param {string} tripId - Trip ID
   * @param {string} driverId - Driver ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated trip
   */
  async updateTrip(tripId, driverId, updateData) {
    const allowedFields = [
      'origin_address', 'destination_address', 'departure_time', 
      'estimated_arrival_time', 'price_per_seat', 'available_seats',
      'smoking_allowed', 'pets_allowed', 'music_allowed', 'max_two_passengers_back',
      'trip_description', 'auto_accept_bookings'
    ];

    return transaction(async (client) => {
      // Verify trip belongs to driver and can be updated
      const tripResult = await client.query(
        'SELECT id, status FROM trips WHERE id = $1 AND driver_id = $2',
        [tripId, driverId]
      );

      if (tripResult.rows.length === 0) {
        throw new Error('Trip not found or not owned by driver');
      }

      if (tripResult.rows[0].status !== 'active') {
        throw new Error('Cannot update completed or cancelled trip');
      }

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
      updateValues.push(tripId);

      const result = await client.query(
        `UPDATE trips SET ${updateFields.join(', ')} 
         WHERE id = $${paramCount} 
         RETURNING *`,
        updateValues
      );

      // Log trip update
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description, related_trip_id) 
         VALUES ($1, $2, $3, $4)`,
        [driverId, 'trip_update', 'Updated trip details', tripId]
      );

      return result.rows[0];
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Cancel a trip
   * @param {string} tripId - Trip ID
   * @param {string} driverId - Driver ID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<boolean>} Success status
   */
  async cancelTrip(tripId, driverId, reason) {
    return transaction(async (client) => {
      // Verify trip belongs to driver
      const tripResult = await client.query(
        'SELECT id, status FROM trips WHERE id = $1 AND driver_id = $2',
        [tripId, driverId]
      );

      if (tripResult.rows.length === 0) {
        throw new Error('Trip not found or not owned by driver');
      }

      if (tripResult.rows[0].status === 'cancelled') {
        throw new Error('Trip is already cancelled');
      }

      // Update trip status
      await client.query(
        'UPDATE trips SET status = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['cancelled', tripId]
      );

      // Cancel all pending bookings and process refunds
      const bookingsResult = await client.query(
        'SELECT id, passenger_id, total_price FROM bookings WHERE trip_id = $1 AND status IN ($2, $3)',
        [tripId, 'pending', 'confirmed']
      );

      for (const booking of bookingsResult.rows) {
        // Cancel booking
        await client.query(
          'UPDATE bookings SET status = $1, cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $2, cancellation_reason = $3',
          ['cancelled', driverId, reason]
        );

        // Process refund (add credit back to passenger)
        const passengerResult = await client.query(
          'SELECT credit_balance FROM users WHERE id = $1',
          [booking.passenger_id]
        );

        if (passengerResult.rows.length > 0) {
          const currentBalance = parseFloat(passengerResult.rows[0].credit_balance);
          const newBalance = currentBalance + parseFloat(booking.total_price);

          await client.query(
            `INSERT INTO credit_transactions 
             (user_id, amount, transaction_type, description, balance_before, balance_after, booking_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [booking.passenger_id, booking.total_price, 'refund', 
             'Trip cancellation refund', currentBalance, newBalance, booking.id]
          );
        }
      }

      // Log trip cancellation
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description, related_trip_id) 
         VALUES ($1, $2, $3, $4)`,
        [driverId, 'trip_cancellation', `Cancelled trip: ${reason}`, tripId]
      );

      return true;
    });
  }

  // PUBLIC_INTERFACE
  /**
   * Get driver's trips
   * @param {string} driverId - Driver ID
   * @param {string} status - Trip status filter
   * @param {number} limit - Limit
   * @param {number} offset - Offset
   * @returns {Promise<Array>} Driver's trips
   */
  async getDriverTrips(driverId, status = null, limit = 20, offset = 0) {
    let whereConditions = ['driver_id = $1'];
    let queryParams = [driverId];
    let paramCount = 2;

    if (status) {
      whereConditions.push(`status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    queryParams.push(limit, offset);

    const result = await query(
      `SELECT t.*, 
              COUNT(b.id) as total_bookings,
              COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.total_price ELSE 0 END), 0) as total_earnings
       FROM trips t 
       LEFT JOIN bookings b ON t.id = b.trip_id 
       WHERE ${whereConditions.join(' AND ')} 
       GROUP BY t.id 
       ORDER BY t.departure_time DESC 
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      queryParams
    );

    return result.rows;
  }

  // PUBLIC_INTERFACE
  /**
   * Complete a trip
   * @param {string} tripId - Trip ID
   * @param {string} driverId - Driver ID
   * @returns {Promise<boolean>} Success status
   */
  async completeTrip(tripId, driverId) {
    return transaction(async (client) => {
      // Verify trip belongs to driver
      const tripResult = await client.query(
        'SELECT id, status FROM trips WHERE id = $1 AND driver_id = $2',
        [tripId, driverId]
      );

      if (tripResult.rows.length === 0) {
        throw new Error('Trip not found or not owned by driver');
      }

      if (tripResult.rows[0].status !== 'in_progress') {
        throw new Error('Trip must be in progress to complete');
      }

      // Update trip status
      await client.query(
        'UPDATE trips SET status = $1, completed_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['completed', tripId]
      );

      // Update all confirmed bookings to completed
      await client.query(
        'UPDATE bookings SET status = $1, completed_at = CURRENT_TIMESTAMP WHERE trip_id = $2 AND status = $3',
        ['completed', tripId, 'confirmed']
      );

      // Log trip completion
      await client.query(
        `INSERT INTO user_activity_logs 
         (user_id, activity_type, activity_description, related_trip_id) 
         VALUES ($1, $2, $3, $4)`,
        [driverId, 'trip_completion', 'Completed trip', tripId]
      );

      return true;
    });
  }
}

module.exports = new TripService();
