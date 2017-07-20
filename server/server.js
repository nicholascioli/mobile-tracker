var express = require('express');
var app = express();
var path = require('path');

var bodyParser = require('body-parser');
var multer = require('multer');
var upload = multer();

var conf = require(path.join(__dirname, 'config.js'));

var fs = require('fs');
var clients = JSON.parse(fs.readFileSync(conf.CLIENTS));
var nclean = require('node-cleanup');

var key = require(path.join(__dirname, "..", "key.js"));
var thisKey = null;

module.exports.start = () => {
	setup();
	thisKey = key(conf, () => {
		// Read in all public keys
		for (c in clients) {
			console.log("INFO: Loading key '" + c + "'");
			thisKey.load(c, clients[c].pgp_pub);
		}

		listen();
	});
};

// Helper method for sending errors
var err = (res, code, msg) => {
	console.log(msg);
	res.status(code).send(msg);
};

function setup() {
	// Setup handler to save all clients to file when node exits
	nclean((exitCode, signal) => {
		console.log("Saving clients to file...");
		fs.writeFileSync(conf.CLIENTS, JSON.stringify(clients), (err) => {
			if (err) throw err;
		});
	});

	// Setup body parsing capabilitites
	app.use(bodyParser.json()); // for parsing application/json
	app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

	// Return list of clients whith GET
	app.get("/", (req, res) => {
		res.send(clients);
	});

	// Get a specific client
	app.get("/client/:client", (req, res) => {
		var client = req.params.client;

		if (!client) {
			err(res, 400, "ERROR: No client specified");
			return;
		}

		if (!clients.hasOwnProperty(client)) {
			err(res, 400, "ERROR: Specified client does not exist");
			return;
		}

		res.send(clients[client]);
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

		clients[client] = req.body.client;

		thisKey.pub().then((k) => {
			var key_path = path.join(__dirname, "..", "keys", client + ".pub");
			fs.writeFile(key_path, clients[client].pgp_pub, (err) => {
				if (err) throw err;

				// Strip the public key from the config and replace it with a reference to the file
				clients[client].pgp_pub = key_path;
			});

			res.status(201).send(k); // Created
		});
	});

	// Update existing client with POST
	app.post("/client/:client", upload.array(), (req, res) => {
		var client = req.params.client;

		if (!client) {
			err(res, 400, "ERROR: No client specified");
			return;
		}

		if (!clients.hasOwnProperty(client)) {
			err(res, 400, "ERROR: Specified client does not exist");
			return;
		}

		// Update all fields
		for (var k in req.body) {
			if (!clients[client].hasOwnProperty(k)) {
				err(res, 400, "ERROR: Client does not have specified property '" + k + "'");
				return;
			}

			clients[client][k] = req.body[k];
		}

		clients[client].last_update = Date.now();
		res.sendStatus(202); // accepted
	});

	app.post("/client/:client/secure", upload.array(), (req, res) => {
		var client = req.params.client;
		
		if (!client) {
			err(res, 400, "ERROR: No client specified");
			return;
		}

		if (!clients.hasOwnProperty(client)) {
			err(res, 400, "ERROR: Specified client does not exist");
			return;
		}

		console.log(req.body.msg);
		thisKey.dec({
			msg: req.body.msg
		}).then(() => {
			res.sendStatus(200);
		});
	});

	// Delete an existing client
	app.delete("/client/:client", (req, res) => {
		var client = req.params.client;

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

		delete clients[client];
		res.sendStatus(200);
	});
}

function listen() {
	app.listen(conf.PORT, conf.HOST, () => {
		console.log("Server listening on " + conf.HOST + ":" + conf.PORT);
	});
}
