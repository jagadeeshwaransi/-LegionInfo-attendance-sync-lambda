const db = require("../repositories/postgresRepo");

async function createJob(configId) {
  const res = await db.query(
    `INSERT INTO job.attendance_sync_log 
     (external_db_config_id, status)
     VALUES ($1, 'inprogress')
     RETURNING *`,
    [configId]
  );

  return res.rows[0];
}

async function updateJob(jobId, data) {
  await db.query(
    `UPDATE job.attendance_sync_log
     SET status = $1,
         rows_affected = $2,
         last_log_id = $3,
         message = $4,
         checkpoint_date = NOW(),
         updated_at = NOW()
     WHERE id = $5`,
    [
      data.status,
      data.rows_affected || 0,
      data.last_log_id || null,
      data.message || null,
      jobId,
    ]
  );
}

async function getLastLogId(configId) {
  const res = await db.query(
    `SELECT last_log_id 
     FROM job.attendance_sync_log
     WHERE external_db_config_id = $1
     AND last_log_id IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [configId]
  );

  return res.rows.length ? res.rows[0].last_log_id : 0;
}

module.exports = { createJob, updateJob ,getLastLogId };