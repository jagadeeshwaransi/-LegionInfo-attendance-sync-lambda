async function fetchLogs(conn, lastId) {
  const [rows] = await conn.execute(
    `SELECT dl.*, dev.DeviceDirection 
     FROM devicelogs dl
     LEFT JOIN devices dev ON dl.DeviceId = dev.DeviceId
     WHERE dl.DeviceLogId > ? 
     ORDER BY dl.DeviceLogId ASC 
     LIMIT 1000`,
    [lastId]
  );
  return rows;
}

module.exports = { fetchLogs };