require('dotenv').config();

const config = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development'
  },

  // Database Configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5000,
    name: process.env.DB_NAME || 'blablabil_database',
    user: process.env.DB_USER || 'appuser',
    password: process.env.DB_PASSWORD || 'dbuser123'
  },

  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
  },

  // Security Configuration
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
    sessionSecret: process.env.SESSION_SECRET || 'fallback-session-secret',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
  },

  // External APIs
  apis: {
    norwegianId: {
      url: process.env.NORWEGIAN_ID_API_URL || 'https://api.digdir.no',
      key: process.env.NORWEGIAN_ID_API_KEY
    },
    phoneVerification: {
      key: process.env.PHONE_VERIFICATION_API_KEY
    },
    vipps: {
      clientId: process.env.VIPPS_CLIENT_ID,
      clientSecret: process.env.VIPPS_CLIENT_SECRET,
      subscriptionKey: process.env.VIPPS_SUBSCRIPTION_KEY,
      merchantSerialNumber: process.env.VIPPS_MERCHANT_SERIAL_NUMBER,
      baseUrl: process.env.VIPPS_BASE_URL || 'https://api.vipps.no'
    },
    licenseVerification: {
      url: process.env.LICENSE_VERIFICATION_API_URL || 'https://api.vegvesen.no',
      key: process.env.LICENSE_VERIFICATION_API_KEY
    },
    googleMaps: {
      key: process.env.GOOGLE_MAPS_API_KEY
    }
  },

  // Email Configuration
  email: {
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  },

  // SMS Configuration
  sms: {
    provider: process.env.SMS_PROVIDER || 'twilio',
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER
    }
  },

  // File Upload
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880, // 5MB
    uploadPath: process.env.UPLOAD_PATH || 'uploads/'
  },

  // Localization
  localization: {
    defaultLanguage: process.env.DEFAULT_LANGUAGE || 'nb',
    supportedLanguages: (process.env.SUPPORTED_LANGUAGES || 'nb,nn,en').split(',')
  },

  // GDPR & Data Retention
  gdpr: {
    dataRetentionDays: parseInt(process.env.DATA_RETENTION_DAYS) || 2555, // 7 years
    exportExpiryHours: parseInt(process.env.GDPR_EXPORT_EXPIRY_HOURS) || 48
  },

  // Admin Configuration
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@blablabil.no',
    supportEmail: process.env.SUPPORT_EMAIL || 'support@blablabil.no'
  }
};

module.exports = config;
