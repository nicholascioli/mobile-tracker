# Mobile Tracker
## A simple mobile IP style tracker for a central host and mobile clients

This project aims to provide a [mobile IP](https://en.wikipedia.org/wiki/Mobile_IP) style
client tracker for clients behind dynamic IP walls. 

### Basic Breakdown

At its simplest, this solution works by appointing a host server to keep track of a list
of clients by pinging them every configurable amount of time. The clients, in turn, respond to these
pings and will attempt to contact the host server in the case that the server has not pinged them in
a certain amount of time.

![Mobile IP](https://docs.oracle.com/cd/E19455-01/806-7600/images/PrivateAddr2.epsi.gif)

In the above image of the structure of mobile IP, this solution designates the _Home Agent_ as the
host server, while the client acts as the _Foreign Agent_ / _Mobile Node_. In theory, one could link
several instances of this solution to create a web of interdependent foreign / home agents; simply 
running a host and client on one machine would do the trick.

### Features
* Tracking of mobile clients
* Automatic IP detection using [Ipify](https://api.ipify.org)
* Encryption and verification of server + client through PGP using [keybase.io](https://keybase.io)
* Automatic client updating based on polling

### Set Up
First, rename the relevant `config.js.exmaple` to `config.js` and change the options to match your
server / client setup. Second, provide a public key to use as the administrator verification key.
(If you do not have a key, you can generate one [online](https://www.igolder.com/pgp/generate-key/)
[not verified] or [locally](http://www.pitt.edu/~poole/accessiblePGP703.htm)).

Make sure to have [grunt-cli](https://gruntjs.com/) installed for grunt usage. Otherwise, substitute
the `grunt` command with `node index.js`. On first run, the solution will take a while to generate 
an RSA key and then query you for a password. Although optional, it is highly recommended to supply 
a password.

#### Client
```
npm install
grunt client
```

#### Server
```
npm install
grunt server
```

### Paths
Below are a list of the paths used and their requirements / results

#### Server
* OPTIONS `/`

	This path is special in that it is primarily reserved for admin use. As such, the server expects
	requests to be encrypted and signed by the admin key specified in the configuration file and
	presented in JSON format, with the following options:

	`client`: The client to perform operations on. If this is not supplied, the server will return
	a JSON representation of all of the clients registered.

	`op`: The operation to apply. Can be `GET` for information retrieval or `DELETE` for deletion.

* GET `/fingerprint`

	Returns the PGP fingerprint of the server's key, which can be used for
	verification. (Note, the server also logs the fingerprint to console whenever
	this path is accessed. Feel free to use that output to ensure that the fingerprint
	is correct).

* PUT `/client/:client`

	Creates a new client by the name of `:client` and returns the server's public
	key so the client can then encrypt all further messages. Will also write the
	key of the client to file at `keys/:client.pub`.

* POST `/client/:client`

	Updates the specified client with the supplied information. The server requires
	the supplied information to be encrypted and signed by the client.

#### Client
* POST `/ping`

	Responds with status code 200 if the incoming ping is encrypted and signed by
	the host server specified in the configuration file.

### TODO
* Find a more elegant solution for tracking rather than polling
* Rewrite entire solution in TypeScript
* Write better documentation using JSDoc
* Improve console messages
* Move from file loading to a database for the server