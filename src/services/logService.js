const { fetchLogs } = require("../repositories/mysqlRepo");
const { getUserByPersonId } = require("./userService");
const { getDeviceMasterByDeviceId } = require("./deviceService");
const db = require("../repositories/postgresRepo");

function processUserLogs(logs, messages) {

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
    let currentSession = { in: null, out: null };
    const completedSessions = [];

    dayLogs.forEach(log => {

      let direction = null;
      const rawDirection = log.Direction || log.DeviceDirection;

      if (rawDirection) {
        const dirStr = rawDirection.toUpperCase();
        if (dirStr.includes("IN")) direction = "IN";
        if (dirStr.includes("OUT")) direction = "OUT";
      }

      if (direction === "IN") {
        if (!currentSession.in) {
          currentSession.in = log;
        }
      } else if (direction === "OUT") {
        if (currentSession.in) {
          currentSession.out = log;
          completedSessions.push({ ...currentSession });
          currentSession = { in: null, out: null };
        } else {

          currentSession.in = null;
          currentSession.out = log;
          completedSessions.push({ ...currentSession });
          currentSession = { in: null, out: null };
        }
      } else {

        if (currentSession.in) {
          currentSession.out = log;
          completedSessions.push({ ...currentSession });
          currentSession = { in: null, out: null };
        } else {
          currentSession.in = log;
        }


        messages.push(`LogId ${log.DeviceLogId}: Missing HW Direction`);
      }
    });

    if (currentSession.in || currentSession.out) {
      completedSessions.push({ ...currentSession });
    }


    let totalMinutes = 0;
    let isMissingCheckout = false;

    completedSessions.forEach(session => {
      if (session.in && session.out) {
        const inTime = new Date(session.in.LogDate).getTime();
        const outTime = new Date(session.out.LogDate).getTime();


        if (outTime - inTime > 16 * 60 * 60 * 1000) {
          isMissingCheckout = true;
          session.out = null;
        } else {
          totalMinutes += (outTime - inTime) / (1000 * 60);
        }
      } else {
        isMissingCheckout = true;
      }
    });

    if (completedSessions.length === 0) continue;

    const firstSession = completedSessions[0];
    const firstScanObj = firstSession.in || firstSession.out;
    const firstScan = new Date(firstScanObj.LogDate);


    const lastSession = completedSessions[completedSessions.length - 1];
    const lastScanObj = lastSession.out || lastSession.in;


    const lastScan = new Date(lastScanObj.LogDate);

    let maxLogId = 0;
    completedSessions.forEach(s => {
      if (s.in && s.in.DeviceLogId > maxLogId) maxLogId = s.in.DeviceLogId;
      if (s.out && s.out.DeviceLogId > maxLogId) maxLogId = s.out.DeviceLogId;
    });

    dailyReports.push({
      date: dateStr,
      checkInTime: firstScan.toTimeString().split(" ")[0],
      checkOutTime: lastScan.toTimeString().split(" ")[0], 
      workedHours: isMissingCheckout ? 0 : parseFloat((totalMinutes / 60).toFixed(2)),
      maxLogId,
      deviceId: firstScanObj.DeviceId
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

  return { count, lastLogId: maxId, messages };
}

module.exports = { processLogs };