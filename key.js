var pgp = require('kbpgp');

var fs = require('fs');
var prompt = require('prompt');
var q = require('q');

var ring = new pgp.keyring.KeyRing();
var main_key = undefined;

// Get the key from outside
module.exports.ring = () => {
	return ring;
};

// Add a key to the keychain
module.exports.load = (name, file_path) => {
	if (ring.hasOwnProperty(name)) {
		console.log("ERROR: Key already exists in ring");
		throw new Error();
	}

	fs.readFile(file_path, (err, data) => {
		if (err) throw err;

		pgp.KeyManager.import_from_armored_pgp({armored: data}, (err, k) => {
			if (err) throw err;
			ring.add_key_manager(k);
		});
	});
}

// Print out the public key
module.exports.pub = () => {
	var defer = q.defer();

	if (main_key) {
		main_key.export_pgp_public({}, (err, pgp_public) => {
			if (err) defer.reject(new Error(err));

			defer.resolve(pgp_public);
		});
	} else {
		defer.reject();
	}

	return defer.promise;
};

// Encryt message
// opts has the following fields
// - msg: The Message to encrypt
// - to: Key to sign with
module.exports.enc = (opts) => {
	var defer = q.defer();

	var o = {
		msg: opts.msg,
		sign_with: main_key,
		encrypt_for: opts.to
	};

	pgp.box(o, (err, res_str, res_buf) => {
		if (err) throw err;

		defer.resolve({str: res_str, buf: res_buf});
	});

	return defer.promise;
}

// Decrypt message
// opts has the following fields
// - msg: The Message to decrypt
// - asp: (Optional) the progress field
module.exports.dec = (opts) => {
	var defer = q.defer();

	var o = {
		keyfetch: ring,
		armored: opts.msg,
		asp: opts.asp
	};

	console.log("INFO: Decrypting message...");
	pgp.unbox(o, (err, lits) => {
		if (err)
			throw err;
		
		for (var i = 0; i < lits.length; ++i) {
			console.log("  Decrypted Message: " + lits[i].toString());

			var ds = km = null;
			ds = lits[i].get_data_signer();

			if (ds) km = ds.get_key_manager();
			if (km) console.log("  Signed by: " + km.get_pgp_fingerprint().toString('hex'));
		}
		
		defer.resolve();
	});

	return defer.promise;
};

// Attempt to load keys
module.exports = (conf, callback = () => {}) => {
	fs.readFile(conf.PRIV_KEY_FILE, (err, data) => {
		if (err) {
			console.log("WARN: Key file not found.");
			genKey(conf, callback);
			return;
		}
			
		console.log("INFO: Opening key...");
		pgp.KeyManager.import_from_armored_pgp({armored: data}, (err, k) => {
			if (err)
				throw err;
			
			// Unlock the key if locked
			if (k.is_pgp_locked()) {
				getPrompt({properties: {
					password: {hidden: true}
				}}, (res) => {
					k.unlock_pgp({passphrase: res.password}, (err) => {
						if (err)
							throw err;
						
						console.log("  Key Unlocked");
						ring.add_key_manager(k);
						main_key = k;

						callback();
					});
				});
			} else {
				ring.add_key_manager(k);
				main_key = k;

				callback();
			}
		});
	});

	return this;
};

// Generate the public key
function genKey(conf, callback) {
	console.log("Generating kew key...");
	pgp.KeyManager.generate_rsa({ userid : conf.USER_ID }, function(err, k) {
		ring.add_key_manager(k);
		main_key = k;

		k.sign({}, function(err) {
			console.log("Saving keys to file...");
			
			getPrompt({properties: {
				password: {hidden: true}
			}}, (res) => {
				k.export_pgp_private({passphrase: res.password}, (err, pgp_private) => {
					fs.writeFile(conf.PRIV_KEY_FILE, pgp_private, (err) => {
						if (err)
							throw err;
						
						console.log("  Private Key Written");
					});
				});

				k.export_pgp_public({}, (err, pgp_public) => {
					fs.writeFile(conf.PUB_KEY_FILE, pgp_public, (err) => {
						if (err)
							throw err;
						
						console.log("  Public Key Written");
					});
				});

				callback();
			});
		});
	});
}

// Get prompt info
function getPrompt(schema, callback) {
	prompt.start();
	prompt.get(schema, (err, result) => {
		if (err)
			throw err;

		callback(result);
	});
}