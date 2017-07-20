var path = require('path');
var server = require(path.join(__dirname, "server", "server.js"));
var client = require(path.join(__dirname, "client", "client.js"));

if (process.argv.length != 3) {
	console.log("WARN: Must specify run mode (server | client)");
	console.log("Exiting...");
	process.exit(-1);
}

var mode = process.argv[2];
if (mode === "server") {
	server.start();
} else if (mode === "client") {
	client.start();
} else {
	console.log("ERROR: Unsupported run type: " + mode);
	console.log("  Supported types are 'server' or 'client'");
	process.exit(-1);
}