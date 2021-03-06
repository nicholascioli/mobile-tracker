// key.js
// ---------
// An object representation of a keybase.io PGP key.
// This object also contains a PGP key ring which contains all of the known keys for 
// decryption and verification sake.
var pgp = require('kbpgp');

var fs = require('fs');
var prompt = require('prompt');
var q = require('q');

module.exports = class key {
	// Initializes the key class with the following member objects
	// - _ring => The key ring
	// - _names => Array of key names
	// - _key  => The owner's main key
	// - _pub  => The armored PGP representation of the public key
	constructor(conf, callback = () => {}) {
		// Private members
		var _ring = new pgp.keyring.KeyRing();
		var _names = {};
		var _key = null;
		var _pub = null;

		// -- Private methods --
		// Returns the armored PGP public key asynchronously
		var getPub = () => {
			var defer = q.defer();

			if (_key) {
				_key.export_pgp_public({}, (err, pgp_public) => {
					if (err) defer.reject(new Error(err));

					_pub = pgp_public;
					defer.resolve(pgp_public);
				});
			} else {
				defer.reject();
			}

			return defer.promise;
		};

		// Starts a user prompt for password entries, etc.
		// - schema: JSON | A list of options to pass to the prompt.
		//     refer to https://www.npmjs.com/package/prompt
		// - callback: function | A function to call on completion of the prompt. Passed
		//     the results of the prompt as a JSON where the key is the name of the option
		var getPrompt = (schema, callback) => {
			prompt.start();
			prompt.get(schema, (err, result) => {
				if (err)
					throw err;

				callback(result);
			});
		};

		// Generates an RSA key for use
		// - conf: JSON | A list of config options. Refer to the example config file
		// - callback: function | A function to call after successfull generation of a key. No
		//     arguments are supplied to the callback.
		var genKey = (conf, callback) => {
			console.log("Generating new key '" + conf.USER_ID + "'");
			pgp.KeyManager.generate_rsa({ userid : conf.USER_ID }, function(err, k) {
				_ring.add_key_manager(k);
				_key = k;

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
								
								_pub = pgp_public;
								console.log("  Public Key Written");
							});
						});

						callback();
					});
				});
			});
		};

		// Privileged members
		this.key = () => { return _key; };
		this.names = () => { return _names; };
		this.ring = () => { return _ring; };
		this.pub = () => { return _pub; };

		// Import main key
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
							_ring.add_key_manager(k);
							_key = k;

							getPub();
							callback();
						});
					});
				} else {
					_ring.add_key_manager(k);
					_key = k;

					getPub();
					callback();
				}
			});
		});
	}

	// Returns the fingerprint of the main key
	get fingerprint() {
		return this.key().get_pgp_fingerprint().toString('hex').match(/.{1,2}/g).join(':');
	}

	// Returns the fingerprint of the supplied key
	// - other_key: KeyManager | An instance of a KeyManager
	static fingerprintOf(other_key) {
		return other_key.get_pgp_fingerprint().toString('hex').match(/.{1,2}/g).join(':');
	}

	// Loads a PGP key from file
	// - name: String | The name of the key to load (for unique reference querying)
	// - file_path: String | The path to the key file to load
	loadFile(name, file_path) {
		var defer = q.defer();
		var ring = this.ring();
		var names = this.names();

		// Make sure that the key to load is unique
		if (names.hasOwnProperty(name)) {
			console.log("ERROR: Key already exists in ring");
			throw new Error();
		}

		// Load the file into memory / the keyring
		fs.readFile(file_path, (err, data) => {
			if (err) throw err;

			pgp.KeyManager.import_from_armored_pgp({armored: data}, (err, k) => {
				if (err) throw err;
				ring.add_key_manager(k);
				names[name] = k;
				
				defer.resolve(k);
			});
		});

		return defer.promise;
	}

	// Loads a PGP key from armored text
	// - name: String | The name of the key to load (for unique reference querying)
	// - armored_pgp: String | The armored PGP text of a public key
	loadArmored(name, armored_pgp) {
		var defer = q.defer();
		var ring = this.ring();
		var names = this.names();

		if (names.hasOwnProperty(name)) {
			console.log("ERROR: Key already exists in ring");
			throw new Error();
		}

		pgp.KeyManager.import_from_armored_pgp({armored: armored_pgp}, (err, k) => {
			if (err) throw err;
			ring.add_key_manager(k);
			names[name] = k;

			defer.resolve(k);
		});

		return defer.promise;
	}

	// Removes a key from the keyring
	// - name: String | The name of the key to remove
	// TODO: Find a way to remove keys from keyring without regenerating the ring every time
	unload(name) {
		var names = this.names();
		var ring = this.ring();

		if (!names.hasOwnProperty(name)) {
			console.log("ERROR: Specified key is not in the keyring");
			throw new Error();
		}

		// Remove the key
		delete names[name];

		// Regenerate the keyring
		ring = new pgp.keyring.KeyRing();
		for (var k in names) {
			ring.add_key_manager(names[k]);
		}
	}

	// Returns a KeyManager based on its unique name
	// - name: String | The name of the key to return
	getKeyByName(name) {
		var names = this.names();

		// Make sure that the key is in the keyring
		if (!names.hasOwnProperty(name)) {
			console.error("ERROR: Key by name '" + name + "' does not exist in this ring");
			throw new Error();
		}

		return this.ring().lookup(names[name].get_ekid());
	}

	// Encryt message
	// opts has the following fields
	// - msg: The Message to encrypt
	// - to: Key to encrypt for
	enc(opts) {
		var defer = q.defer();
		var key = this.key();

		var o = {
			msg: opts.msg,
			sign_with: key,
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
	dec(opts) {
		var defer = q.defer();
		var ring = this.ring();

		var o = {
			keyfetch: ring,
			armored: opts.msg,
			asp: opts.asp
		};

		// console.log("INFO: Decrypting message...");
		pgp.unbox(o, (err, lits) => {
			if (err)
				throw err;
			
			var res = [];
			for (var i = 0; i < lits.length; ++i) {
				// console.log("  Decrypted Message: " + lits[i].toString());
				res.push({
					msg: lits[i].toString(),
					owner: null
				});

				var ds = null;
				var km = null;
				ds = lits[i].get_data_signer();

				if (ds) km = ds.get_key_manager();
				if (km) {
					res[i].owner = this.constructor.fingerprintOf(km);
					// console.log("  Signed by: " + this.constructor.fingerprintOf(km));
				}
			}
			
			defer.resolve(res);
		});

		return defer.promise;
	}
};