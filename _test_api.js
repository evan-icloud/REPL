const e = require("./services/eastmoney");
(async () => {
  try {
    var r = await e.getLimitUpStocks();
    console.log("Count:", r.length);
    if (r.length > 0) console.log("Top:", JSON.stringify(r[0]).substring(0,300));
    // Find any with positive change
    var pos = r.filter(function(s) { return s.changePct > 0; });
    console.log("Positive:", pos.length);
  } catch(e) { console.error("Error:", e.message); }
})();