var path = require('path');

var server = require(path.join(__dirname, 'server', 'server.js'));
var client = require(path.join(__dirname, 'client', 'client.js'));

module.exports = function (grunt) {
	grunt.initConfig({
		jshint: {
			files: ['Gruntfile.js', './server/**/*.js', './client/**/*.js', './*.js'],
			options: {
				globals: {
					jQuery: true
				},
				esversion: 6
			}
		},
		watch: {
			files: ['<%= jshint.files %>'],
			tasks: ['server']
		}
	});

	grunt.loadNpmTasks('grunt-contrib-jshint');
	grunt.loadNpmTasks('grunt-contrib-watch');

	grunt.registerTask('default', ['jshint', '__server']);
	grunt.registerTask('server', ['jshint', '__server']);
	grunt.registerTask('client', ['jshint', '__client']);
	
	grunt.registerTask('__server', 'Runs the server module of this project.', function () {
		var done = this.async();
		server.start(done);
	});
	grunt.registerTask('__client', 'Runs the client module of this project.', function () {
		var done = this.async();
		client.start(done);
	});
};