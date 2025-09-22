const { Pool } = require('pg');
require('dotenv').config();

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5000,
  database: process.env.DB_NAME || 'blablabil_database',
  user: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'dbuser123',
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

// Create connection pool
const pool = new Pool(dbConfig);

// Test database connection
pool.on('connect', () => {
  console.log('✓ Database connected successfully');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
  process.exit(-1);
});

// PUBLIC_INTERFACE
/**
 * Execute a database query
 * @param {string} text - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise} Query result
 */
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query:', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// PUBLIC_INTERFACE
/**
 * Get a database client for transactions
 * @returns {Promise} Database client
 */
const getClient = () => {
  return pool.connect();
};

// PUBLIC_INTERFACE
/**
 * Execute multiple queries in a transaction
 * @param {Function} callback - Function containing queries to execute
 * @returns {Promise} Transaction result
 */
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// PUBLIC_INTERFACE
/**
 * Check database connection health
 * @returns {Promise<boolean>} Connection status
 */
const checkConnection = async () => {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
};

module.exports = {
  query,
  getClient,
  transaction,
  checkConnection,
  pool
};
