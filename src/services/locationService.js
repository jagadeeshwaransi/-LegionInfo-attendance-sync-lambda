const db = require("../repositories/postgresRepo");

async function getAllConfigs() {
  const res = await db.query(
  `SELECT * FROM config.external_db_config 
   WHERE is_active = true AND type = 'attendance'`
);

  return res.rows;
}

module.exports = { getAllConfigs };