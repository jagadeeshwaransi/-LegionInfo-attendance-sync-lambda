const mysql = require("mysql2/promise");

async function connect(config) {
  return await mysql.createConnection({
    host: config.db_host,
    user: config.db_user,
    password: config.db_password,
    database: config.db_name,
  });
}

module.exports = { connect };