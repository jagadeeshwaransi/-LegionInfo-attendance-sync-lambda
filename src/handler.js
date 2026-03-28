const { processAllDatabases } = require("./services/attendanceService");

(async () => {
  console.log("Lambda started...");
  await processAllDatabases();
  console.log("Lambda completed...");
})();