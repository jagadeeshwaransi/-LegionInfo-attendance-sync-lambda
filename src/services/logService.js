const { fetchLogs } = require("../repositories/mysqlRepo");
const { getUserByPersonId } = require("./userService");
const { getDeviceMasterByDeviceId } = require("./deviceService");
const db = require("../repositories/postgresRepo");

function processUserLogs(logs, messages) {
  // Sort logs by LogDate ascending
  logs.sort((a, b) => new Date(a.LogDate) - new Date(b.LogDate));

  const cleanLogs = [];
  const DEBOUNCE_MS = 5 * 60 * 1000;

  for (let i = 0; i < logs.length; i++) {
    if (cleanLogs.length === 0) {
      cleanLogs.push(logs[i]);
      continue;
    }
    const prevLogTime = new Date(cleanLogs[cleanLogs.length - 1].LogDate).getTime();
    const currentLogTime = new Date(logs[i].LogDate).getTime();

    if (currentLogTime - prevLogTime > DEBOUNCE_MS) {
      cleanLogs.push(logs[i]);
    }
  }

  const daysMap = {};
  cleanLogs.forEach(log => {
    const dateStr = new Date(log.LogDate).toISOString().split("T")[0];
    if (!daysMap[dateStr]) daysMap[dateStr] = [];
    daysMap[dateStr].push(log);
  });

  const dailyReports = [];

  for (const [dateStr, dayLogs] of Object.entries(daysMap)) {
    const firstLog = dayLogs[0];
    const lastLog = dayLogs[dayLogs.length - 1];

    const firstScan = new Date(firstLog.LogDate);
    const lastScan = new Date(lastLog.LogDate);

    const isSingleScan = dayLogs.length === 1;
    const totalMinutes = (lastScan.getTime() - firstScan.getTime()) / (1000 * 60);

    // Status logic:
    // If within 24 hrs in one checkin time then status considered as inprogress
    // otherwise completed
    // if it is last value is checkin take it as completed status
    const now = new Date();
    let status = "completed";
    if (isSingleScan && (now.getTime() - firstScan.getTime()) < 24 * 60 * 60 * 1000) {
      status = "inprogress";
    }

    let maxLogId = 0;
    dayLogs.forEach(l => {
      if (l.DeviceLogId > maxLogId) maxLogId = l.DeviceLogId;
    });

    dailyReports.push({
      date: dateStr,
      checkInTime: firstScan.toTimeString().split(" ")[0],
      checkOutTime: lastScan.toTimeString().split(" ")[0],
      workedHours: parseFloat((totalMinutes / 60).toFixed(2)),
      maxLogId,
      deviceId: firstLog.DeviceId,
      status: status,
      isSingleScan: isSingleScan,
      lastLogDirection: lastLog.Direction || lastLog.DeviceDirection
    });
  }

  return dailyReports;
}

async function processLogs(conn, lastId, locationId) {
  const [logs] = await conn.execute(
    `SELECT dl.*, dev.DeviceDirection 
     FROM devicelogs dl
     LEFT JOIN devices dev ON dl.DeviceId = dev.DeviceId
     WHERE dl.DeviceLogId > ? 
     ORDER BY dl.DeviceLogId ASC 
     LIMIT 500`,
    [lastId]
  );

  let count = 0;
  let maxId = lastId;
  const messages = [];

  const userGroups = {};
  logs.forEach(log => {
    if (!userGroups[log.UserId]) userGroups[log.UserId] = [];
    userGroups[log.UserId].push(log);
  });

  for (const [userId, userLogs] of Object.entries(userGroups)) {
    try {
      const user = await getUserByPersonId(userId.toString());
      if (!user) {
        messages.push(`EmployeeCode ${userId}: Missing postgres user record`);
        continue;
      }

      const shifts = processUserLogs(userLogs, messages);

      for (const shift of shifts) {
        const deviceMaster = await getDeviceMasterByDeviceId(shift.deviceId ? shift.deviceId.toString() : "");

        if (!deviceMaster) {
          messages.push(`LogId ${shift.maxLogId}: Missing device_master mapping for deviceId ${shift.deviceId}`);
          continue;
        }

        // Check if a record already exists for this person and date
        const existingRes = await db.query(
          `SELECT id, check_in_time, check_out_time 
           FROM ohsstats.manhours_report 
           WHERE person_id = $1 AND date = $2 
           LIMIT 1`,
          [userId.toString(), shift.date]
        );

        if (existingRes.rows.length > 0) {
          const existing = existingRes.rows[0];

          // Merge times: pick the earliest check-in and the latest check-out
          const existingIn = new Date(`${shift.date}T${existing.check_in_time}`);
          const existingOut = new Date(`${shift.date}T${existing.check_out_time}`);
          const newIn = new Date(`${shift.date}T${shift.checkInTime}`);
          const newOut = new Date(`${shift.date}T${shift.checkOutTime}`);

          const finalIn = new Date(Math.min(existingIn.getTime(), newIn.getTime()));
          const finalOut = new Date(Math.max(existingOut.getTime(), newOut.getTime()));

          const finalTotalMinutes = (finalOut.getTime() - finalIn.getTime()) / (1000 * 60);
          const finalWorkedHours = parseFloat((finalTotalMinutes / 60).toFixed(2));
          const finalManDay = (finalWorkedHours / 8).toString();

          const checkInStr = finalIn.toTimeString().split(" ")[0];
          const checkOutStr = finalOut.toTimeString().split(" ")[0];

          await db.query(
            `UPDATE ohsstats.manhours_report SET 
              check_in_time = $1, 
              check_out_time = $2, 
              worked_hours = $3, 
              man_day = $4,
              source = $5
             WHERE id = $6`,
            [
              checkInStr,
              checkOutStr,
              finalWorkedHours,
              finalManDay,
              "2",
              existing.id
            ]
          );
        } else {
          await db.query(
            `INSERT INTO ohsstats.manhours_report (
              client_id,
              contractor_id,
              project_id,
              person_id,
              person_name,
              date,
              check_in_time,
              check_out_time,
              worked_hours,
              man_day,
              source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              deviceMaster.client_id,
              deviceMaster.contractor_id || null,
              deviceMaster.project_id,
              userId.toString(),
              user.name,
              shift.date,
              shift.checkInTime,
              shift.checkOutTime,
              shift.workedHours,
              (parseFloat(shift.workedHours || 0) / 8).toString(),
              "2"
            ]
          );
        }
        count++;

        if (shift.maxLogId > maxId) {
          maxId = shift.maxLogId;
        }
      }
    } catch (err) {
      messages.push(`User ${userId}: ${err.message}`);
    }
  }

  if (logs.length > 0) {
    const absoluteMax = Math.max(...logs.map(l => l.DeviceLogId));
    if (absoluteMax > maxId) maxId = absoluteMax;
  }

  return { count, lastLogId: maxId, messages, status: 'Completed' };
}

module.exports = { processLogs };