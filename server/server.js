// server.js
// ----------
// The host server end of this solution.
// 
// The host opens up the following network endpoints
// OPTIONS / : Returns a list of all known clients and their properties
// GET /fingerprint : Returns the RSA fingerprint of the host's public PGP key
// PUT /client/:client : Creates a new client based on the supplied options and returns the public
//     key of the host.
// POST /client/:client : Updates a specific client with the supplied options
var express = require('express');
var app = express();
var path = require('path');
var request = require('request');

var bodyParser = require('body-parser');
var multer = require('multer');
var upload = multer();

var conf = require(path.join(__dirname, 'config.js'));

var fs = require('fs');
var clients = {};
var nclean = require('node-cleanup');

var Key = require(path.join(__dirname, "..", "key.js"));
var thisKey = null;
var adminKey = null;

// Export a method to start this service
module.exports.start = (cb) => {
	setup(cb);
	thisKey = new Key(conf, () => {
		// Load the admin key
		thisKey.loadFile("_ADMIN_", conf.ADMIN_PUB_KEY_FILE).then((k) => {
			console.log("  Loaded Admin Key");
			adminKey = k;	
		});
		
		// Read in all public keys
		for (var c in clients) {
			console.log("INFO: Loading key '" + c + "'");
			thisKey.loadFile(c, clients[c].pgp_pub);
		}

		// Make sure to start pinging clients as soon as possible
		setTimeout(() => {
			console.log("INFO: Pinging clients...");
			pingAll();
		}, conf.POLL_MS_INTERVAL);

		listen();
	});
};

// Helper method for sending errors
// - res: Express response | The socket to send the error over
// - code: Integer | The error code to send
// - msg: String | The error message to send
var err = (res, code, msg) => {
	console.log(msg);
	res.status(code).send(msg);
};

// Set up the server and its express endpoints
function setup(cb) {
	// Attempt to load clients from file
	fs.readFile(conf.CLIENTS, (err, data) => {
		if (err) {
			console.log("WARN: No clients found. Assuming first run...");
			return;
		}

		clients = JSON.parse(data);
	});

	// Setup handler to save all clients to file when node exits
	nclean((exitCode, signal) => {
		console.log("Saving clients to file...");
		fs.writeFileSync(conf.CLIENTS, JSON.stringify(clients), {});
		
		if (cb) cb();
	});

	// Setup body parsing capabilitites
	app.use(bodyParser.json()); // for parsing application/json
	app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

	// Setup decrypting middleware
	app.use("/client/:client", (req, res, next) => {
		if (req.body && req.body.hasOwnProperty("msg") && req.params.client) {
			try {
				thisKey.dec({
					msg: req.body.msg
				}).then((msg) => {
					// Make sure that the message is from the sender
					if (msg[0].owner !== clients[req.params.client].fingerprint) {
						console.error("ERROR: Message signer does not match sender. Ignoring");
						res.sendStatus(403);
					} else {
						req.dec_msg = msg;
						req.is_secure = true;
						next();
					}
				});
			} catch (error) {
				err(res, 501, "ERROR: Could not decode message. Ignoring");
			}
		} else {
			req.is_secure = false;
			next();
		}
	});

	// Return list of clients whith GET
	app.options("/", upload.array(), (req, res) => {
		if (req.body && req.body.hasOwnProperty("msg")) {
			try {
				thisKey.dec({
					msg: req.body.msg
				}).then((msg) => {
					// Make sure that the message is from the sender
					if (msg[0].owner !== Key.fingerprintOf(adminKey)) {
						console.error("ERROR: Non-admin attempt to get clients");
						res.sendStatus(403);
					} else {
						var jmsg = JSON.parse(msg[0].msg);
						if (jmsg.client) {
							switch (jmsg.op) {
								case "GET":
									res.send(clients[jmsg.client]); break;
								case "DELETE":
									del(res, jmsg.client); break;
								default:
									err(res, 400, "ERROR: Malformed request");
							}
						} else {
							res.send(clients);
						}
					}
				});
			} catch (error) {
				err(res, 501, "ERROR: Could not decode message. Ignoring");
			}
		} else {
			err(res, 400, "ERROR: Malformed request");
		}
	});

	// Get the server's RSA fingerprint for verification purposes
	app.get("/fingerprint", (req, res) => {
		var fp = thisKey.fingerprint;
		console.log("INFO: RSA fingerprint requested");
		console.log("  => " + fp);

		res.send(fp);
	});

	// Create new client with PUT
	app.put("/client/:client", upload.array(), (req, res) => {
		var client = req.params.client;

		if (!client || !req.body || !req.body.client) {
			err(res, 400, "ERROR: No client specified");
			return;
		}

		if (clients.hasOwnProperty(client)) {
			err(res, 400, "ERROR: Client exists");
			return;
		}

		clients[client] = populate(req.body.client);

		var key_path = path.join(__dirname, "..", "keys", client + ".pub");
		fs.writeFile(key_path, clients[client].pgp_pub, (err) => {
			if (err) throw err;

			thisKey.loadArmored(client, clients[client].pgp_pub).then((k) => {
				clients[client].fingerprint = Key.fingerprintOf(k);
				setTimeout(() => ping(client, k), conf.POLL_MS_INTERVAL);

				res.status(201).send(thisKey.pub()); // Created
			});

			// Strip the public key from the config and replace it with a reference to the file
			clients[client].pgp_pub = key_path;
		});
	});

	// Update existing client with POST
	app.post("/client/:client", upload.array(), (req, res) => {
		var client = req.params.client;
		var msg = req.dec_msg;

		if (!req.is_secure) {
			err(res, 403, "ERROR: Not authorized");
			return;
		}

		if (!client) {
			err(res, 400, "ERROR: No client specified");
			return;
		}

		if (!clients.hasOwnProperty(client)) {
			err(res, 400, "ERROR: Specified client does not exist");
			return;
		}

		// Update all fields
		for (var m in msg) {
			var json = JSON.parse(msg[m].msg);
			for (var k in json) {
				if (!clients[client].hasOwnProperty(k)) {
					err(res, 400, "ERROR: Client does not have specified property '" + k + "'");
					return;
				}

				clients[client][k] = json[k];
			}
		}

		ping(client);
		clients[client].last_update = Date.now();
		res.sendStatus(202); // accepted
	});
}

