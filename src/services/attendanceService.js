const { getAllConfigs } = require("./locationService");
const { createJob, updateJob, getLastLogId } = require("./jobService");
const { processLogs } = require("./logService");
const mysql = require("../config/mysql");
const { logInfo, logError } = require("../utils/logger");

async function processAllDatabases() {
    const configs = await getAllConfigs();

    for (const config of configs) {
        let job;

        try {
            logInfo(`Processing ${config.name}`);

          
            job = await createJob(config.id);

            
            const conn = await mysql.connect(config);


            const lastId = await getLastLogId(config.id);

            const result = await processLogs(
                conn,
                lastId,
                config.id
            );

            await updateJob(job.id, {
                status: "completed",
                rows_affected: result.count,
                last_log_id: result.lastLogId,
                message: result.messages && result.messages.length > 0 ? result.messages.join(" | ") : null,
            });

            await conn.end();

        } catch (err) {
            logError("Processing failed", err);

            if (job) {
                await updateJob(job.id, {
                    status: "failed",
                    message: err.message,
                });
            }
        }
    }
}

module.exports = { processAllDatabases };