var express = require('express');
var app = express();
var request = require('request');

var fs = require('fs');
var path = require('path');
var conf = require(path.join(__dirname, "config.js"));
var key = require(path.join(__dirname, "..", "key.js"));

var hostKey = undefined;
var thisKey = undefined;

var external_ip = undefined;

module.exports.start = () => {
	thisKey = key(conf, () => {
		setup(); 
		listen();
		test();
		// pollIp();
	});
}

function setup() {
	// Attempt to load host key
	fs.readFile(conf.HOST_KEY, (err, k) => {
		if (err) {
			console.log("WARN: Host key not found. Contacting host...");
			addSelf();

			return;
		}

		hostKey = k;
	});

	// Define express paths
	app.get("/", (req, res) => {
		res.sendStatus(200);
	});
}

// Attempts to connect with host server to add self to list of clients
function addSelf() {
	thisKey.pub().then((k) => {
		request.put(conf.MASTER_HOST + ":" + conf.MASTER_PORT + "/client/" + conf.CLIENT_NAME, { json: {
			client: {
				address: conf.HOST, 
				port: conf.PORT,
				pgp_pub: k,
				last_update: Date.now()
			}
		}}, (err, res, body) => {
			if (err) throw err;

			if (res.statusCode !== 201) {
				console.log("ERROR: (" + res.statusCode + ") Could not create client");
				throw new Error();
			}

			fs.writeFile(conf.HOST_KEY, body, (err) => {
				if (err) throw err;

				console.log("Host key received from tracker");
			})
		});
	});
}

function test() {
	thisKey.enc({msg: "THIS IS a TEST", to: hostKey}).then((msg) => {
		request.post(conf.MASTER_HOST + ":" + conf.MASTER_PORT + "/client/" + conf.CLIENT_NAME + "/secure", {
			json: {
				msg: msg.str 
			}
		}, (err, res, body) => {
			if (err) throw err;

			if (res.statusCode !== 200) {
				console.log("ERROR: Could not test endpoint: " + body);
				throw new Error();
			}
		});
	});
}

function listen() {
	app.listen(conf.PORT, conf.HOST, () => {
		console.log("Listening");
	});
}

function pollIp() {
	setInterval(() => {
		getIp();
	}, 6 * 1000);
}

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

function updateAddress() {
	console.log("INFO: Updating host");
	request.post(conf.MASTER_HOST + ":" + conf.MASTER_PORT + "/client/" + conf.CLIENT_NAME, {
		json: {
			address: external_ip
		}
	}, (err, res, body) => {
		if (err) throw err;
		if (res.statusCode !== 202) {
			console.log("ERROR: Could not update address")
			throw new Error();
		}
		console.log("INFO: Response is '" + body + "'");
	});
}