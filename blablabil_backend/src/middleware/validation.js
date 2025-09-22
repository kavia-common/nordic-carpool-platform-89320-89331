const { body, validationResult, param, query } = require('express-validator');

// Norwegian phone number validation
const norwegianPhoneRegex = /^(\+47|0047|47)?[4-9]\d{7}$/;

// Norwegian national ID validation (11 digits with check digits)
const validateNorwegianId = (id) => {
  if (!/^\d{11}$/.test(id)) return false;
  
  const digits = id.split('').map(Number);
  const weights1 = [3, 7, 6, 1, 8, 9, 4, 5, 2];
  const weights2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  
  let sum1 = 0;
  let sum2 = 0;
  
  for (let i = 0; i < 9; i++) {
    sum1 += digits[i] * weights1[i];
  }
  
  for (let i = 0; i < 10; i++) {
    sum2 += digits[i] * weights2[i];
  }
  
  const check1 = (11 - (sum1 % 11)) % 11;
  const check2 = (11 - (sum2 % 11)) % 11;
  
  return check1 === digits[9] && check2 === digits[10];
};

// PUBLIC_INTERFACE
/**
 * Validation middleware for user registration
 */
const validateUserRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email required'),
  body('phone_number')
    .matches(norwegianPhoneRegex)
    .withMessage('Valid Norwegian phone number required'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be at least 8 characters with uppercase, lowercase and number'),
  body('first_name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('First name required (max 100 characters)'),
  body('last_name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Last name required (max 100 characters)'),
  body('date_of_birth')
    .optional()
    .isISO8601()
    .withMessage('Valid date required'),
  body('norwegian_id')
    .optional()
    .custom(value => {
      if (value && !validateNorwegianId(value)) {
        throw new Error('Invalid Norwegian national ID');
      }
      return true;
    }),
  body('languages')
    .optional()
    .isIn(['nb', 'nn', 'en'])
    .withMessage('Language must be nb, nn, or en'),
  body('data_processing_consent')
    .isBoolean()
    .custom(value => {
      if (!value) {
        throw new Error('Data processing consent required');
      }
      return true;
    })
];

// PUBLIC_INTERFACE
/**
 * Validation middleware for user login
 */
const validateUserLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email required'),
  body('password')
    .notEmpty()
    .withMessage('Password required')
];

// PUBLIC_INTERFACE
/**
 * Validation middleware for trip creation
 */
const validateTripCreation = [
  body('origin_city')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Origin city required (max 100 characters)'),
  body('destination_city')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Destination city required (max 100 characters)'),
  body('departure_time')
    .isISO8601()
    .custom(value => {
      if (new Date(value) <= new Date()) {
        throw new Error('Departure time must be in the future');
      }
      return true;
    }),
  body('price_per_seat')
    .isFloat({ min: 0 })
    .withMessage('Price per seat must be a positive number'),
  body('available_seats')
    .isInt({ min: 1, max: 8 })
    .withMessage('Available seats must be between 1 and 8'),
  body('total_seats')
    .isInt({ min: 1, max: 8 })
    .withMessage('Total seats must be between 1 and 8'),
  body('distance_km')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Distance must be a positive number'),
  body('duration_minutes')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Duration must be a positive number')
];

// PUBLIC_INTERFACE
/**
 * Validation middleware for booking creation
 */
const validateBookingCreation = [
  body('trip_id')
    .isUUID()
    .withMessage('Valid trip ID required'),
  body('seats_booked')
    .isInt({ min: 1, max: 8 })
    .withMessage('Seats booked must be between 1 and 8'),
  body('pickup_location')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Pickup location max 200 characters'),
  body('dropoff_location')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Dropoff location max 200 characters'),
  body('payment_method')
    .isIn(['vipps', 'cash', 'credit'])
    .withMessage('Payment method must be vipps, cash, or credit')
];

// PUBLIC_INTERFACE
/**
 * Validation middleware for vehicle registration
 */
const validateVehicleRegistration = [
  body('make')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Vehicle make required (max 50 characters)'),
  body('model')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Vehicle model required (max 50 characters)'),
  body('year')
    .optional()
    .isInt({ min: 1950, max: new Date().getFullYear() + 1 })
    .withMessage('Valid vehicle year required'),
  body('license_plate')
    .trim()
    .matches(/^[A-Z]{2}\d{5}$|^[A-Z]{2}\d{4}$/)
    .withMessage('Valid Norwegian license plate required'),
  body('seats_available')
    .isInt({ min: 1, max: 8 })
    .withMessage('Seats available must be between 1 and 8'),
  body('vehicle_type')
    .optional()
    .isIn(['car', 'van', 'suv', 'other'])
    .withMessage('Vehicle type must be car, van, suv, or other')
];

// PUBLIC_INTERFACE
/**
 * Validation middleware for support ticket creation
 */
const validateSupportTicket = [
  body('subject')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Subject required (max 255 characters)'),
  body('description')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Description required (min 10 characters)'),
  body('category')
    .isIn(['technical', 'payment', 'booking', 'safety', 'other'])
    .withMessage('Valid category required'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('Priority must be low, medium, high, or urgent')
];

// PUBLIC_INTERFACE
/**
 * Validation middleware for trip search
 */
const validateTripSearch = [
  query('origin')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Origin max 100 characters'),
  query('destination')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Destination max 100 characters'),
  query('date')
    .optional()
    .isISO8601()
    .withMessage('Valid date required'),
  query('seats')
    .optional()
    .isInt({ min: 1, max: 8 })
    .withMessage('Seats must be between 1 and 8'),
  query('max_price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Max price must be positive'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be non-negative')
];

// PUBLIC_INTERFACE
/**
 * Validation middleware for UUID parameters
 */
const validateUUIDParam = (paramName) => [
  param(paramName)
    .isUUID()
    .withMessage(`Valid ${paramName} required`)
];

// PUBLIC_INTERFACE
/**
 * Middleware to handle validation errors
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.path,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

module.exports = {
  validateUserRegistration,
  validateUserLogin,
  validateTripCreation,
  validateBookingCreation,
  validateVehicleRegistration,
  validateSupportTicket,
  validateTripSearch,
  validateUUIDParam,
  handleValidationErrors,
  validateNorwegianId
};