// Delete an existing client
function del (res, client) {
	if (!client) {
		err(res, 400, "ERROR: No client specified");
		return;
	}

	if (!clients.hasOwnProperty(client)) {
		err(res, 400, "ERROR: Specified client does not exist");
		return;
	}

	// Delete the PGP file on hand
	fs.unlink(path.join(__dirname, "..", "keys", client + ".pub"), (err) => {
		if (err) throw err;
	});

	thisKey.unload(client);
	delete clients[client];
	res.sendStatus(200);
}

// Starts the express server
function listen() {
	app.listen(conf.PORT, conf.HOST, () => {
		console.log("Server listening on " + conf.HOST + ":" + conf.PORT);
	});
}

// Populates an example client with specified overrides
// - overrides: JSON | List of fields to override the defaults
function populate(overrides) {
	return {
		address: null,
		port: null,
		pgp_pub: overrides.pgp_pub || null,
		fingerprint: null,
		last_update: overrides.last_update || Date.now()
	};
}

// Pings a client with client name alone
// - c: String | The client to ping
function ping(c) {
	ping(c, thisKey.getKeyByName(c));
}

// Pings a client with specified name and KeyManager
// - c: String | The client to ping
// - k: KeyManager | The key of the specified client
function ping(c, k) {
	thisKey.enc({
		msg: "ping",
		to: k
	}).then((encoded) => {
		request.post(clients[c].address + ":" + clients[c].port + "/ping", {
			json: {
				msg: encoded.str
			}
		}, (err, res, body) => {
			if (err || res.statusCode !== 200) {
				console.log("WARN: Could not connect to client '" + c + "'. Client has likely moved...");
				return;
			}

			// Update last update flag
			clients[c].last_update = Date.now();

			// Get ready to ping again
			setTimeout(() => ping(c, k), conf.POLL_MS_INTERVAL);
		});
	});
}

// Get ready to ping all available clients
function pingAll() {
	for (var c in clients) {
		ping(c, thisKey.getKeyByName(c));
	}
}