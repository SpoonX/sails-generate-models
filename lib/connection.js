"use strict";

var knex = require('knex');

module.exports = function (config, connection) {
  connection = config.connections[connection || config.models.connection];

  return knex({
    client: connection.adapter.replace('sails-', ''),
    connection: {
      host: connection.host,
      user: connection.user,
      password: connection.password,
      database: connection.database,
    }
  });
};
