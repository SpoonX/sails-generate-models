"use strict";

var knex = require('knex');

module.exports = function (config, connection) {

    if(parseInt(require('child_process').execSync('sails -v')) < 1){
        connection = config.connections[connection || config.models.connection];
    } else {
        connection = require('url').parse(config.datastores.default.url);
        connection.host = connection.hostname;
        connection.user = connection.auth.split(':')[0];
        connection.password = connection.auth.split(':')[1];
        connection.database = connection.pathname.replace('/','');
        connection.adapter = connection.protocol.replace(':','');
    }

    return knex({
        client: connection.adapter.replace('sails-', ''),
        connection: {
            host: connection.host,
            user: connection.user,
            password: connection.password,
            database: connection.database
        }
    });
};
