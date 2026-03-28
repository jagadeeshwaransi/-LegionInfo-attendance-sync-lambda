const db = require("../repositories/postgresRepo");

async function getUserById(userId) {
  const res = await db.query(
    "SELECT * FROM user_and_permissions.users WHERE id = $1",
    [userId]
  );

  return res.rows[0];
}

async function getUserByPersonId(employeeCode) {
  const res = await db.query(
    "SELECT * FROM user_and_permissions.users WHERE id = $1",
    [employeeCode]
  );
  return res.rows[0];
}

module.exports = { getUserById, getUserByPersonId };