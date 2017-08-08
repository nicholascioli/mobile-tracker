// client.js
// ----------
// The client end of this solution
// 
// The client opens up the following endpoints:
// POST /ping : Alerts the client that the host can see it (encrypted and verified by PGP)
var express = require('express');
var app = express();
var request = require('request');

var fs = require('fs');
var path = require('path');
var conf = require(path.join(__dirname, "config.js"));
var Key = require(path.join(__dirname, "..", "key.js"));
var prompt = require('prompt');

var bodyParser = require('body-parser');
var multer = require('multer');
var upload = multer();

var hostKey = null;
var thisKey = null;

var timeout = null;
var external_ip = null;
var last_ping = 0;

// Export a method to start this service
module.exports.start = () => {
	thisKey = new Key(conf, () => {
		setup(); 
		listen();
	});
};

// Set up the client for use
function setup() {
	// Attempt to load host key
	fs.readFile(conf.HOST_KEY, (err, armored_key) => {
		if (err) {
			console.log("WARN: Host key not found. Contacting host...");
			addSelf();

			return;
		}

		thisKey.loadArmored("HOST", armored_key).then((k) => {
			console.log("INFO: Loaded host key");
			hostKey = k;
			getIp();
		});
	});

	// Setup body parsing capabilitites
	app.use(bodyParser.json()); // for parsing application/json
	app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

	// Define express paths
	// Define a route for responding to the host's pings
	app.post("/ping", upload.array(), (req, res) => {
		if (!req.body || !req.body.msg) {
			console.error("ERROR: Malformed request to ping");
			res.status(400).send("ERROR: Malformed request to ping");
		}

		thisKey.dec({
			msg: req.body.msg
		}).then((decoded) => {
			if (decoded[0].msg === "ping" && decoded[0].owner === Key.fingerprintOf(hostKey)) {
				clearTimeout(timeout);
				timeout = setTimeout(() => shouldUpdate(), conf.MAX_MS_INTERVAL);

				res.sendStatus(200);
			} else {
				console.log("WARN: Someone other than the host has attempted to ping.");
				res.sendStatus(400);
			}
		});
	});

	// Set client to inform server if it has been long enough
	timeout = setTimeout(() => shouldUpdate(), conf.MAX_MS_INTERVAL);
}

// Attempts to connect with host server to add self to list of clients
function addSelf() {
	var k = thisKey.pub();

	// First get the RSA fingerprint of the server
	request.get(conf.MASTER_HOST + ":" + conf.MASTER_PORT + "/fingerprint", {}, (rsa_err, rsa_res, rsa_body) => {
		if (rsa_err) throw rsa_err;
		if (!rsa_body) throw new Error("ERROR: Empty response from host");

		console.log("Got host fingerprint of => " + rsa_body);
		var fp = rsa_body;

		// Make sure that fingerprints match
		prompt.start();
		prompt.get({
			properties: {
				agree: {
					pattern: /^[yYnN]$/,
					description: "Does the RSA fingerprint match the Host's? (y/n)",
					required: true
				}
			}
		}, (prompt_err, answer) => {
			if (prompt_err) throw err;
			if (answer.agree !== 'y' && answer.agree !== 'Y') throw new Error("ERROR: RSA Fingerprints do not match.");

			// If RSA fingerprints match, add self to host
			request.put(conf.MASTER_HOST + ":" + conf.MASTER_PORT + "/client/" + conf.CLIENT_NAME, { json: {
				client: {
					pgp_pub: k,
					last_update: Date.now()
				}
			}}, (req_err, req_res, pgp_body) => {
				if (req_err) throw err;

				if (req_res.statusCode !== 201) {
					console.log("ERROR: (" + req_res.statusCode + ") Could not create client");
					throw new Error();
				}

				thisKey.loadArmored("HOST", pgp_body).then((host_k) => {
					if (fp !== Key.fingerprintOf(host_k)) throw new Error("ERROR: Received public key does not match supplied fingerprint");

					fs.writeFile(conf.HOST_KEY, pgp_body, (fs_err) => {
						if (fs_err) throw fs_err;

						console.log("Host key received from tracker");
						hostKey = host_k;
						getIp();
					});

				});
			});
		});
	});
}

// Start the express server
function listen() {
	app.listen(conf.PORT, conf.HOST, () => {
		console.log("Listening");
	});
}

// Check if the host should be informed of any updates to the client's IP
function shouldUpdate() {
	console.log("WARN: Host has not ponged in a while, checking if IP has changed...");
	if (!last_ping || Date.now() - last_ping > conf.POLL_MS_INTERVAL)
		getIp();

	// Make sure to check again later
	clearTimeout(timeout);
	timeout = setTimeout(() => shouldUpdate(), conf.MAX_MS_INTERVAL);
}

// Attempt to get the client's IP using the Ipify public API
function getIp() {
	console.log("INFO: Getting IP");
	request.get("https://api.ipify.org", {}, (err, res, body) => {
		if (err) throw err;

		if (res.statusCode !== 200) {
			console.log("ERROR: Could not get external IP");
			throw new Error();
		}

		console.log("INFO: IP is '" + body + "'");
		if (external_ip != body) {
			external_ip = body;
			updateAddress();
		}
	});
}

// Update the host server of the client's new IP address
function updateAddress() {
	console.log("INFO: Updating host");
	thisKey.enc({
		msg: JSON.stringify({address: external_ip, port: conf.PORT}),
		to: hostKey
	}).then((encoded) => {
		request.post(conf.MASTER_HOST + ":" + conf.MASTER_PORT + "/client/" + conf.CLIENT_NAME, {
			json: {
				msg: encoded.str
			}
		}, (err, res, body) => {
			if (err) throw err;
			if (res.statusCode !== 202) {
				console.log("ERROR: Could not update address");
				throw new Error();
			}
			console.log("INFO: Response is '" + body + "'");
		});
	});
}