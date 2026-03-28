const db = require("../repositories/postgresRepo");

async function getDeviceMasterByDeviceId(deviceId) {
  const res = await db.query(
    `SELECT client_id, contractor_id, project_id 
     FROM config.device_master 
     WHERE device_id = $1 AND is_active = true`,
    [deviceId]
  );
  return res.rows[0];
}

module.exports = { getDeviceMasterByDeviceId };
