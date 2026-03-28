const db = require("../config/db");

async function query(text, params) {
  return db.query(text, params);
}

module.exports = { query };