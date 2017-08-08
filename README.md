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

### TODO
* Find a more elegant solution for tracking rather than polling
* Add some sort of security verification for viewing all clients on a host server
* Rewrite entire solution in TypeScript
* Write better documentation using JSDoc
* Improve console messages
* Move from file loading to a database for the server