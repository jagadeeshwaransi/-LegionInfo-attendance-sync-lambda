function groupByUserAndDate(logs) {
  const map = {};

  logs.forEach((log) => {
    const date = new Date(log.LogDate).toISOString().split("T")[0];
    const key = `${log.UserId}_${date}`;

    if (!map[key]) {
      map[key] = [];
    }

    map[key].push(log);
  });

  return Object.values(map);
}

module.exports = { groupByUserAndDate };